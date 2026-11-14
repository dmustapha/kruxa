// TESTNET ONLY (play money). Refunds every holder of FAILED launches in batches of 4 (permissionless claim_refund_batch by the keeper) and dissolves them.
//   KXI_CORE=core8.<root> node refund-dissolve.mjs <launch_id> [<launch_id> ...]
// Used after a swarm run whose trial failed, so its funds stop counting against the global cap. Keys come from ~/.kruxa-secrets via lib.mjs, never printed.
import { L, A } from './common.mjs';

const ids = process.argv.slice(2);
if (!ids.length || ids.some((i) => !/^\d+$/.test(i))) { console.error('usage: refund-dissolve.mjs <launch_id> ...'); process.exit(64); }
const KEEPER = `keeper.${A.owner}`;
for (const lid of ids) {
  const st0 = await L.view(A.core, 'get_state', { launch_id: lid });
  if (!st0 || !String(st0.status).startsWith('Failed')) { console.log(`launch ${lid}: status ${st0 && st0.status}, not Failed: skipped`); continue; }
  const rows = await L.view(A.core, 'list_positions', { launch_id: lid, from_seq: 0, limit: 50 });
  const holders = rows.map((r) => r.holder).filter(Boolean);
  for (let i = 0; i < holders.length; i += 4) {
    await L.call(`claim_refund_batch launch ${lid} (${holders.slice(i, i + 4).length} holders, keeper)`, KEEPER, A.core, 'claim_refund_batch', { launch_id: lid, holders: holders.slice(i, i + 4) }, { gas: L.tgas(300) });
  }
  await L.sleep(10);
  const st = await L.view(A.core, 'get_state', { launch_id: lid });
  console.log(`launch ${lid}: positions_live after refunds ${st.positions_live}`);
  await L.call(`dissolve launch ${lid} (every refund cleared)`, KEEPER, A.core, 'dissolve', { launch_id: lid }, { gas: L.tgas(100) });
  await L.sleep(5);
  const st2 = await L.view(A.core, 'get_state', { launch_id: lid });
  const inv = await L.view(A.core, 'get_invariants', { launch_id: lid });
  console.log(`launch ${lid}: status ${st2.status}, invariants all_ok ${inv.all_ok}`);
}
const cfg = await L.view(A.core, 'get_config', {});
console.log('global_held now', cfg.global_held);
