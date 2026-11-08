// Stage 4 (run 2): the FIXED launcher (GAS_FACTORY 110 Tgas) and market (ABI 1.1.2) against the REAL factory token.primitives.testnet.
// DEMO PROFILE, TESTNET play money, throwaway accounts only. Stages (ONLY=SETUP,FULL,FAIL): setup, full launch, failed launch.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EVID, ROOT, id, call, view, snapshot, sleep, tgas, ensureAccount, deployWasm, yocto, USDC, append } from './lib.mjs';

const W = (n) => new URL(`../../target/near/${n}/${n}.wasm`, import.meta.url).pathname;
const REAL = 'token.primitives.testnet';
const [L, M, U, GUARD, TREAS] = [id('demo-instant'), id('demo-market'), id('usdc'), id('guardian'), id('treasury')];
const [CA, CB, BUY] = [id('creator-a'), id('creator-b'), id('buyer')];
const only = process.env.ONLY || 'SETUP,FULL,FAIL';
const sha = (n) => crypto.createHash('sha256').update(fs.readFileSync(W(n))).digest('hex');
const mint = (who, usdc) => call(`mint ${usdc} USDC to ${who}`, ROOT, U, 'mint', { account_id: who, amount: String(BigInt(usdc) * USDC) }, { gas: tgas(30) });
const ftCall = (step, signer, token, receiver, amount, msg, extra) =>
  call(step, signer, token, 'ft_transfer_call', { receiver_id: receiver, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: '1', gas: tgas(300), ...extra });
const regToken = (who, token) => call(`register ${who} on ${token}`, ROOT, token, 'storage_deposit', { account_id: who }, { deposit: yocto(0.00125), gas: tgas(30) });

async function setup() {
  for (const [n, f] of [['guardian', 0.15], ['treasury', 0.15], ['usdc', 1.9], ['demo-instant', 3.2], ['demo-market', 2.9], ['creator-a', 0.6], ['creator-b', 0.6], ['buyer', 0.5]]) await ensureAccount(id(n), ROOT, f);
  await deployWasm(U, W('mock_ft'), 'new', { owner_id: ROOT, total_supply: '0' });
  await deployWasm(L, W('kruxa_instant_contract'), 'new', { owner: ROOT, guardian: GUARD, treasury: TREAS, usdc: U, factory: REAL, profile: 'demo' });
  await deployWasm(M, W('kruxa_market_contract'), 'new', { owner: ROOT, guardian: GUARD, treasury: TREAS, usdc: U, core: ROOT, max_pool_reserve_q: null, max_global_reserve_q: null, max_instant_reserve_q: null });
  for (const who of [L, M, TREAS, CA, CB, BUY, ROOT])
    await call(`register ${who} on mock USDC`, ROOT, U, 'storage_deposit', { account_id: who }, { deposit: '2000000000000000000000', gas: tgas(30) });
  await call('market.set_launcher(launcher)', ROOT, M, 'set_launcher', { account: L }, { gas: tgas(30) });
  await call('launcher.set_market(market)', ROOT, L, 'set_market', { account: M }, { gas: tgas(30) });
  fs.writeFileSync(path.join(EVID, 'accounts.json'), JSON.stringify({ network: 'NEAR TESTNET (play money)', profile: 'demo (10-second days): throwaway demo accounts, never a public deployment',
    real_factory: REAL, accounts: { owner: ROOT, guardian: GUARD, treasury: TREAS, usdc: U, launcher: L, market: M, creatorA: CA, creatorB: CB, buyer: BUY },
    wasm_sha256: { launcher: sha('kruxa_instant_contract'), market: sha('kruxa_market_contract'), mock_ft: sha('mock_ft') } }, null, 2));
  console.log(JSON.stringify(await view(L, 'get_config')).slice(0, 500));
  await snapshot('after setup', L, M);
}

async function create(signer, sym, extra = {}) {
  const lid = (await view(L, 'get_config')).next_launch_id;
  const dep = await view(L, 'required_deposit');
  const c = await call(`create_instant ${sym} against ${REAL} (110 Tgas factory call)`, signer, L, 'create_instant', { params: { name: `${sym} Demo`, symbol: sym, ...extra }, payout_recipient: null }, { deposit: dep, gas: tgas(300) });
  await sleep(10);
  const inst = await view(L, 'get_instant', { launch_id: lid });
  append('findings.jsonl', { finding: 'create_instant on the real factory with GAS_FACTORY 110', symbol: sym, tx: c.tx, status: inst.status, token: inst.token, receipts: c.receipts });
  await snapshot(`after create_instant ${sym}`, L, M, lid);
  if (inst.status !== 'TokenReady') { console.log('STOP: not TokenReady', inst.status); process.exit(2); }
  return { lid, token: inst.token };
}

