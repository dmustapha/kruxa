import { cpOut, e12ToNumber, priceE12, quoteToNumber } from "../../indexer/src/price.ts";
import { INTERVAL_SECONDS } from "../../indexer/src/types.ts";
import { ApiError, WINDOW_24H, all, asOf, candleJson, decodeCursor, encodeCursor, intParam, intervalParam, lastPrice, launchSummary, one, parseId, sourceOf, storeSource, tradeJson, volume } from "./common.ts";
import type { Ctx, Json, Row } from "./common.ts";

const STAGES = new Set(["all", "new", "open", "closing", "passed", "failed"]);
const TABS = new Set(["all", "live", "walk", "trading", "passed", "failed"]);
const SORTS = new Set(["newest", "raised", "funders", "ending_soon", "volume_24h"]);

type Q = URLSearchParams;

export function health(ctx: Ctx): Json {
  const a = asOf(ctx.store);
  const tail = ctx.tail();
  const head = tail.headHeight;
  const lag = head !== null && a.block_height !== null ? Math.max(0, head - a.block_height) : null;
  const fixture = storeSource(ctx.store) === "fixture" || one(ctx.store, "SELECT 1 AS x FROM events WHERE source = 'fixture' LIMIT 1") !== undefined;
  const status = fixture ? "fixture" : lag !== null && lag > ctx.maxLagBlocks ? "stale" : tail.lastError ? "stale" : "ok";
  return {
    status, network: ctx.store.network, source: fixture ? "fixture" : "chain", data_source: ctx.dataSource, as_of: a, head_height: head, lag_blocks: lag,
    max_lag_blocks: ctx.maxLagBlocks, event_count: ctx.store.eventCount(),
    launch_count: Number(one(ctx.store, "SELECT COUNT(*) AS n FROM launches")?.n), trade_count: Number(one(ctx.store, "SELECT COUNT(*) AS n FROM trades")?.n),
    state_hash: ctx.store.stateHash(), last_error: tail.lastError, uptime_s: Math.floor(Date.now() / 1000) - ctx.startedAt,
  };
}

function sortLaunches(items: Json[], sort: string): Json[] {
  const num = (j: Json, k: string): number => Number(j[k] ?? 0);
  const big = (j: Json, k: string): bigint => BigInt(String(j[k] ?? "0"));
  const cmp: Record<string, (a: Json, b: Json) => number> = {
    newest: (a, b) => num(b, "created_at") - num(a, "created_at") || num(b, "launch_id") - num(a, "launch_id"),
    raised: (a, b) => (big(b, "total_active") > big(a, "total_active") ? 1 : big(b, "total_active") < big(a, "total_active") ? -1 : 0),
    funders: (a, b) => num(b, "funders") - num(a, "funders"),
    volume_24h: (a, b) => num(b, "volume_24h") - num(a, "volume_24h"),
    ending_soon: (a, b) => (a.walk_end === null ? Infinity : num(a, "walk_end")) - (b.walk_end === null ? Infinity : num(b, "walk_end")),
  };
  return items.sort(cmp[sort] ?? cmp.newest!);
}

