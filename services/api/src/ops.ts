import { ApiError, all, asOf, intParam, one, parseId, sourceOf, storeSource } from "./common.ts";
import type { Ctx, Json, Row } from "./common.ts";
import { eventRef, genesisOf } from "./queries.ts";

type Q = URLSearchParams;

function flag(ctx: Ctx, k: string): Json | null {
  const r = one(ctx.store, "SELECT v FROM flags WHERE k = ?", k);
  return r ? (JSON.parse(String(r.v)) as Json) : null;
}

function firstBlock(ctx: Ctx): number | null {
  const r = one(ctx.store, "SELECT MIN(block_height) AS h FROM events");
  return r?.h === null || r?.h === undefined ? null : Number(r.h);
}

/** A freeze auto-expires to paused (EVENTS.md `frozen`), so the effective state after `until` is `paused`. */
function pauseView(ctx: Ctx, k: string): Json {
  const f = flag(ctx, k);
  if (!f) return { state: "live", effective_state: "live", observed: false, by: null, until: null, since: null };
  const state = String(f.state);
  const until = typeof f.until === "number" ? f.until : null;
  const effective = state === "frozen" && until !== null && ctx.now() >= until ? "paused" : state;
  return { state, effective_state: effective, observed: true, by: f.by ?? null, until, since: f.at };
}

function capView(ctx: Ctx, k: string): Json {
  const f = flag(ctx, k);
  return f ? { value: f.value ?? null, queued: f.queued ?? null, changed_at: f.changed_at ?? null, observed: true } : { value: null, queued: null, changed_at: null, observed: false };
}

function solvencyJson(r: Row): Json {
  const leg = (p: string): Json | null => (r[`${p}_balance`] === null ? null : { balance: r[`${p}_balance`], liability: r[`${p}_liability`], ok: Number(r[`${p}_ok`]) === 1 });
  return {
    at: r.at, time: Number(r.time), ok: Number(r.ok) === 1, intents_alert: Number(r.intents_alert) === 1, native: leg("native"), intents: leg("intents"),
    block_height: Number(r.block_height), receipt_id: r.receipt_id, source: r.source,
  };
}

function upgradeJson(r: Row): Json {
  return {
    code_hash: r.code_hash, status: r.status, queued_at: Number(r.queued_at), effective_at: r.effective_at, resolved_at: r.resolved_at, resolved_by: r.resolved_by,
    block_height: Number(r.block_height), source: r.source,
  };
}

function haltJson(r: Row): Json {
  return {
    launch_id: String(r.launch_id), halted: Number(r.halted) === 1, reason: r.reason, halted_by: r.halted_by, halted_at: r.halted_at, resumed_at: r.resumed_at,
    halt_count: Number(r.halt_count), source: r.source,
  };
}

function forceResolveJson(r: Row): Json {
  return {
    launch_id: String(r.launch_id), amount: r.amount, ok: Number(r.ok) === 1, state: r.state, queued_at: r.queued_at, effective_at: r.effective_at,
    executed_at: r.executed_at, evidence: r.evidence, block_height: Number(r.block_height), source: r.source,
  };
}

function owedJson(r: Row): Json {
  const balance = BigInt(String(r.credited)) - BigInt(String(r.claimed));
  return { scope: r.scope, account: r.account, token: r.token, credited: r.credited, claimed: r.claimed, balance: (balance < 0n ? 0n : balance).toString(), updated_at: Number(r.updated_at), source: r.source };
}