async function full(sym) {
  console.log('=== full launch on the real factory');
  const { lid, token } = await create(CA, sym, { vest_days: 30 });
  await mint(CA, 400);
  await ftCall('seed 250 USDC (creator-a)', CA, U, L, 250n * USDC, { v: 1, op: 'seed_instant', launch_id: lid });
  await snapshot('after seed', L, M, lid);
  await call('claim_vested before the pool is open (expect R_INSTANT_STATE)', CA, L, 'claim_vested', { launch_id: lid }, { expectFail: true });
  const op = await call('open_instant by a stranger at 260 Tgas', BUY, L, 'open_instant', { launch_id: lid }, { gas: tgas(260) });
  await sleep(10);
  const st = await view(L, 'get_instant', { launch_id: lid });
  append('findings.jsonl', { finding: 'open_instant at 260 Tgas on a real factory token', tx: op.tx, status_after: st.status, seed_inflight: st.seed_inflight, market_storage_balance_on_token: await view(token, 'storage_balance_of', { account_id: M }) });
  await snapshot('after open_instant', L, M, lid);
  if (st.status !== 'Open') { console.log('STOP: launch did not open', st.status); process.exit(2); }
  await mint(BUY, 200);
  await regToken(BUY, token);
  await ftCall('buy 20 USDC (buyer)', BUY, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1' });
  await snapshot('after buy', L, M, lid);
  const held = await view(token, 'ft_balance_of', { account_id: BUY });
  await ftCall('sell half back (buyer)', BUY, token, M, BigInt(held) / 2n, { v: 1, op: 'sell', launch_id: lid, min_out: '1' });
  await snapshot('after sell', L, M, lid);
  await regToken(CA, token);
  await ftCall('SELF-BUY by creator-a (expect R_SELF_BUY)', CA, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1' }, { expectFail: true });
  await ftCall('SELF-BUY by buyer with receiver=creator-a (expect R_SELF_BUY)', BUY, U, M, 20n * USDC, { v: 1, op: 'buy', launch_id: lid, min_out: '1', receiver: CA }, { expectFail: true });
  await snapshot('after refused self-buys', L, M, lid);
  await vesting(lid, token);
}

async function vesting(lid, token) {
  console.log('waiting for the 70 s demo cliff');
  for (;;) { const v = await view(L, 'get_vesting', { launch_id: lid }); if (BigInt(v.claimable) > 0n) break; await sleep(5); }
  await call('claim_vested by a stranger (expect R_NOT_AUTHORIZED)', BUY, L, 'claim_vested', { launch_id: lid }, { expectFail: true });
  const v = await view(L, 'get_vesting', { launch_id: lid });
  await call('claim_vested above claimable (expect STREAM_CAP)', CA, L, 'claim_vested', { launch_id: lid, amount: (BigInt(v.claimable) * 3n).toString() }, { expectFail: true });
  await call('claim_vested all claimable (creator-a)', CA, L, 'claim_vested', { launch_id: lid });
  console.log('creator-a token balance', await view(token, 'ft_balance_of', { account_id: CA }));
  await snapshot('after vesting claim', L, M, lid);
}

async function fail(sym) {
  console.log('=== failed launch on the real factory (market paused, abort, reclaim)');
  const { lid } = await create(CB, sym);
  await mint(CB, 250);
  await ftCall('seed 250 USDC (creator-b)', CB, U, L, 250n * USDC, { v: 1, op: 'seed_instant', launch_id: lid });
  await call('market.pause (guardian)', GUARD, M, 'pause', {}, { gas: tgas(30) });
  await call('open_instant while the market is paused (expect R_PAUSED)', BUY, L, 'open_instant', { launch_id: lid }, { gas: tgas(300), expectFail: true });
  await sleep(8);
  await snapshot('B after refused open', L, M, lid);
  await call('abort_instant too early (expect R_TOO_EARLY)', CB, L, 'abort_instant', { launch_id: lid }, { expectFail: true });
  for (;;) { const p = await view(L, 'get_phase', { launch_id: lid }); if (Date.now() * 1e6 > Number(p.can_abort_at_ns) + 5e9) break; await sleep(4); }
  await call('abort_instant by a stranger (expect R_NOT_AUTHORIZED)', BUY, L, 'abort_instant', { launch_id: lid }, { expectFail: true });
  await call('abort_instant by creator-b', CB, L, 'abort_instant', { launch_id: lid });
  await sleep(8);
  console.log('creator-b USDC after abort', await view(U, 'ft_balance_of', { account_id: CB }));
  await snapshot('B after abort', L, M, lid);
  await call('reclaim_deposit (creator-b)', CB, L, 'reclaim_deposit', { launch_id: lid }, { gas: tgas(60) });
  await call('market.unpause (owner)', ROOT, M, 'unpause', {}, { gas: tgas(30) });
  await snapshot('B after reclaim', L, M, lid);
}

const tag = ROOT.replace(/^kxi-root-/, '').replace('.testnet', '');
if (only.includes('SETUP')) await setup();
if (only.includes('FULL')) await full(`KXIA${tag}`);
if (only.includes('FAIL')) await fail(`KXIB${tag}`);
console.log('done');
