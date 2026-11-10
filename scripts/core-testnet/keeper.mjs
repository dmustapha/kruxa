// Keeper (node backend of scripts/keeper.sh, used when near-cli-rs is not installed): the permissionless calls for one launch, in the only
// order that works. TESTNET ONLY. Waits for the phase Ready, calls settle, pages until nothing is unsettled, then the tail calls.
//   node keeper.mjs <launch_id> [--dry-run]       signer: keeper.<root> (created with 0.3 NEAR on first use)
import { L, A, writeJson } from './common.mjs';

const id = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!id || !/^\d+$/.test(id)) { console.error('usage: keeper.mjs <launch_id> [--dry-run]'); process.exit(64); }
const KEEPER = `keeper.${A.owner}`;
const args = { launch_id: id };
const steps = [['settle', args]];
const tail = ['sweep_residue', 'consolidate', 'pay_launch_fee', 'pay_relay_fees'];

if (dry) {
  for (const [m, a] of steps) console.log(`near contract call-function as-transaction ${A.core} ${m} json-args '${JSON.stringify(a)}' ... sign-as ${KEEPER}`);
  console.log('settle_positions_page {launch_id, from_seq: 0, limit: 25} repeated until positions_unsettled is 0');
  for (const m of tail) console.log(`${m} ${JSON.stringify(args)}`);
  process.exit(0);
}
await L.ensureAccount(KEEPER, A.owner, 0.3);
// every call reserves its gas up front at the testnet gas price (100 Tgas is about 0.1 NEAR): keep the keeper at or above 0.4 NEAR
if ((await L.balanceRawNear(KEEPER)) < 0.4) { const r = await (await L.acct(A.owner)).sendMoney(KEEPER, 5n * 10n ** 23n); console.log(`topped up keeper tx=${r.transaction.hash}`); }
const FROM = process.env.KEEPER_FROM; // resume: skip every step before this method (settle, settle_positions_page, sweep_residue, ...)
const log = [];
const run = async (method, a) => { const r = await L.call(`keeper ${id}: ${method}`, KEEPER, A.core, method, a, { gas: L.tgas(method === 'consolidate' ? 250 : 100) }); log.push({ method, tx: r.tx, success: r.success, value: r.value, rule_codes: r.rule_codes }); return r; };

for (let i = 0; i < 120; i++) {
  const st = await L.view(A.core, 'get_state', args);
  if (st.phase === 'Ready' || st.settlement || st.status !== 'Open') break;
  if (i === 0) console.log(`waiting for the walk tail to end (phase ${st.phase})`);
  await L.sleep(5);
}
const order = ['settle', 'settle_positions_page', ...tail];
const skip = (m) => FROM && order.indexOf(m) < order.indexOf(FROM);
if (!skip('settle')) await run('settle', args);
await L.sleep(5); // the optimistic view can lag the settle receipt on another RPC node
let seq = 0;
for (;;) {
  const st = await L.view(A.core, 'get_state', args);
  if (skip('settle_positions_page') || !st.positions_unsettled || Number(st.positions_unsettled) === 0 || seq > 600) break;
  await run('settle_positions_page', { launch_id: id, from_seq: seq, limit: 25 });
  seq += 25;
}
for (const m of tail) if (!skip(m)) await run(m, args);
const final = await L.view(A.core, 'get_state', args);
console.log(`final status ${final.status}, positions_unsettled ${final.positions_unsettled}, residue_swept ${final.residue_swept}`);
writeJson(`keeper-${id}.json`, { launch_id: id, core: A.core, keeper: KEEPER, at: new Date().toISOString(), calls: log, final_status: final.status, positions_unsettled: final.positions_unsettled, residue_swept: final.residue_swept });
