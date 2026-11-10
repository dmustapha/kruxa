// Round 2 probes against the REAL token factory token.primitives.testnet (TESTNET, throwaway account, play money).
//   node real-factory-probe.mjs gas        create_token at 80 Tgas (expect fail) then at 110 Tgas (the core's new number; expect ok)
//   node real-factory-probe.mjs n04 <sym>  storage_deposit(registration_only) twice for the same account on <sym>.token.primitives.testnet
import { L, A } from './common.mjs';
import { writeJson, readJson } from './common.mjs';

const REAL = 'token.primitives.testnet';
const PROBE = `probe2.${A.owner}`;
const mode = process.argv[2];
const sym = process.argv[3];
const N_TOTAL = '1000000000000000';
const rec = readJson('real-factory-probe.json', { network: 'NEAR TESTNET', factory: REAL, runs: [] });

async function bal(a) { return L.balanceRawNear(a); }
async function createToken(symbol, tg, expectFail) {
  const b0 = await bal(PROBE);
  const r = await L.call(`real factory create_token ${symbol} at ${tg} Tgas`, PROBE, REAL, 'create_token',
    { args: { owner_id: PROBE, total_supply: N_TOTAL, metadata: { spec: 'ft-1.0.0', name: symbol, symbol, decimals: 6 } } },
    { deposit: L.yocto('0.06'), gas: L.tgas(tg), expectFail });
  const b1 = await bal(PROBE);
  const run = { probe: 'create_token', symbol, prepaid_tgas: tg, success: r.success, tx: r.tx, receipts: r.receipts, failures: r.failures, token: `${symbol.toLowerCase()}.${REAL}`, probe_balance_change_near: +(b1 - b0).toFixed(6) };
  rec.runs.push(run);
  return run;
}

if (!(await L.exists(PROBE))) await L.ensureAccount(PROBE, A.owner, 0.5);
if (mode === 'gas') {
  console.log(JSON.stringify(await createToken('KXR2G80', 80, true)));
  console.log(JSON.stringify(await createToken('KXR2G110', 110, false)));
} else if (mode === 'n04') {
  const token = `${sym.toLowerCase()}.${REAL}`;
  const target = A.treasury; // an existing account of ours, unregistered on the token
  const before = await L.view(token, 'storage_balance_of', { account_id: target });
  const out = [];
  for (const n of [1, 2]) {
    const b0 = await bal(PROBE);
    const r = await L.call(`n04 storage_deposit #${n} registration_only for ${target} on ${token}`, PROBE, token, 'storage_deposit',
      { account_id: target, registration_only: true }, { deposit: L.yocto('0.00125'), gas: L.tgas(30) });
    const b1 = await bal(PROBE);
    out.push({ n, tx: r.tx, success: r.success, receipts: r.receipts, probe_balance_change_near: +(b1 - b0).toFixed(6), gas_burnt_near: r.gas_burnt_near });
  }
  const after = await L.view(token, 'storage_balance_of', { account_id: target });
  rec.runs.push({ probe: 'n04', token, target, before, deposits: out, after });
  console.log(JSON.stringify(rec.runs.at(-1)));
} else throw new Error('mode gas | n04 <sym>');
writeJson('real-factory-probe.json', rec);