export function launches(ctx: Ctx, q: Q): Json {
  const stage = q.get("stage") ?? "all";
  const sort = q.get("sort") ?? "newest";
  if (!STAGES.has(stage)) throw new ApiError(400, "bad_stage", "stage must be all, new, open, closing, passed or failed");
  if (!SORTS.has(sort)) throw new ApiError(400, "bad_sort", "unknown sort");
  const tab = q.get("tab") ?? "all";
  if (!TABS.has(tab)) throw new ApiError(400, "bad_tab", "tab must be all, live, walk, trading, passed or failed");
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const minRaised = q.get("min_raised");
  if (minRaised !== null && !/^[0-9]+$/.test(minRaised)) throw new ApiError(400, "bad_param", "min_raised must be an integer string");
  const needle = (q.get("q") ?? "").toLowerCase().slice(0, 64);
  const rows = all(ctx.store, "SELECT * FROM launches");
  let items = rows.map((r) => launchSummary(ctx, r));
  if (stage !== "all") items = items.filter((j) => j.stage === stage);
  if (tab !== "all") items = items.filter((j) => j.tab === tab);
  if (needle) items = items.filter((j) => `${j.name ?? ""} ${j.symbol} ${j.creator} ${j.payout_recipient} ${j.launch_id}`.toLowerCase().includes(needle));
  if (q.get("creator")) items = items.filter((j) => j.creator === q.get("creator"));
  if (q.get("has_market") === "true") items = items.filter((j) => j.has_market === true);
  if (minRaised !== null) items = items.filter((j) => BigInt(String(j.total_active)) >= BigInt(minRaised));
  sortLaunches(items, sort);
  const offset = decodeCursor<{ o: number }>(q.get("cursor"))?.o ?? 0;
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? encodeCursor({ o: offset + limit }) : null;
  return { items: page, next_cursor: next, total: items.length, as_of: asOf(ctx.store), source: sourceOf(ctx.store, page) };
}

function launchRow(ctx: Ctx, id: number): Row {
  const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", id);
  if (!l) throw new ApiError(404, "not_found", `no launch ${id}`);
  return l;
}

export function launchDetail(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = launchRow(ctx, id);
  const soft = l.soft_cap === null ? null : BigInt(String(l.soft_cap));
  const total = BigInt(String(l.total_active));
  const events = all(ctx.store, "SELECT event, block_height, receipt_id, log_index, time, source FROM events WHERE json_extract(data, '$.launch_id') = ? ORDER BY block_height, ord, log_index LIMIT 500", String(id));
  return {
    ...launchSummary(ctx, l), charter_hash: l.charter_hash, genesis: genesisOf(ctx, l),
    verdict_inputs: {
      total_active: l.total_active, funders: l.funders, soft_cap: l.soft_cap, min_funders: l.min_funders,
      margin_to_soft_cap: soft === null ? null : (total - soft).toString(), margin_funders: l.min_funders === null ? null : Number(l.funders) - Number(l.min_funders),
      book_hash_folded: l.book_hash, inputs_hash: l.inputs_hash,
    },
    verdict_reasons: JSON.parse(String(l.reasons)) as unknown, allocation: l.allocation ? (JSON.parse(String(l.allocation)) as unknown) : null,
    walked_total: l.walked_total, contributed_total: l.contributed_total, timeline: events.map(eventRef),
  };
}

export function eventRef(r: Row): Json {
  return { event: r.event, block_height: Number(r.block_height), receipt_id: r.receipt_id, log_index: Number(r.log_index), time: Number(r.time), source: r.source };
}

function poolInfo(ctx: Ctx, id: number): Json {
  const p = one(ctx.store, "SELECT * FROM pools WHERE launch_id = ?", id);
  if (!p) return { open: false, paused: false, token: null, market: null, total_supply: one(ctx.store, "SELECT total_supply FROM launches WHERE launch_id = ?", id)?.total_supply ?? null, fee_terms: null, opened_at: null, quote_reserve: null, token_reserve: null, fee_bps: null, price: null, tvl_quote: null };
  const qr = p.quote_reserve === null ? null : BigInt(String(p.quote_reserve));
  const tr = p.token_reserve === null ? null : BigInt(String(p.token_reserve));
  const spot = qr !== null && tr !== null ? priceE12(qr, tr, Number(p.token_decimals)) : null;
  return {
    open: true, paused: Number(p.paused) === 1, opened_at: p.opened_at, token: p.token, market: p.market,
    total_supply: one(ctx.store, "SELECT total_supply FROM launches WHERE launch_id = ?", id)?.total_supply ?? null, fee_terms: p.terms ? (JSON.parse(String(p.terms)) as unknown) : null, quote_reserve: p.quote_reserve, token_reserve: p.token_reserve, fee_bps: p.fee_bps,
    price: spot === null ? null : e12ToNumber(spot), tvl_quote: qr === null ? null : quoteToNumber(qr * 2n),
  };
}