/** GET /api/ops/status: everything the status page and the operator strip need in one read. */
export function opsStatus(ctx: Ctx): Json {
  const now = ctx.now();
  const market = flag(ctx, "state:market");
  const latest = one(ctx.store, "SELECT * FROM solvency_reports ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1");
  const pending = one(ctx.store, "SELECT * FROM upgrades WHERE status = 'queued' ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1");
  const halted = all(ctx.store, "SELECT launch_id FROM halts WHERE halted = 1 ORDER BY launch_id").map((r) => String(r.launch_id));
  const owed = all(ctx.store, "SELECT * FROM owed").map(owedJson).filter((o) => o.balance !== "0");
  const nearOwed = owed.filter((o) => o.token === "NEAR").reduce((a, o) => a + BigInt(String(o.balance)), 0n);
  const sources = all(ctx.store, "SELECT source FROM events ORDER BY seq DESC LIMIT 1");
  return {
    core: pauseView(ctx, "state:core"), launcher: pauseView(ctx, "state:launcher"),
    market: { paused: market ? market.paused === true : false, observed: market !== null, by: market?.by ?? null, since: market?.at ?? null },
    genesis: { paused: flag(ctx, "state:genesis")?.paused === true, relayer: flag(ctx, "genesis_relayer")?.account ?? null },
    market_account: { core: flag(ctx, "market_account:core")?.account ?? null, launcher: flag(ctx, "market_account:launcher")?.account ?? null },
    creator_gate: { core_open: flag(ctx, "beta:core") !== null, launcher_open: flag(ctx, "beta:launcher") !== null },
    caps: { global: capView(ctx, "cap:global"), launch: capView(ctx, "cap:launch") },
    pending_upgrade: pending ? upgradeJson(pending) : null,
    halted_launches: halted,
    force_resolves_queued: Number(one(ctx.store, "SELECT COUNT(*) AS n FROM force_resolves WHERE state = 'queued'")?.n),
    owed: { near_total_yocto: nearOwed.toString(), open_balances: owed.length },
    solvency: latest ? { ...solvencyJson(latest), age_s: Math.max(0, now - Number(latest.time)) } : null,
    since_block: firstBlock(ctx), basis: "folds of indexed events only; a state with observed=false means no event of that kind was indexed, not that the contract was checked",
    as_of: asOf(ctx.store), source: sources.length ? sourceOf(ctx.store, sources) : storeSource(ctx.store),
  };
}

export function opsUpgrades(ctx: Ctx, q: Q): Json {
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const rows = all(ctx.store, "SELECT * FROM upgrades ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT ?", limit);
  const pending = one(ctx.store, "SELECT * FROM upgrades WHERE status = 'queued' ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1");
  return { pending: pending ? upgradeJson(pending) : null, items: rows.map(upgradeJson), as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows) };
}

export function opsHalts(ctx: Ctx, q: Q): Json {
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const active = q.get("active");
  if (active !== null && active !== "true" && active !== "false") throw new ApiError(400, "bad_param", "active must be true or false");
  const rows = all(ctx.store, "SELECT * FROM halts WHERE (? IS NULL OR halted = ?) ORDER BY COALESCE(resumed_at, halted_at) DESC, launch_id DESC LIMIT ?",
    active === null ? null : 1, active === "true" ? 1 : 0, limit);
  return { items: rows.map(haltJson), as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows) };
}

export function opsForceResolves(ctx: Ctx, q: Q): Json {
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const state = q.get("state");
  if (state !== null && state !== "queued" && state !== "executed") throw new ApiError(400, "bad_param", "state must be queued or executed");
  const rows = all(ctx.store, "SELECT * FROM force_resolves WHERE (? IS NULL OR state = ?) ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT ?", state, state, limit);
  return {
    items: rows.map(forceResolveJson),
    basis: "the event names the launch, amount and ok flag but not the leg kind or holder, so an execution closes the oldest queued entry with the same three values",
    as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows),
  };
}

export function opsSolvency(ctx: Ctx, q: Q): Json {
  const limit = intParam(q.get("limit"), "limit", 1, 200, 20);
  const rows = all(ctx.store, "SELECT * FROM solvency_reports ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT ?", limit);
  const items = rows.map(solvencyJson);
  return { latest: items[0] ?? null, failing: items.filter((i) => i.ok === false).length, items, as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows) };
}

export function opsOwed(ctx: Ctx, q: Q): Json {
  const scope = q.get("scope");
  if (scope !== null && scope !== "core" && scope !== "market" && scope !== "launcher") throw new ApiError(400, "bad_scope", "scope must be core, market or launcher");
  const account = q.get("account");
  const all_ = q.get("outstanding") === "false";
  const rows = all(ctx.store, "SELECT * FROM owed WHERE (? IS NULL OR scope = ?) AND (? IS NULL OR account = ?) ORDER BY scope, account, token", scope, scope, account, account);
  const items = rows.map(owedJson).filter((o) => all_ || o.balance !== "0");
  return { items, as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows) };
}

