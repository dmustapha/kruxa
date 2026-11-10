// After a PASS launch is settled and consolidated (keeper.sh): hands the LP bucket to the market (open_market), then a trader buys 20 USDC,
// claims what the market owed it when the token payout hit an unregistered account, buys again, sells half back, and checks the identities.
//   node market-flow.mjs <launch_id>        TESTNET only; the trader is buyer.<root>; the pool is on market3.<root>
import { L, A, writeJson, readJson } from './common.mjs';

const id = process.argv[2];
if (!id || !/^\d+$/.test(id)) { console.error('usage: market-flow.mjs <launch_id>'); process.exit(64); }
const TRADER = `buyer.${A.owner}`;
const KEEPER = `keeper.${A.owner}`;
const args = { launch_id: id };
const out = { launch_id: id, market: A.market, trader: TRADER, steps: [] };
const step = async (label, signer, contract, method, a, opts) => { const r = await L.call(`market ${id}: ${label}`, signer, contract, method, a, opts); out.steps.push({ label, tx: r.tx, success: r.success, codes: r.rule_codes }); return r; };

const st = await L.view(A.core, 'get_state', args);
if (st.status !== 'Passed') throw new Error(`launch ${id} is ${st.status}, not Passed`);
const token = st.token;
await step('open_market (permissionless)', KEEPER, A.core, 'open_market', args, { gas: L.tgas(300) });
await L.sleep(4);
const pool = await L.view(A.market, 'get_pool', args);
if (!pool || pool.state !== 'Open') throw new Error('pool is not Open after open_market');
out.pool_after_open = { q: pool.q, t: pool.t, state: pool.state };

const buyMsg = JSON.stringify({ v: 1, op: 'buy', launch_id: id, min_out: '1' });
await step('mint 100 USDC to the trader (mock USDC)', A.owner, A.usdc, 'mint', { account_id: TRADER, amount: '100000000' }, { gas: L.tgas(30) });
const buy = (label) => step(label, TRADER, A.usdc, 'ft_transfer_call', { receiver_id: A.market, amount: '20000000', msg: buyMsg }, { gas: L.tgas(100), deposit: '1' });
await buy('buy 20 USDC (token payout to an unregistered trader is parked as owed)');
if (!(await L.view(token, 'storage_balance_of', { account_id: TRADER }))) await step('register the trader on the launch token', TRADER, token, 'storage_deposit', { account_id: TRADER }, { gas: L.tgas(30), deposit: L.yocto('0.00125') });
await step('claim_owed (the parked buy payout)', TRADER, A.market, 'claim_owed', { token_id: token }, { gas: L.tgas(100) });
await buy('buy 20 USDC again (registered now)');
const held = BigInt(await L.view(token, 'ft_balance_of', { account_id: TRADER }));
await step('sell half back', TRADER, token, 'ft_transfer_call', { receiver_id: A.market, amount: (held / 2n).toString(), msg: JSON.stringify({ v: 1, op: 'sell', launch_id: id, min_out: '1' }) }, { gas: L.tgas(100), deposit: '1' });
out.pool_invariants = await L.view(A.market, 'pool_invariants', args);
out.market_invariants = await L.view(A.market, 'get_invariants', {});
out.pool_final = await L.view(A.market, 'get_pool', args);
console.log(JSON.stringify({ pool_invariants: out.pool_invariants, market_invariants: out.market_invariants }));
const book = readJson('market-flows.json', {}); book[id] = out; writeJson('market-flows.json', book);