function indicator(id: string, label: string, status: string, basis: string, detail: string): Json {
  return { id, label, status, basis, detail };
}

function authority(id: string, label: string, v: unknown): Json {
  if (v === null || v === undefined) return indicator(id, label, "unknown", "not_indexed", "no logged event carries this fact; not guessed");
  return Number(v) === 1 ? indicator(id, label, "pass", "event", "pool_opened logged the authority as null") : indicator(id, label, "fail", "event", "pool_opened logged a non-null authority");
}

export function safety(ctx: Ctx, l: Row): Json[] {
  const p = one(ctx.store, "SELECT * FROM pools WHERE launch_id = ?", Number(l.launch_id));
  const verdict = l.verdict === "PASS" ? indicator("verdict_passed", "Trial verdict PASS", "pass", "event", "verdict event logged PASS")
    : l.verdict === "FAIL" ? indicator("verdict_passed", "Trial verdict PASS", "fail", "event", "verdict event logged FAIL")
    : indicator("verdict_passed", "Trial verdict PASS", "unknown", "derived", "no verdict yet");
  const creatorBps = p?.creator_bps === null || p?.creator_bps === undefined ? null : Number(p.creator_bps);
  const feeBps = p?.fee_bps === null || p?.fee_bps === undefined ? null : Number(p.fee_bps);
  const bound = creatorBps === null || feeBps === null ? indicator("creator_fee_within_bound", "Creator fee within bound", "unknown", "not_indexed", "pool_opened lacks fee_bps or creator_bps")
    : creatorBps <= 6000 && feeBps * creatorBps <= 1_000_000 ? indicator("creator_fee_within_bound", "Creator fee within bound", "pass", "derived", `fee ${feeBps} bps, creator share ${creatorBps} bps`)
    : indicator("creator_fee_within_bound", "Creator fee within bound", "fail", "derived", `fee ${feeBps} bps, creator share ${creatorBps} bps exceeds the bound`);
  return [
    verdict,
    p ? indicator("lp_in_pool", "Liquidity seeded in the pool", "pass", "event", "pool_opened logged") : indicator("lp_in_pool", "Liquidity seeded in the pool", "unknown", "derived", "no pool_opened yet"),
    authority("mint_authority_null", "Mint authority is null", p?.mint_authority_null),
    authority("freeze_authority_null", "Freeze authority is null", p?.freeze_authority_null),
    indicator("payout_recipient_declared", "Payout recipient declared", "pass", "derived", l.payout_recipient === l.creator ? "payout recipient is the creator" : `payout recipient ${String(l.payout_recipient)} differs from the creator`),
    p ? (Number(p.paused) === 1 ? indicator("market_not_paused", "Market not paused", "warn", "event", "market_paused logged") : indicator("market_not_paused", "Market not paused", "pass", "event", "no pause logged"))
      : indicator("market_not_paused", "Market not paused", "unknown", "derived", "no pool"),
    bound,
    l.inputs_hash ? indicator("verdict_inputs_hash_present", "Verdict inputs hash recorded", "pass", "event", "verdict event carried inputs_hash") : indicator("verdict_inputs_hash_present", "Verdict inputs hash recorded", "unknown", "derived", "no verdict inputs hash yet"),
  ];
}

