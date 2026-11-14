// Stage 2: one full instant launch on testnet (DEMO PROFILE): create, seed, open (at 260 Tgas, the C-01 sample), buy, sell,
// refused self-buys, a vesting claim after the 70 s demo cliff; then a failed launch (market paused, abort, reclaim).
import fs from 'fs';
import path from 'path';
import { EVID, ROOT, id, call, view, snapshot, sleep, tgas, ensureAccount, deployWasm, yocto, N_TOTAL, USDC, append } from './lib.mjs';

const W = (n) => new URL(`../../target/near/${n}/${n}.wasm`, import.meta.url).pathname;
const L = id('demo-instant'), M = id('demo-market'), U = id('usdc'), F = id('factory');
const [GUARD, CA, CB, BUY] = [id('guardian'), id('creator-a'), id('creator-b'), id('buyer')];
const tok = (s) => `${s.toLowerCase()}.${F}`;
const OPEN_GAS = process.env.OPEN_GAS || '260';
const only = process.env.ONLY || 'AB';

async function predeploy(sym) {
  await ensureAccount(tok(sym), F, 1.8);
  await deployWasm(tok(sym), W('mock_ft'), 'new', { owner_id: L, total_supply: N_TOTAL.toString() });
}
const mint = (who, usdc) => call(`mint ${usdc} USDC to ${who}`, ROOT, U, 'mint', { account_id: who, amount: String(BigInt(usdc) * USDC) }, { gas: tgas(30) });
const ftCall = (step, signer, token, receiver, amount, msg, extra) =>
  call(step, signer, token, 'ft_transfer_call', { receiver_id: receiver, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: '1', gas: tgas(300), ...extra });
async function create(signer, sym, extra = {}) {
  const lid = (await view(L, 'get_config')).next_launch_id;
  const dep = await view(L, 'required_deposit');
  const r = await call(`create_instant ${sym}`, signer, L, 'create_instant', { params: { name: `${sym} Demo`, symbol: sym, trade_delay_secs: 0, ...extra }, payout_recipient: null }, { deposit: dep, gas: tgas(300) });
  await snapshot(`after create_instant ${sym}`, L, M, lid);
  return lid;
}

