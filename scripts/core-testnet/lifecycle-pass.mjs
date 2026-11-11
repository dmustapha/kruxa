// FG-11 on NEAR TESTNET (play money): the PASS-side lifecycle paths on an already settled launch of core4 (default launch 1, the RED swarm run's
// launch; its recorded readback file stays as it was). Runs claim_tokens (twice for one holder: the second is the refused repeat), a PASS excess
// claim_refund, sweep_residue, a stream draw inside the cap and a draw above it (STREAM_CAP). Before and after views go to lifecycle/views-*.json.
//   KXI_CORE=core4.kxi-root-1108.testnet KXI_EVID=evidence/testnet-core3/lifecycle KXI_RPC=<retry proxy> node lifecycle-pass.mjs [launch_id]
// TESTNET ONLY. Keys are read from ~/.kruxa-secrets by lib.mjs and are never printed.
import { L, A, writeJson } from './common.mjs';

const id = process.argv[2] || '1';
const KEEPER = `keeper.${A.owner}`;
const CLAIMANTS = [`sw-w1.${A.owner}`, `sw-h2.${A.owner}`];
const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;

async function views(label, holders) {
  const v = { label, at: new Date().toISOString(), core: A.core, launch_id: id };
  for (const m of ['get_state', 'get_ledger', 'get_invariants', 'get_settlement', 'get_token_custody', 'stream_status']) v[m] = await L.view(A.core, m, { launch_id: id });
  v.positions = {};
  for (const h of holders) v.positions[h] = await L.view(A.core, 'get_position', { launch_id: id, holder: `near:${h}` });
  v.usdc = {};
  for (const a of [A.core, ...holders, `creator-a.${A.owner}`]) v.usdc[a] = await L.view(A.usdc, 'ft_balance_of', { account_id: a });
  v.launch_token = {};
  const token = v.get_state.token;
  for (const a of [A.core, ...holders]) v.launch_token[a] = await L.view(token, 'ft_balance_of', { account_id: a }).catch((e) => `unregistered or error: ${String(e.message).slice(0, 60)}`);
  v.near = {};
  for (const a of [A.owner, ...holders, `creator-a.${A.owner}`, KEEPER]) v.near[a] = await L.balanceRawNear(a);
  writeJson(`views-pass-${label}.json`, v);
  return v;
}
async function topUp(name, floor) {
  const bal = await L.balanceRawNear(name);
  if (bal >= floor) return;
  const out = await (await L.acct('kx-fund-1112.testnet')).sendMoney(name, near(floor - bal));
  L.append('txlog.jsonl', { step: `top up ${name} to ${floor} NEAR from kx-fund-1112`, signer: 'kx-fund-1112.testnet', contract: name, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  console.log(`topped up ${name} tx=${out.transaction.hash}`);
}

const before = await views('before', CLAIMANTS);
for (const c of CLAIMANTS) await topUp(c, 0.25);
const claim = (who, expectFail = false) => L.call(`claim_tokens launch ${id} (${who})`, who, A.core, 'claim_tokens', { launch_id: id }, { gas: L.tgas(100), deposit: L.yocto('0.00126'), expectFail });
await claim(CLAIMANTS[0]);
await claim(CLAIMANTS[0], true);
await claim(CLAIMANTS[1]);
await L.call(`claim_refund launch ${id} (PASS excess, holder ${CLAIMANTS[0]}, called by the holder)`, CLAIMANTS[0], A.core, 'claim_refund', { launch_id: id, holder: null }, { gas: L.tgas(100) });
await L.sleep(8);
await L.call(`sweep_residue launch ${id} (keeper)`, KEEPER, A.core, 'sweep_residue', { launch_id: id }, { gas: L.tgas(100) });
await L.sleep(5);
const streamBefore = await L.view(A.core, 'stream_status', { launch_id: id });
console.log('stream_status before draw', JSON.stringify(streamBefore));
const creator = streamBefore.recipient;
await L.call(`draw launch ${id} 200000 micro-USDC inside the cap (cap ${streamBefore.cap})`, creator, A.core, 'draw', { launch_id: id, amount: '200000' }, { gas: L.tgas(100) });
await L.sleep(8);
await L.call(`draw launch ${id} 100000000 micro-USDC above the cap (expect STREAM_CAP)`, creator, A.core, 'draw', { launch_id: id, amount: '100000000' }, { gas: L.tgas(100), expectFail: true });
await L.call(`draw launch ${id} by a non-recipient (expect R_NOT_AUTHORIZED)`, KEEPER, A.core, 'draw', { launch_id: id, amount: '1' }, { gas: L.tgas(100), expectFail: true });
await L.sleep(5);
const after = await views('after', CLAIMANTS);
console.log('invariants all_ok before', before.get_invariants.all_ok, 'after', after.get_invariants.all_ok);