export function tokenPage(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = launchRow(ctx, id);
  const now = ctx.now();
  const win = all(ctx.store, "SELECT price_e12, quote_amount FROM trades WHERE launch_id = ? AND time >= ? ORDER BY block_height, ord, log_index", id, now - WINDOW_24H);
  const prices = win.map((r) => BigInt(String(r.price_e12)));
  const before = one(ctx.store, "SELECT price_e12 FROM trades WHERE launch_id = ? AND time < ? ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1", id, now - WINDOW_24H);
  const base = before ? BigInt(String(before.price_e12)) : prices[0];
  const lastP = prices[prices.length - 1];
  const change = base && lastP && base > 0n ? Number(((lastP - base) * 1_000_000n) / base) / 10_000 : null;
  const pool = one(ctx.store, "SELECT * FROM pools WHERE launch_id = ?", id);
  const vol = volume(ctx.store, id, now - WINDOW_24H);
  const sum = all(ctx.store, "SELECT source FROM trades WHERE launch_id = ? LIMIT 1", id);
  return {
    launch: launchSummary(ctx, l), pool: poolInfo(ctx, id),
    stats: {
      last_price: lastPrice(ctx.store, id), change_24h_pct: change,
      high_24h: prices.length ? e12ToNumber(prices.reduce((a, b) => (b > a ? b : a))) : null, low_24h: prices.length ? e12ToNumber(prices.reduce((a, b) => (b < a ? b : a))) : null,
      volume_24h: vol.quote, trades_24h: vol.trades, fees_total: pool?.fees_total ?? "0", windows: windowStats(ctx, id, now),
    },
    genesis: genesisOf(ctx, l), external_pools: externalPools(ctx, id),
    creator: { account: l.creator, payout_recipient: l.payout_recipient, creator_claimed: pool?.creator_claimed ?? "0" },
    safety: safety(ctx, l), as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l, ...sum]),
  };
}

export function candles(ctx: Ctx, rawId: string, q: Q): Json {
  const id = parseId(rawId);
  launchRow(ctx, id);
  const iv = intervalParam(q.get("interval"));
  const limit = intParam(q.get("limit"), "limit", 1, 2000, 500);
  const from = q.get("from") === null ? null : intParam(q.get("from"), "from", 0, 4_000_000_000, 0);
  const to = intParam(q.get("to"), "to", 0, 4_000_000_000, 4_000_000_000);
  const rows = from === null
    ? all(ctx.store, "SELECT * FROM (SELECT * FROM candles WHERE launch_id = ? AND interval = ? AND t < ? ORDER BY t DESC LIMIT ?) ORDER BY t", id, iv, to, limit)
    : all(ctx.store, "SELECT * FROM candles WHERE launch_id = ? AND interval = ? AND t >= ? AND t < ? ORDER BY t LIMIT ?", id, iv, from, to, limit);
  const series = q.get("fill") === "true" ? fillGaps(rows.map(candleJson), INTERVAL_SECONDS[iv], ctx) : rows.map(candleJson);
  return { launch_id: String(id), interval: iv, candles: series, as_of: asOf(ctx.store), source: sourceOf(ctx.store, rows) };
}

function fillGaps(cs: Json[], step: number, ctx: Ctx): Json[] {
  const out: Json[] = [];
  const src = storeSource(ctx.store);
  for (const c of cs) {
    const prev = out[out.length - 1];
    for (let t = prev ? Number(prev.t) + step : Number(c.t); prev && t < Number(c.t); t += step) {
      out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0, n: 0, filled: true, source: prev.source ?? src });
    }
    out.push(c);
  }
  return out;
}

export function trades(ctx: Ctx, rawId: string, q: Q): Json {
  const id = parseId(rawId);
  launchRow(ctx, id);
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const cur = decodeCursor<{ h: number; o: number; l: number }>(q.get("before"));
  const trader = q.get("trader");
  const rows = all(ctx.store,
    `SELECT * FROM trades WHERE launch_id = ? AND (? IS NULL OR trader = ?) AND (? IS NULL OR (block_height, ord, log_index) < (?, ?, ?))
     ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT ?`,
    id, trader, trader, cur ? 1 : null, cur?.h ?? 0, cur?.o ?? 0, cur?.l ?? 0, limit + 1) as Row[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next = rows.length > limit && last ? encodeCursor({ h: Number(last.block_height), o: Number(last.ord), l: Number(last.log_index) }) : null;
  return { items: page.map(tradeJson), next_cursor: next, as_of: asOf(ctx.store), source: sourceOf(ctx.store, page) };
}

export function holders(ctx: Ctx, rawId: string, q: Q): Json {
  const id = parseId(rawId);
  const l = launchRow(ctx, id);
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const rows = all(ctx.store, "SELECT holder, balance FROM balances WHERE launch_id = ?", id)
    .map((r) => ({ holder: String(r.holder), balance: BigInt(String(r.balance)) })).filter((r) => r.balance > 0n);
  const pool = one(ctx.store, "SELECT token_reserve FROM pools WHERE launch_id = ?", id);
  if (pool?.token_reserve) rows.push({ holder: "pool", balance: BigInt(String(pool.token_reserve)) });
  const total = rows.reduce((a, r) => a + r.balance, 0n);
  rows.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : a.holder.localeCompare(b.holder)));
  const items = rows.slice(0, limit).map((r) => ({
    holder: r.holder, balance: r.balance.toString(), share_bps: total > 0n ? Number((r.balance * 10_000n) / total) : 0,
    is_creator: r.holder === l.creator, is_pool: r.holder === "pool",
  }));
  return { basis: "trial claims plus net market flow, indexed estimate (not a token-contract read)", holder_count: rows.length, items, as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l]) };
}

