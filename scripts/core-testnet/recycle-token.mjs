// Recycles the NEAR launch token of a REHEARSAL launch (D or E in evidence/testnet-core3/launches.json): deletes the mock FT account that this run
// created and sends its storage balance to the root, so the next rehearsal launch can be funded without dipping into the 2 NEAR reserve.
// Refuses every other account (A, B, C and everything that pre-existed are never touched). TESTNET only.
//   node recycle-token.mjs D
import { L, A, readJson } from './common.mjs';
const which = process.argv[2];
if (!['D', 'E', 'F'].includes(which || '')) { console.error('usage: recycle-token.mjs D|E|F (rehearsal launches only)'); process.exit(64); }
const rec = readJson('launches.json', {})[which];
if (!rec) throw new Error(`launch ${which} is not in launches.json`);
const token = rec.token;
if (!new RegExp(`^kxc[def]\\.${A.factory.replace(/\./g, '\\.')}$`).test(token)) throw new Error(`refusing to delete ${token}`);
const g = await L.view(A.core, 'get_genesis', { launch_id: String(rec.id) });
if (!g || g.status !== 'Confirmed') throw new Error(`launch ${rec.id} genesis is ${g && g.status}, not Confirmed: not recycling yet`);
const before = await L.balanceRawNear(A.owner);
const out = await (await L.acct(token)).deleteAccount(A.owner);
L.append('txlog.jsonl', { step: `recycle: delete rehearsal token ${token}, balance to root`, signer: token, contract: token, method: 'DeleteAccount', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
console.log(`deleted ${token} tx=${out.transaction.hash}; root ${before.toFixed(3)} -> ${(await L.balanceRawNear(A.owner)).toFixed(3)} NEAR`);
