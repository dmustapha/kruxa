// Stage 3: the launcher against the REAL token factory (token.primitives.testnet) on testnet. DEMO PROFILE, throwaway accounts.
// Answers CO-7 unknown #1 (registering the market on a factory token with 0.00125 NEAR), H-01 (failed factory call refund and rate
// limit) and M-04 (does the real token's ft_transfer return bytes, which the market would book as a failed payout).
import fs from 'fs';
import { ROOT, id, call, view, snapshot, sleep, tgas, ensureAccount, deployWasm, yocto, USDC, balanceNear, append } from './lib.mjs';

const W = (n) => new URL(`../../target/near/${n}/${n}.wasm`, import.meta.url).pathname;
const REAL = 'token.primitives.testnet';
const L = id('demo-instant-real'), M = id('demo-market-real'), U = id('usdc');
const [CC, CD, BUY2] = [id('creator-c'), id('creator-d'), id('buyer2')];
const [GUARD, TREAS] = [id('guardian'), id('treasury')];
const only = process.env.ONLY || 'SETUP,OPEN,H01';

if (only.includes('SETUP')) {
  for (const [n, f] of [['demo-instant-real', 3.0], ['demo-market-real', 2.9], ['creator-c', 0.6], ['creator-d', 0.6], ['buyer2', 0.5]]) await ensureAccount(id(n), ROOT, f);
  await deployWasm(L, W('kruxa_instant_contract'), 'new', { owner: ROOT, guardian: GUARD, treasury: TREAS, usdc: U, factory: REAL, profile: 'demo' });
  await deployWasm(M, W('kruxa_market_contract'), 'new', { owner: ROOT, guardian: GUARD, treasury: TREAS, usdc: U, core: ROOT, max_pool_reserve_q: null, max_global_reserve_q: null, max_instant_reserve_q: null });
  for (const who of [L, M, CC, CD, BUY2]) await call(`register ${who} on mock USDC`, ROOT, U, 'storage_deposit', { account_id: who }, { deposit: '2000000000000000000000', gas: tgas(30) });
  await call('real market.set_launcher', ROOT, M, 'set_launcher', { account: L }, { gas: tgas(30) });
  await call('real launcher.set_market', ROOT, L, 'set_market', { account: M }, { gas: tgas(30) });
}

const ftCall = (step, signer, token, receiver, amount, msg, extra) =>
  call(step, signer, token, 'ft_transfer_call', { receiver_id: receiver, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: '1', gas: tgas(300), ...extra });

