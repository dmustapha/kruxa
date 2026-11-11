#!/usr/bin/env node
// SW-2: replay one recorded swarm run (swarm/runs/run-<seed>.json) as REAL calls on NEAR TESTNET (play money) against core3.
// 16 throwaway sub-accounts (sw-<agent id>.<root>) act as the 16 scripted agents; the core contract is the real one; the verdict, totals and
// per-agent positions are read back from its views and compared with the recorded run. TESTNET ONLY.
//
//   node scripts/swarm-testnet.mjs [--seed N] [--round-secs S]                 PLAN ONLY (default): prints every step, sends nothing, needs no keys
//   node scripts/swarm-testnet.mjs [--seed N] [--round-secs S] --yes           execute (also needs NEAR_ENV=testnet)
//   node scripts/swarm-testnet.mjs --setup-only --yes                          only create + fund + register the 16 sub-accounts
//
// Same stack and key handling as scripts/core-testnet/: root kxi-root-1108.testnet, core core3.<root>, keys in ~/.kruxa-secrets/instant-testnet/
// (mode 600, never printed, never in the repo; the 16 new throwaway keys are generated there). Evidence goes to evidence/swarm-testnet/.
// Funds come only from the existing throwaway testnet root (never below 1 NEAR) and are reported; nothing is lent unless you run core-lend.mjs.
// Output ends with "SWARM-TESTNET GREEN" (exit 0) or "SWARM-TESTNET RED" (exit 1) plus the transaction count. A blocked preflight is RED with
// 0 transactions. A slow RPC can push a commit past commit_end; that shows up as RED, never as a pass.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(REPO, 'evidence', 'swarm-testnet');
const ROOT_RESERVE_NEAR = 1;
const TOKEN_NEAR = 1.8; // a mock FT account at <symbol>.<factory> (160 kB of code at 1e-5 NEAR/byte plus gas), same as seed.mjs
const CREATOR_NAME = 'creator-a';
const KEEPER_NAME = 'keeper';
const OPEN_DELAY_SECS = 30; // lets the token creation callback finish before round 0

// ---- args and guards -----------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { seed: 1, roundSecs: 10, yes: false, setupOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--round-secs') o.roundSecs = Number(argv[++i]);
    else if (a === '--yes') o.yes = true;
    else if (a === '--setup-only') o.setupOnly = true;
    else { console.error('usage: swarm-testnet.mjs [--seed N] [--round-secs S] [--yes] [--setup-only]'); process.exit(64); }
  }
  if (!Number.isInteger(o.seed) || !(o.roundSecs >= 1)) { console.error('bad --seed or --round-secs'); process.exit(64); }
  return o;
}
function guardTestnet(opts) {
  const root = process.env.KXI_ROOT || 'kxi-root-1108.testnet';
  const rpc = process.env.KXI_RPC || 'https://test.rpc.fastnear.com';
  if (!root.endsWith('.testnet')) refuse(`root ${root} is not a .testnet account`);
  if (/mainnet|rpc\.mainnet|(^|\/\/)rpc\.near\.org|(^|\/\/)near\.org/i.test(rpc)) refuse(`RPC ${rpc} looks like mainnet`);
  if (opts.yes && process.env.NEAR_ENV !== 'testnet') refuse('to send, set NEAR_ENV=testnet');
  process.env.KXI_ROOT = root;
  process.env.KXI_EVID = EVID_DIR;
  return root;
}
function refuse(msg) { console.error(`refusing: ${msg} (testnet only)`); process.exit(1); }

