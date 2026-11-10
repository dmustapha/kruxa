// Read-only snapshot of core3 (NEAR TESTNET): view_code sha256, get_state and get_invariants for the given launch ids.
//   node state-snapshot.mjs <out file name, written under evidence/testnet-core3/> <id> [id ...]
import { L, A, onChainSha, writeJson } from './common.mjs';
const [out, ...ids] = process.argv.slice(2);
if (!out || !ids.length) { console.error('usage: state-snapshot.mjs <out.json> <launch id> ...'); process.exit(64); }
const snap = { core: A.core, at: new Date().toISOString(), view_code_sha256: await onChainSha(A.core), launches: {} };
for (const id of ids) {
  snap.launches[id] = {
    state: await L.view(A.core, 'get_state', { launch_id: id }),
    invariants: await L.view(A.core, 'get_invariants', { launch_id: id }),
  };
}
snap.root_near = await L.balanceRawNear(A.owner);
snap.core_near = await L.balanceRawNear(A.core);
writeJson(out, snap);
console.log(`code ${snap.view_code_sha256}\nroot ${snap.root_near} core ${snap.core_near}`);
for (const [id, s] of Object.entries(snap.launches)) console.log(id, s.state && s.state.status, 'all_ok', s.invariants && s.invariants.all_ok);