export function depth(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = launchRow(ctx, id);
  const p = one(ctx.store, "SELECT * FROM pools WHERE launch_id = ?", id);
  const base = { pool: poolInfo(ctx, id), as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l]) };
  if (!p?.quote_reserve || !p.token_reserve) return { ...base, ladder: [] };
  const qr = BigInt(String(p.quote_reserve));
  const tr = BigInt(String(p.token_reserve));
  const dec = Number(p.token_decimals);
  const fee = BigInt(Number(p.fee_bps ?? 0));
  const spot = priceE12(qr, tr, dec) ?? 1n;
  const ladder: Json[] = [];
  for (const usdc of [1n, 10n, 100n, 1000n]) {
    const quoteIn = usdc * 1_000_000n;
    const tokOut = cpOut(qr, tr, quoteIn, fee);
    const buyAvg = priceE12(quoteIn, tokOut, dec);
    ladder.push(rung("buy", quoteIn, tokOut, buyAvg, spot, 1));
    const tokIn = (quoteIn * tr) / qr;
    const quoteOut = cpOut(tr, qr, tokIn, fee);
    ladder.push(rung("sell", tokIn, quoteOut, priceE12(quoteOut, tokIn, dec), spot, -1));
  }
  return { ...base, ladder };
}

function rung(side: string, amountIn: bigint, amountOut: bigint, avg: bigint | null, spot: bigint, sign: 1 | -1): Json {
  const diff = avg === null ? 0n : (avg - spot) * BigInt(sign);
  const impact = spot > 0n && diff > 0n ? Number((diff * 10_000n) / spot) : 0;
  return { side, amount_in: amountIn.toString(), amount_out: amountOut.toString(), avg_price: avg === null ? null : e12ToNumber(avg), price_impact_bps: impact };
}

export function genesisOf(ctx: Ctx, l: Row): Json {
  const g = one(ctx.store, "SELECT * FROM genesis WHERE launch_id = ?", Number(l.launch_id));
  const verdictInputs = {
    total_active: l.total_active, funders: l.funders, soft_cap: l.soft_cap, min_funders: l.min_funders, inputs_hash: l.inputs_hash, verdict: l.verdict,
  };
  const failed = l.verdict === "FAIL" || l.status === "creation_failed" || l.status === "dissolved";
  const stage = failed || l.verdict === null ? "none" : g ? String(g.stage) : "pending";
  const val = (k: string): unknown => (g && !failed ? g[k] : null);
  return {
    stage, network: val("network"), path: val("path"), spec_hash: val("spec_hash"), mint: val("mint"), tx_create: val("tx_create"), tx_authority: val("tx_authority"),
    distributor: val("distributor"), root: val("root"), mint_authority: g && !failed ? g.mint_authority : "unknown", freeze_authority: g && !failed ? g.freeze_authority : "unknown",
    verified_checks: g && !failed ? (JSON.parse(String(g.checks)) as unknown) : [], verdict_inputs: verdictInputs, updated_at: val("updated_at"),
    source: g ? sourceOf(ctx.store, [g, l]) : sourceOf(ctx.store, [l]),
  };
}

const WINDOWS: Array<[string, number]> = [["5m", 300], ["1h", 3600], ["6h", 21_600], ["24h", 86_400]];