// ---- plan: everything derived from the recorded run -----------------------------------------------------------------------------
function buildPlan(opts, root) {
  const file = path.join(REPO, 'swarm', 'runs', `run-${opts.seed}.json`);
  if (!fs.existsSync(file)) { console.error(`no recorded run ${file} (seeds 1 to 3 are committed)`); process.exit(64); }
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const acct = (a) => `sw-${a.id.toLowerCase()}.${root}`;
  const t = run.trial;
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const symbol = process.env.SWARM_SYMBOL || `SW${opts.seed}T${stamp}`;
  const events = run.rounds.flatMap((r) => r.events.map((e) => ({ ...e, round: r.round, agent: run.agents[e.agent], who: acct(run.agents[e.agent]) })));
  const params = {
    symbol, name: `${symbol} Swarm Test`, total_supply_whole: 1_000_000_000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
    hard_cap: t.hard_cap, soft_cap: t.soft_cap, min_buy: t.min_buy,
    wallet_bps: 200, // the cap is max(hard_cap x 2 percent, 5 x min_buy), which must equal the recorded wallet_cap (checked below)
    min_funders: t.min_funders, open_delay_secs: OPEN_DELAY_SECS, commit_secs: t.commit_end_round * opts.roundSecs,
    tail_secs: (t.walk_end_round - t.commit_end_round) * opts.roundSecs, stream_days: 30,
  };
  const ruleCap = [(BigInt(t.hard_cap) * 200n) / 10000n, 5n * BigInt(t.min_buy)].reduce((m, v) => (v > m ? v : m));
  if (ruleCap !== BigInt(t.wallet_cap)) throw new Error('recorded wallet_cap does not follow the wallet_bps 200 rule');
  const last = run.rounds[run.rounds.length - 1];
  return { run, params, symbol, events, accounts: run.agents.map((a) => ({ id: a.id, name: acct(a), budget: a.budget, events: events.filter((e) => e.agent.id === a.id).length })), expect: { total: last.total_committed, funders: last.funders, settlement: run.settlement } };
}
function fundNear(account) { return Math.ceil((0.0125 + 0.004 * account.events) * 1000) / 1000; } // storage + one 100 Tgas gas reservation + burnt gas per call

function printPlan(plan, opts, core) {
  const rs = opts.roundSecs;
  console.log(`swarm-testnet PLAN ONLY (nothing is sent, no keys read): seed ${opts.seed}, ${plan.events.length} recorded events, ${plan.accounts.length} sub-accounts, round ${rs} s, core ${core}`);
  console.log('== setup (root signs; each account gets a fresh throwaway key saved under ~/.kruxa-secrets/instant-testnet/, never printed)');
  for (const a of plan.accounts) console.log(`  create ${a.name} with ${fundNear(a)} NEAR; usdc.storage_deposit; usdc.mint ${a.budget} micro-USDC`);
  console.log(`== create: ${CREATOR_NAME} creates token ${plan.symbol.toLowerCase()}.<factory> (mock FT) then create_trial ${plan.symbol} ${JSON.stringify(plan.params)}`);
  console.log(`== replay: each round fires at opens_at + (round + 0.5) x ${rs} s on the chain clock; same-round events go out in parallel`);
  for (const e of plan.events) console.log(`  round ${e.round}: ${e.who} ${e.action} ${e.amount} (recorded: ${e.result})`);
  console.log(`== read back: after walk_end ${KEEPER_NAME} calls settle + settle_positions_page; compare with total ${plan.expect.total}, funders ${plan.expect.funders}, verdict ${plan.expect.settlement.verdict}, settlement and 16 positions`);
  console.log('SWARM-TESTNET PLANNED (no transactions; not a pass)');
}

// ---- chain access (loaded only with --yes) --------------------------------------------------------------------------------------
let L, A, REPO_WASM;
let txCount = 0;
async function loadChain() {
  ({ L, A } = await import('./core-testnet/common.mjs'));
  REPO_WASM = ['KXI_MOCK_FT_WASM', 'MOCK_FT_WASM'].map((k) => process.env[k]).find(Boolean)
    || [path.join(REPO, 'target/near/mock_ft/mock_ft.wasm'), path.resolve(REPO, '../../../target/near/mock_ft/mock_ft.wasm')].find((p) => fs.existsSync(p));
}
async function send(step, signer, contract, method, args, gasTgas, deposit = '0') {
  const rec = await L.call(step, signer, contract, method, args, { gas: L.tgas(gasTgas), deposit });
  txCount++;
  return rec;
}
const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
async function sendNear(from, to, amount, step) {
  const out = await (await L.acct(from)).sendMoney(to, near(amount));
  L.append('txlog.jsonl', { step, signer: from, contract: to, method: 'Transfer', tx: out.transaction.hash, success: true, rule_codes: [], expected: 'ok', at: new Date().toISOString() });
  txCount++;
  console.log(`OK   ${step} tx=${out.transaction.hash}`);
}

