// Proves the R_GAS guard live on core3 (NEAR TESTNET, play money): create_trial with 150 Tgas must be refused with R_GAS before any state change.
// The probe checks that no launch was created, the symbol stays unused and the creator's balance is back (deposit refunded). The caller then runs
// seed.mjs (300 Tgas) with the same creator: if that works, the refusal did not lock the creator. Writes evidence/testnet-core3/rgas-probe.json.
//   node rgas-probe.mjs <creator name, e.g. creator-a> <SYMBOL> [Tgas, default 150]
import { L, A, writeJson } from './common.mjs';
const [name, sym, tg = '150'] = process.argv.slice(2);
if (!name || !sym) { console.error('usage: rgas-probe.mjs <creator> <SYMBOL> [Tgas]'); process.exit(64); }
const creator = `${name}.${A.owner}`;
const params = { symbol: sym, name: `${sym} Test Token`, total_supply_whole: 1000000000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500, hard_cap: '1000000000', soft_cap: '350000000', min_buy: '20000000', wallet_bps: 200, min_funders: 10, open_delay_secs: 0, commit_secs: 200, tail_secs: 30, stream_days: 30 };
const need = await L.view(A.core, 'required_deposit', { params });
let n = 1; while ((await L.view(A.core, 'get_state', { launch_id: String(n) })) !== null) n++;
const before = await L.balanceRawNear(creator);
const r = await L.call(`R_GAS probe: create_trial ${sym} with ${tg} Tgas`, creator, A.core, 'create_trial', { params, stream_recipient: null, genesis: null }, { gas: L.tgas(Number(tg)), deposit: need, expectFail: true });
await L.sleep(4);
let m = 1; while ((await L.view(A.core, 'get_state', { launch_id: String(m) })) !== null) m++;
const after = await L.balanceRawNear(creator);
const out = { creator, symbol: sym, tgas: Number(tg), deposit_yocto: need, tx: r.tx, success: r.success, rule_codes: r.rule_codes, failures: r.failures, error: r.error, next_free_launch_id_before: n, next_free_launch_id_after: m, creator_near_before: before, creator_near_after: after };
console.log(JSON.stringify(out, null, 2));
writeJson('rgas-probe.json', out);
process.exit(r.rule_codes.includes('R_GAS') && !r.success && m === n ? 0 : 1);