/** Price stats per window from indexed swaps. Change compares the last price in the window with the last price before it. */
export function windowStats(ctx: Ctx, id: number, now: number): Json {
  const rows = all(ctx.store, "SELECT time, side, trader, price_e12, quote_amount FROM trades WHERE launch_id = ? AND time >= ? ORDER BY block_height, ord, log_index", id, now - 86_400);
  const prior = one(ctx.store, "SELECT price_e12 FROM trades WHERE launch_id = ? AND time < ? ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1", id, now - 86_400);
  const out: Json = {};
  for (const [name, secs] of WINDOWS) {
    const start = now - secs;
    const inWin = rows.filter((r) => Number(r.time) >= start);
    const before = rows.filter((r) => Number(r.time) < start);
    const beforeP = before.length ? before[before.length - 1] : name === "24h" ? prior : undefined;
    const prices = inWin.map((r) => BigInt(String(r.price_e12)));
    const base = beforeP ? BigInt(String(beforeP.price_e12)) : prices[0];
    const last = prices[prices.length - 1];
    const vol = (side: string): number => quoteToNumber(inWin.filter((r) => r.side === side).reduce((a, r) => a + BigInt(String(r.quote_amount)), 0n));
    const buyV = vol("buy");
    const sellV = vol("sell");
    out[name] = {
      change_pct: base && last && base > 0n ? Number(((last - base) * 1_000_000n) / base) / 10_000 : null,
      high: prices.length ? e12ToNumber(prices.reduce((a, b) => (b > a ? b : a))) : null,
      low: prices.length ? e12ToNumber(prices.reduce((a, b) => (b < a ? b : a))) : null,
      buys: inWin.filter((r) => r.side === "buy").length, sells: inWin.filter((r) => r.side === "sell").length,
      buy_volume: buyV, sell_volume: sellV, volume: buyV + sellV, unique_traders: new Set(inWin.map((r) => String(r.trader))).size,
    };
  }
  return out;
}

export function externalPools(ctx: Ctx, id: number): Json[] {
  return all(ctx.store, "SELECT venue, pool, url FROM external_pools WHERE launch_id = ? ORDER BY venue, pool", id).map((r) => ({ venue: r.venue, pool: r.pool, url: r.url }));
}

export function stats(ctx: Ctx): Json {
  const store = ctx.store;
  const sums = (sql: string): bigint => BigInt(String(one(store, sql)?.s ?? "0"));
  const summaries = all(store, "SELECT * FROM launches").map((l) => launchSummary(ctx, l));
  const count = (key: "phase" | "tab"): Json => {
    const out: Json = {};
    for (const s of summaries) out[String(s[key])] = Number(out[String(s[key])] ?? 0) + 1;
    return out;
  };
  const passed = summaries.filter((s) => s.verdict === "PASS").length;
  const failed = summaries.filter((s) => s.verdict === "FAIL").length;
  const col = (c: string): bigint => sums(`SELECT COALESCE(SUM(CAST(${c} AS INTEGER)), 0) AS s FROM pools`);
  const trade = one(store, "SELECT COUNT(*) AS n, COUNT(DISTINCT trader) AS u, COALESCE(SUM(CAST(quote_amount AS INTEGER)), 0) AS v FROM trades");
  const first = one(store, "SELECT MIN(block_height) AS h FROM events");
  const rows = [...all(store, "SELECT source FROM launches"), ...all(store, "SELECT source FROM trades LIMIT 1")];
  return {
    launches: { total: summaries.length, by_phase: count("phase"), by_tab: count("tab"), passed, failed, pass_rate_bps: passed + failed > 0 ? Math.floor((passed * 10_000) / (passed + failed)) : null },
    committed: {
      total_committed: sums("SELECT COALESCE(SUM(CAST(contributed_total AS INTEGER)), 0) AS s FROM launches").toString(),
      total_walked: sums("SELECT COALESCE(SUM(CAST(walked_total AS INTEGER)), 0) AS s FROM launches").toString(),
      active_in_open_trials: sums("SELECT COALESCE(SUM(CAST(total_active AS INTEGER)), 0) AS s FROM launches WHERE status = 'open'").toString(),
      refunds_paid: sums("SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS s FROM payouts WHERE kind LIKE 'Refund%' AND ok = 1").toString(),
      refund_attempts_failed: sums("SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS s FROM payouts WHERE kind LIKE 'Refund%' AND ok = 0").toString(),
    },
    volume: {
      trades: Number(trade?.n ?? 0), quote_volume: quoteToNumber(BigInt(Number(trade?.v ?? 0))), unique_traders: Number(trade?.u ?? 0), fees_total: col("fees_total").toString(),
      fee_slices: { creator: col("creator_fees").toString(), platform: col("fees_platform").toString(), holders: col("fees_holders").toString(), lp: col("fees_lp").toString(), referral: col("fees_referral").toString() },
    },
    since_block: first?.h === null || first?.h === undefined ? null : Number(first.h),
    basis: "folds of indexed events only; events before since_block were never seen and are not counted; no projections",
    as_of: asOf(store), source: sourceOf(store, rows),
  };
}