// ---- preflight (read-only) --------------------------------------------------------------------------------------------------------
async function preflight(plan, opts, core) {
  const problems = [];
  const cfg = await L.view(core, 'get_config', {});
  const headroom = BigInt(cfg.global_cap) - BigInt(cfg.global_held);
  const rootBal = await L.balanceRawNear(A.owner);
  const need = await neededNear(plan, opts);
  const spare = rootBal - ROOT_RESERVE_NEAR;
  console.log(`preflight: ${core} global_cap ${cfg.global_cap} global_held ${cfg.global_held} headroom ${headroom}; trial hard_cap ${plan.params.hard_cap}; pause ${cfg.pause}`);
  console.log(`preflight: root ${rootBal.toFixed(3)} NEAR (reserve ${ROOT_RESERVE_NEAR}, spare ${spare.toFixed(3)}); needs ${need.total.toFixed(3)} NEAR (${need.parts})`);
  if (opts.setupOnly) { if (spare < need.setup) problems.push(`root spare ${spare.toFixed(3)} NEAR is below the ${need.setup.toFixed(3)} NEAR the sub-accounts need`); return problems; }
  if (cfg.pause !== 'None') problems.push(`core is paused (${cfg.pause})`);
  if (headroom < BigInt(plan.params.hard_cap)) problems.push(`GLOBAL CAP: headroom ${headroom} is below the recorded hard_cap ${plan.params.hard_cap}; create_trial is refused R_CAP_GLOBAL, and commits would stop at ${headroom} in any case`);
  if (!REPO_WASM && need.token > 0) problems.push('mock_ft.wasm not found (build it, or set KXI_MOCK_FT_WASM)');
  if (spare < need.total) problems.push(`FUNDS: root spare ${spare.toFixed(3)} NEAR is below the ${need.total.toFixed(3)} NEAR needed; short ${(need.total - spare).toFixed(3)} NEAR (lend with scripts/core-testnet/core-lend.mjs or recycle a rehearsal token, then rerun)`);
  return problems;
}
async function neededNear(plan, opts) {
  let setup = 0;
  for (const a of plan.accounts) if (!(await L.exists(a.name))) setup += fundNear(a);
  setup += 0.00125 * plan.accounts.length + 0.002 * plan.accounts.length; // usdc storage_deposit + root gas for create and mint calls
  if (opts.setupOnly) return { setup, token: 0, creator: 0, total: setup, parts: `sub-accounts ${setup.toFixed(3)}` };
  const token = (await L.exists(`${plan.symbol.toLowerCase()}.${A.factory}`)) ? 0 : TOKEN_NEAR;
  const deposit = Number(BigInt(await L.view(A.core, 'required_deposit', { params: plan.params })) / 10n ** 18n) / 1e6;
  const creator = `${CREATOR_NAME}.${A.owner}`;
  const short = Math.max(0, deposit + 0.05 - (await L.balanceRawNear(creator)));
  const total = setup + token + short;
  return { setup, token, creator: short, total, parts: `sub-accounts ${setup.toFixed(3)}, token ${token.toFixed(3)}, creator top-up ${short.toFixed(3)}` };
}

// ---- setup: accounts, funding, USDC -------------------------------------------------------------------------------------------------
async function setupAccounts(plan) {
  for (const a of plan.accounts) {
    if (!(await L.exists(a.name))) { await L.ensureAccount(a.name, A.owner, fundNear(a)); txCount++; }
    if (!(await L.view(A.usdc, 'storage_balance_of', { account_id: a.name }))) await send(`usdc.storage_deposit ${a.name}`, A.owner, A.usdc, 'storage_deposit', { account_id: a.name }, 30, L.yocto('0.00125'));
    await send(`usdc.mint ${a.budget} to ${a.name}`, A.owner, A.usdc, 'mint', { account_id: a.name, amount: a.budget }, 30);
  }
}