const CUSTODY_EVENTS = ["creator_alloc_claimed", "tokens_swept", "token_delivery_refused", "stream_lengthened", "refund_batch", "refund_route_set", "orphan_credit_refused", "deposit_rejected_refundable"];
const FAILED_LEG_KINDS = ["AllocClaim", "Sweep", "Claim", "Stream", "RefundNative", "RefundIntents"];

function launchEvents(ctx: Ctx, id: number, names: string[]): Json[] {
  const rows = all(ctx.store, `SELECT * FROM events WHERE json_extract(data, '$.launch_id') = ? AND event IN (${names.map(() => "?").join(",")}) ORDER BY block_height, ord, log_index LIMIT 500`, String(id), ...names);
  return rows.map((r) => ({ ...eventRef(r), data: JSON.parse(String(r.data)) as unknown }));
}

function streamView(l: Row, c: Row | undefined): Json {
  const days = l.stream_days === null ? null : Number(l.stream_days);
  const changedAt = c?.stream_changed_at ?? null;
  const endNs = c?.stream_end_ns ?? null;
  return {
    total: l.stream_total, drawn: l.stream_drawn, planned_days: days, lengthened: Number(c?.stream_lengthened ?? 0),
    end_at: endNs === null ? (l.settled_at !== null && days !== null ? Number(l.settled_at) + days * 86400 : null) : Number(BigInt(String(endNs)) / 1_000_000_000n),
    unlocked_at_change: c?.stream_unlocked_at_change ?? null, changed_at: changedAt,
  };
}

/** GET /api/launch/{id}/custody: where the launch's tokens and refunds stand after PASS or FAIL (creator allocation, sweeps, refusals, refunds, stream). */
export function launchCustody(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", id);
  if (!l) throw new ApiError(404, "not_found", `no launch ${id}`);
  const c = one(ctx.store, "SELECT * FROM launch_custody WHERE launch_id = ?", id);
  const pool = one(ctx.store, "SELECT token, market FROM pools WHERE launch_id = ?", id);
  const failed = all(ctx.store, `SELECT * FROM payouts WHERE launch_id = ? AND ok = 0 AND kind IN (${FAILED_LEG_KINDS.map(() => "?").join(",")}) ORDER BY block_height, ord, log_index`, id, ...FAILED_LEG_KINDS);
  const n = (k: string): number => Number(c?.[k] ?? 0);
  return {
    launch_id: String(id), mode: l.mode, token: pool?.token ?? null, payout_recipient: l.payout_recipient, status: l.status, halted: one(ctx.store, "SELECT 1 AS x FROM halts WHERE launch_id = ? AND halted = 1", id) !== undefined,
    creator_allocation: { claimed: c?.alloc_claimed ?? "0", recipient: l.payout_recipient },
    sweep: { swept: c?.swept ?? "0", mode: c?.sweep_mode ?? null },
    stream: streamView(l, c),
    deliveries: { refused: n("delivery_refusals"), failed_legs: failed.map((r) => ({ kind: r.kind, amount: r.amount, time: Number(r.time), receipt_id: r.receipt_id })) },
    refunds: { batches: n("refund_batches"), handled: n("refund_handled"), paid: n("refund_paid"), routed_to_intents: n("refund_routes") },
    orphan_credits_refused: n("orphan_refusals"), deposits_refused_refundable: n("rejected_refundable"),
    events: launchEvents(ctx, id, CUSTODY_EVENTS),
    basis: "folds of indexed events only; token balances at rest come from the core views, not from this service",
    as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l, ...(c ? [c] : [])]),
  };
}

const GENESIS_EVENTS = ["genesis_committed", "genesis_confirmed", "genesis_aborted", "genesis_reopened", "f0_message_registered", "f0_sign_requested", "attest_log"];

/** GET /api/launch/{id}/genesis: current genesis state plus the full attempt history (commit, abort and reopen events in order). */
export function launchGenesis(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", id);
  if (!l) throw new ApiError(404, "not_found", `no launch ${id}`);
  if (l.mode === "instant") throw new ApiError(404, "not_found", `launch ${id} is an instant launch and has no genesis`);
  return { launch_id: String(id), ...genesisOf(ctx, l), history: launchEvents(ctx, id, GENESIS_EVENTS), as_of: asOf(ctx.store) };
}