if (only.includes('OPEN')) {
  console.log('=== real factory: create, seed, open, buy');
  const sym = process.env.SYM || 'KXIREAL1';
  const token = `${sym.toLowerCase()}.${REAL}`;
  const lid = (await view(L, 'get_config')).next_launch_id;
  const dep = await view(L, 'required_deposit');
  const c = await call(`create_instant ${sym} against ${REAL}`, CC, L, 'create_instant', { params: { name: `${sym} Demo`, symbol: sym }, payout_recipient: null }, { deposit: dep, gas: tgas(300) });
  await sleep(8);
  let inst = await view(L, 'get_instant', { launch_id: lid });
  append('findings.jsonl', { finding: 'real factory create_token via the launcher', symbol: sym, tx: c.tx, status: inst.status, token: inst.token, receipts: c.receipts, deposit_paid: inst.deposit_paid });
  await snapshot('real: after create_instant', L, null, lid).catch((e) => console.log('snapshot skipped', e.message));
  console.log('status', inst.status, 'token', inst.token);
  if (inst.status !== 'TokenReady') { console.log('STOP: token creation did not reach TokenReady'); process.exit(2); }
  await call(`mint 300 USDC to creator-c`, ROOT, U, 'mint', { account_id: CC, amount: String(300n * USDC) }, { gas: tgas(30) });
  await ftCall('real: seed 250 USDC', CC, U, L, 250n * USDC, { v: 1, op: 'seed_instant', launch_id: lid });
  const op = await call('real: open_instant at 300 Tgas (registers the market on the real token with 0.00125 NEAR)', BUY2, L, 'open_instant', { launch_id: lid }, { gas: tgas(300) });
  await sleep(10);
  inst = await view(L, 'get_instant', { launch_id: lid });
  const reg = await view(inst.token, 'storage_balance_of', { account_id: M }).catch((e) => `view failed: ${e.message.slice(0, 100)}`);
  const pool = await view(M, 'get_pool', { launch_id: lid });
  append('findings.jsonl', { finding: 'CO-7 unknown 1: market registration on a real factory token with 0.00125 NEAR', open_tx: op.tx, receipts: op.receipts, status_after: inst.status, tokens_sent: inst.tokens_sent, market_storage_balance_on_token: reg, pool_state: pool && pool.state });
  console.log('status after open', inst.status, 'registration', JSON.stringify(reg), 'pool', pool && pool.state);
  await snapshot('real: after open_instant', L, M, lid).catch((e) => console.log('snapshot skipped', e.message));
  if (inst.status === 'Open') {
    await call('register buyer2 on the real token (own deposit)', BUY2, inst.token, 'storage_deposit', { account_id: BUY2 }, { deposit: yocto(0.00125), gas: tgas(30) });
    await call('mint 50 USDC to buyer2', ROOT, U, 'mint', { account_id: BUY2, amount: String(50n * USDC) }, { gas: tgas(30) });
    await ftCall('real: buy 20 USDC (market pays tokens with the real ft_transfer)', BUY2, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1' });
    await sleep(6);
    const owed = await view(M, 'solvency_report', { token_id: inst.token });
    const got = await view(inst.token, 'ft_balance_of', { account_id: BUY2 });
    append('findings.jsonl', { finding: 'M-04 on the real factory token', buyer_token_balance: got, market_owed_total_of_real_token: owed.owed_total, verdict: owed.owed_total === '0' ? 'NOT_EXPLOITABLE with this token (ft_transfer returns nothing the market misreads)' : 'EXPLOITABLE: payout also booked as owed' });
    console.log('M-04: buyer got', got, 'owed_total', owed.owed_total);
    await snapshot('real: after buy', L, M, lid);
  }
}

if (only.includes('H01')) {
  console.log('=== H-01 against the real factory: a symbol whose token account already exists');
  const taken = process.env.TAKEN || 'PRB121320'; // prb121320.token.primitives.testnet exists from the factory probe
  const b0 = await (await import('./lib.mjs')).balanceRawNear(L);
  const dep = await view(L, 'required_deposit');
  const lid = (await view(L, 'get_config')).next_launch_id;
  const c = await call(`create_instant ${taken} (token account already exists on the real factory)`, CD, L, 'create_instant', { params: { name: 'Taken', symbol: taken }, payout_recipient: null }, { deposit: dep, gas: tgas(300) });
  await sleep(10);
  const r = await view(L, 'get_instant', { launch_id: lid });
  const b1 = await (await import('./lib.mjs')).balanceRawNear(L);
  console.log('status', r.status, 'refundable', r.deposit_refundable, 'launcher balance delta so far', b1 - b0);
  let rec = null;
  if (r.status === 'CreationFailed') {
    rec = await call('reclaim_deposit (H-01)', CD, L, 'reclaim_deposit', { launch_id: lid }, { gas: tgas(60) });
    await sleep(8);
  }
  const b2 = await (await import('./lib.mjs')).balanceRawNear(L);
  const again = await call('create_instant again straight away (rate limit cleared?)', CD, L, 'create_instant', { params: { name: 'Again', symbol: 'KXIAGAIN' }, payout_recipient: null }, { deposit: dep, gas: tgas(300), expectFail: true });
  append('findings.jsonl', { finding: 'H-01 on the real factory', create_tx: c.tx, create_receipts: c.receipts, status: r.status, deposit_paid: r.deposit_paid, deposit_refundable: r.deposit_refundable,
    launcher_balance_near: { before: b0, after_create: b1, after_reclaim: b2 }, launcher_net_change_near: b2 - b0, second_create_rate_limited: again.rule_codes.includes('R_RATE_LIMIT'), second_create_tx: again.tx });
}
console.log('done');