// ---- create the trial (same path as seed.mjs) -----------------------------------------------------------------------------------------
async function ensureToken(symbol) {
  const token = `${symbol.toLowerCase()}.${A.factory}`;
  if (await L.exists(token)) return token;
  const spare = (await L.balanceRawNear(A.factory)) - 1.05; // the factory's own code is staked
  if (spare < TOKEN_NEAR) await sendNear(A.owner, A.factory, TOKEN_NEAR - spare + 0.05, `top up ${A.factory} for token ${token}`);
  await L.ensureAccount(token, A.factory, TOKEN_NEAR); txCount++;
  await L.deployWasm(token, REPO_WASM, 'new', { owner_id: A.core, total_supply: '1000000000000000' }); txCount += 2;
  return token;
}
async function createTrial(plan) {
  const creator = `${CREATOR_NAME}.${A.owner}`;
  const token = await ensureToken(plan.symbol);
  const need = await L.view(A.core, 'required_deposit', { params: plan.params });
  const short = near(0.05) + BigInt(need) - BigInt((await (await L.net()).connection.provider.query({ request_type: 'view_account', finality: 'optimistic', account_id: creator })).amount);
  if (short > 0n) await sendNear(A.owner, creator, Number(short) / 1e24, `top up ${creator} for the trial deposit`);
  let id = 1;
  while ((await L.view(A.core, 'get_state', { launch_id: String(id) })) !== null) id++;
  const rec = await send(`create_trial ${plan.symbol} (swarm seed)`, creator, A.core, 'create_trial', { params: plan.params, stream_recipient: null, genesis: null }, 300, need);
  if (!rec.success) throw new Error(`create_trial failed: ${(rec.failures || [rec.error]).join(' ')}`);
  for (let i = 0; i < 40; i++) { const st = await L.view(A.core, 'get_state', { launch_id: String(id) }); if (st && st.status === 'Open') break; if (st && st.status === 'CreationFailed') throw new Error('creation failed'); await L.sleep(3); }
  return { id: String(id), token, create_tx: rec.tx };
}

// ---- replay ---------------------------------------------------------------------------------------------------------------------------
async function chainClockOffsetMs() {
  const b = await (await L.net()).connection.provider.block({ finality: 'optimistic' });
  return Date.now() - Number(BigInt(b.header.timestamp) / 1_000_000n);
}
function eventCall(e, lid) {
  if (e.action === 'commit') {
    const msg = JSON.stringify({ v: 1, op: 'contribute', launch_id: lid });
    return [A.usdc, 'ft_transfer_call', { receiver_id: A.core, amount: e.amount, msg }, 100];
  }
  return [A.core, 'walk', { launch_id: lid }, 100];
}
async function fireEvent(e, lid) {
  const [contract, method, args, tgas] = eventCall(e, lid);
  const r = await send(`round ${e.round} ${e.agent.id} ${e.action} ${e.amount} (recorded ${e.result})`, e.who, contract, method, args, tgas, '1');
  const matches = e.result === 'ok' ? r.success : r.rule_codes.includes(e.result);
  return { round: e.round, agent: e.agent.id, action: e.action, amount: e.amount, recorded: e.result, tx: r.tx, success: r.success, codes: r.rule_codes, matches };
}
async function replay(plan, lid, opts) {
  const charter = await L.view(A.core, 'get_charter', { launch_id: lid });
  const offset = await chainClockOffsetMs();
  const opensMs = Number(BigInt(charter.opens_at) / 1_000_000n) + offset;
  const rounds = [...new Set(plan.events.map((e) => e.round))];
  const results = [];
  for (const r of rounds) {
    const wait = opensMs + (r + 0.5) * opts.roundSecs * 1000 - Date.now();
    if (wait > 0) await L.sleep(wait / 1000);
    results.push(...await Promise.all(plan.events.filter((e) => e.round === r).map((e) => fireEvent(e, lid))));
  }
  return { results, walkEndMs: Number(BigInt(charter.walk_end) / 1_000_000n) + offset, charter };
}