const OPS_EVENTS = ["paused", "frozen", "unpaused", "global_cap_lowered", "global_cap_queued", "global_cap_applied", "launch_cap_queued", "launch_cap_applied", "market_paused", "platform_withdrawn"];

function opsSummary(event: string, d: Record<string, unknown>): string {
  const by = typeof d.by === "string" ? ` by ${d.by}` : "";
  const when = (v: unknown): string => (typeof v === "string" && /^[0-9]+$/.test(v) ? new Date(Number(BigInt(v) / 1_000_000n)).toISOString() : "unknown time");
  switch (event) {
    case "paused": return `core paused${by}`;
    case "frozen": return `core frozen${by} until ${when(d.until)}`;
    case "unpaused": return "core unpaused";
    case "global_cap_lowered": return `global cap lowered to ${String(d.value)}`;
    case "global_cap_queued": return `global cap raise to ${String(d.value)} queued, effective ${when(d.effective_at)}`;
    case "global_cap_applied": return `global cap set to ${String(d.value)}`;
    case "launch_cap_queued": return `per-launch cap raise to ${String(d.value)} queued, effective ${when(d.effective_at)}`;
    case "launch_cap_applied": return `per-launch cap set to ${String(d.value)}`;
    case "market_paused": return `market ${d.paused === false ? "unpaused" : "paused"}${by}`;
    default: return `platform withdrew ${String(d.amount)} to ${String(d.to)}`;
  }
}

export function opsLog(ctx: Ctx, q: Q): Json {
  const limit = intParam(q.get("limit"), "limit", 1, 200, 50);
  const scope = q.get("scope");
  if (scope !== null && scope !== "core" && scope !== "market") throw new ApiError(400, "bad_scope", "scope must be core or market");
  const cur = decodeCursor<{ h: number; o: number; l: number }>(q.get("before"));
  const marks = OPS_EVENTS.map(() => "?").join(",");
  const rows = all(ctx.store,
    `SELECT * FROM events WHERE event IN (${marks}) AND (? IS NULL OR kind = ?) AND (? IS NULL OR (block_height, ord, log_index) < (?, ?, ?))
     ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT ?`,
    ...OPS_EVENTS, scope, scope, cur ? 1 : null, cur?.h ?? 0, cur?.o ?? 0, cur?.l ?? 0, limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const items = page.map((r) => {
    const data = JSON.parse(String(r.data)) as Record<string, unknown>;
    return { event: r.event, scope: r.kind, contract: r.contract, summary: opsSummary(String(r.event), data), data, block_height: Number(r.block_height), receipt_id: r.receipt_id, time: Number(r.time), source: r.source };
  });
  const next = rows.length > limit && last ? encodeCursor({ h: Number(last.block_height), o: Number(last.ord), l: Number(last.log_index) }) : null;
  return { items, next_cursor: next, as_of: asOf(ctx.store), source: sourceOf(ctx.store, page) };
}