if (only.includes('A')) {
  console.log('=== Flow A: full launch ALPHA');
  await predeploy('ALPHA');
  await snapshot('before flow A', L, M);
  const lid = await create(CA, 'ALPHA', { vest_days: 30 });
  await mint(CA, 400);
  await ftCall('seed 250 USDC (creator-a)', CA, U, L, 250n * USDC, { v: 1, op: 'seed_instant', launch_id: lid });
  await snapshot('after seed', L, M, lid);
  await call('claim_vested before the pool is open (expect R_INSTANT_STATE)', CA, L, 'claim_vested', { launch_id: lid }, { expectFail: true });
  const op = await call(`open_instant by a stranger at ${OPEN_GAS} Tgas`, BUY, L, 'open_instant', { launch_id: lid }, { gas: tgas(OPEN_GAS) });
  await sleep(6);
  const st = await view(L, 'get_instant', { launch_id: lid });
  console.log('status after open:', st.status, 'seed_inflight', st.seed_inflight);
  append('findings.jsonl', { finding: 'C-01 sample on testnet', open_instant_prepaid_tgas: OPEN_GAS, tx: op.tx, status_after: st.status, seed_inflight: st.seed_inflight, pool_state: (await view(M, 'get_pool', { launch_id: lid }))?.state });
  await snapshot('after open_instant', L, M, lid);
  if (st.status !== 'Open') { console.log('STOP: launch did not open (see findings.jsonl)'); process.exit(2); }

  await mint(BUY, 200);
  await call('register buyer on ALPHA token', ROOT, tok('ALPHA'), 'storage_deposit', { account_id: BUY }, { deposit: yocto(0.002), gas: tgas(30) });
  await ftCall('buy 20 USDC (buyer)', BUY, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1' });
  await snapshot('after buy', L, M, lid);
  const held = await view(tok('ALPHA'), 'ft_balance_of', { account_id: BUY });
  await ftCall('sell half back (buyer)', BUY, tok('ALPHA'), M, BigInt(held) / 2n, { v: 1, op: 'sell', launch_id: lid, min_out: '1' });
  await snapshot('after sell', L, M, lid);
  await call('register creator-a on ALPHA token', ROOT, tok('ALPHA'), 'storage_deposit', { account_id: CA }, { deposit: yocto(0.002), gas: tgas(30) });
  await ftCall('SELF-BUY by creator-a (expect R_SELF_BUY)', CA, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1' }, { expectFail: true });
  await ftCall('SELF-BUY by buyer with receiver=creator-a (expect R_SELF_BUY)', BUY, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1', receiver: CA }, { expectFail: true });
  await snapshot('after refused self-buys', L, M, lid);

  console.log('waiting for the 70 s demo cliff');
  for (;;) { const v = await view(L, 'get_vesting', { launch_id: lid }); if (BigInt(v.claimable) > 0n) { console.log('claimable', v.claimable); break; } await sleep(5); }
  await call('claim_vested by a stranger (expect R_NOT_AUTHORIZED)', BUY, L, 'claim_vested', { launch_id: lid }, { expectFail: true });
  const v = await view(L, 'get_vesting', { launch_id: lid });
  await call('claim_vested above claimable (expect STREAM_CAP)', CA, L, 'claim_vested', { launch_id: lid, amount: (BigInt(v.claimable) * 3n).toString() }, { expectFail: true });
  await call('claim_vested all claimable (creator-a)', CA, L, 'claim_vested', { launch_id: lid });
  console.log('creator-a ALPHA balance', await view(tok('ALPHA'), 'ft_balance_of', { account_id: CA }));
  await snapshot('after vesting claim', L, M, lid);
  fs.writeFileSync(path.join(EVID, 'flow-a.json'), JSON.stringify({ launch_id: lid, token: tok('ALPHA'), creator: CA, buyer: BUY }, null, 2));
}

if (only.includes('B')) {
  console.log('=== Flow B: failed launch BETA (market paused, abort, reclaim)');
  await predeploy('BETA');
  const lid = await create(CB, 'BETA');
  await mint(CB, 250);
  await ftCall('seed 250 USDC (creator-b)', CB, U, L, 250n * USDC, { v: 1, op: 'seed_instant', launch_id: lid });
  await snapshot('B after seed', L, M, lid);
  await call('market.pause (guardian)', GUARD, M, 'pause', {}, { gas: tgas(30) });
  await call('open_instant while the market is paused (seed leg refused, expect R_PAUSED)', BUY, L, 'open_instant', { launch_id: lid }, { gas: tgas(300), expectFail: true });
  await sleep(8);
  await snapshot('B after refused open', L, M, lid);
  await call('abort_instant too early (expect R_TOO_EARLY)', CB, L, 'abort_instant', { launch_id: lid }, { expectFail: true });
  console.log('waiting for the 30 s abort window');
  for (;;) { const p = await view(L, 'get_phase', { launch_id: lid }); if (Date.now() * 1e6 > Number(p.can_abort_at_ns) + 5e9) break; await sleep(4); }
  await call('abort_instant by a stranger (expect R_NOT_AUTHORIZED)', BUY, L, 'abort_instant', { launch_id: lid }, { expectFail: true });
  await call('abort_instant by creator-b', CB, L, 'abort_instant', { launch_id: lid });
  await sleep(6);
  console.log('creator-b USDC after abort', await view(U, 'ft_balance_of', { account_id: CB }));
  await snapshot('B after abort', L, M, lid);
  await call('reclaim_deposit (creator-b)', CB, L, 'reclaim_deposit', { launch_id: lid }, { gas: tgas(60) });
  await call('market.unpause (owner)', ROOT, M, 'unpause', {}, { gas: tgas(30) });
  await snapshot('B after reclaim', L, M, lid);
}
console.log('done');