// ---- settle and read back --------------------------------------------------------------------------------------------------------------
const check = (name, got, want) => ({ name, got: String(got), want: String(want), ok: String(got) === String(want) });
async function settleAndRead(plan, lid, walkEndMs) {
  const keeper = `${KEEPER_NAME}.${A.owner}`;
  const wait = walkEndMs + 4000 - Date.now();
  if (wait > 0) await L.sleep(wait / 1000);
  const before = await L.view(A.core, 'get_state', { launch_id: lid });
  const settle = await send(`keeper settle ${lid}`, keeper, A.core, 'settle', { launch_id: lid }, 100);
  await L.sleep(5);
  for (let seq = 0; seq < 600; seq += 25) {
    const st = await L.view(A.core, 'get_state', { launch_id: lid });
    if (!st.positions_unsettled || Number(st.positions_unsettled) === 0) break;
    await send(`keeper settle_positions_page ${lid} from ${seq}`, keeper, A.core, 'settle_positions_page', { launch_id: lid, from_seq: seq, limit: 25 }, 100);
  }
  return { before, settle, after: await L.view(A.core, 'get_state', { launch_id: lid }), settlement: await L.view(A.core, 'get_settlement', { launch_id: lid }), invariants: await L.view(A.core, 'get_invariants', { launch_id: lid }) };
}
async function compareAll(plan, lid, read, replayResults) {
  const exp = plan.expect, s = exp.settlement, checks = [];
  checks.push(check('replay: every event outcome equals the recorded result', replayResults.filter((r) => !r.matches).length, 0));
  checks.push(check('total_active before settle', read.before.total_active, exp.total));
  checks.push(check('active_funders before settle', read.before.active_funders, exp.funders));
  checks.push(check('verdict', read.after.status === 'Passed' ? 'PASS' : 'FAIL', s.verdict.startsWith('PASS') ? 'PASS' : 'FAIL'));
  if (s.passed) for (const [mine, theirs] of [['accepted', 'accepted'], ['launch_fee', 'launch_fee'], ['lp_quote', 'lp_quote'], ['stream', 'stream'], ['excess_pool', 'excess_refunded']]) checks.push(check(`settlement.${mine}`, read.settlement && read.settlement[mine], s[theirs]));
  checks.push(check('get_invariants all_ok', read.invariants && read.invariants.all_ok, true));
  for (const a of plan.run.agents) checks.push(...await comparePosition(plan, lid, a, s.passed));
  return checks;
}
async function comparePosition(plan, lid, agent, passed) {
  const name = `sw-${agent.id.toLowerCase()}.${A.owner}`;
  const p = await L.view(A.core, 'get_position', { launch_id: lid, holder: `near:${name}` });
  if (!p) return [check(`${agent.id} position exists`, 'none', agent.peak_commit === '0' ? 'none' : 'present')];
  const spend = passed ? agent.spend : '0';
  return [check(`${agent.id} spent`, p.spent, spend), check(`${agent.id} tokens_entitled`, p.tokens_entitled, passed ? agent.tokens : '0'), check(`${agent.id} bonus_entitled`, p.bonus_entitled, passed ? agent.bonus_tokens : '0')];
}

// ---- main ------------------------------------------------------------------------------------------------------------------------------------
function writeEvidence(name, obj) {
  fs.mkdirSync(EVID_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVID_DIR, name), JSON.stringify(obj, null, 2) + '\n');
}
function finish(result, reason) {
  console.log(`transactions sent: ${txCount}`);
  console.log(`SWARM-TESTNET ${result}${reason ? ` (${reason})` : ''}`);
  process.exit(result === 'RED' ? 1 : 0);
}
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = guardTestnet(opts);
  const plan = buildPlan(opts, root);
  const core = `core3.${root}`;
  if (!opts.yes) { printPlan(plan, opts, core); process.exit(0); }
  await loadChain();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const problems = await preflight(plan, opts, core);
  if (problems.length) { problems.forEach((p) => console.log(`BLOCKED: ${p}`)); writeEvidence(`preflight-seed${opts.seed}-${stamp}.json`, { seed: opts.seed, at: new Date().toISOString(), core, problems, sent: 0 }); finish('RED', 'preflight blocked, nothing sent'); }
  await setupAccounts(plan);
  if (opts.setupOnly) { console.log('setup done'); finish('SETUP-OK', 'setup only, not a swarm verdict'); }
  const launch = await createTrial(plan);
  console.log(`launch ${launch.id} on ${core}, token ${launch.token}`);
  const { results, walkEndMs, charter } = await replay(plan, launch.id, opts);
  const read = await settleAndRead(plan, launch.id, walkEndMs);
  const checks = await compareAll(plan, launch.id, read, results);
  checks.forEach((c) => console.log(`${c.ok ? 'MATCH   ' : 'MISMATCH'} ${c.name}: chain ${c.got}, recorded ${c.want}`));
  writeEvidence(`run-seed${opts.seed}-${stamp}.json`, { seed: opts.seed, core, launch, params: plan.params, charter, events: results, readback: read, checks, tx_count: txCount });
  finish(checks.every((c) => c.ok) ? 'GREEN' : 'RED', `${checks.filter((c) => c.ok).length} of ${checks.length} checks match`);
}
main().catch((e) => { console.error(String(e && e.stack || e)); finish('RED', 'aborted'); });
