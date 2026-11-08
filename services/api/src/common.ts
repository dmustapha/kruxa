import type { Store } from "../../indexer/src/store.ts";
import { INTERVAL_SECONDS } from "../../indexer/src/types.ts";
import type { Interval, Source } from "../../indexer/src/types.ts";
import { e12ToNumber, quoteToNumber } from "../../indexer/src/price.ts";

export type Row = Record<string, unknown>;
export type Json = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Ctx {
  store: Store;
  /** Current unix seconds. In a fixture store this is the last block time, so stages make sense offline. */
  now: () => number;
  startedAt: number;
  maxLagBlocks: number;
  tail: () => { headHeight: number | null; lastError: string | null };
  dataSource: string;
}

export const WINDOW_24H = 86400;
const NEW_WINDOW = 6 * 3600;

export function all(store: Store, sql: string, ...p: Array<string | number | null>): Row[] {
  return store.db.prepare(sql).all(...p) as Row[];
}

export function one(store: Store, sql: string, ...p: Array<string | number | null>): Row | undefined {
  return store.db.prepare(sql).get(...p) as Row | undefined;
}

export function asOf(store: Store): { block_height: number | null; block_time: number | null } {
  const r = one(store, "SELECT height, time FROM blocks ORDER BY height DESC LIMIT 1");
  return { block_height: r ? Number(r.height) : null, block_time: r ? Number(r.time) : null };
}

export function storeSource(store: Store): Source {
  return store.network === "fixture" ? "fixture" : "chain";
}

/** `fixture` when any row (or an empty set on a fixture store) is fixture data. */
export function sourceOf(store: Store, rows: Row[]): Source {
  if (rows.length === 0) return storeSource(store);
  return rows.some((r) => r.source === "fixture") ? "fixture" : "chain";
}

export function parseId(raw: string): number {
  if (!/^[0-9]{1,15}$/.test(raw)) throw new ApiError(400, "bad_id", "launch id must be a decimal integer");
  return Number(raw);
}

export function intParam(v: string | null | undefined, name: string, min: number, max: number, dflt: number): number {
  if (v === null || v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, "bad_param", `${name} must be an integer in ${min}..${max}`);
  return n;
}

export function intervalParam(v: string | null | undefined): Interval {
  const iv = v ?? "1m";
  if (!(iv in INTERVAL_SECONDS)) throw new ApiError(400, "bad_interval", "interval must be one of 1m, 5m, 1h, 1d");
  return iv as Interval;
}

export function encodeCursor(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

export function decodeCursor<T>(c: string | null | undefined): T | null {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString()) as T;
  } catch {
    throw new ApiError(400, "bad_cursor", "cursor is not valid");
  }
}

export function candleJson(r: Row): Json {
  return {
    t: Number(r.t), o: e12ToNumber(BigInt(String(r.o))), h: e12ToNumber(BigInt(String(r.h))), l: e12ToNumber(BigInt(String(r.l))),
    c: e12ToNumber(BigInt(String(r.c))), v: quoteToNumber(BigInt(String(r.v))), n: Number(r.n), source: r.source,
  };
}

export function tradeJson(r: Row): Json {
  return {
    launch_id: String(r.launch_id), side: r.side, trader: r.trader, amount_in: r.amount_in, amount_out: r.amount_out,
    price: e12ToNumber(BigInt(String(r.price_e12))), quote_amount: r.quote_amount, token_amount: r.token_amount, fee_total: r.fee_total,
    ...(r.fee_slices ? { fee_slices: JSON.parse(String(r.fee_slices)) as unknown } : {}),
    ...(r.qr_after ? { quote_reserve_after: r.qr_after } : {}), ...(r.tr_after ? { token_reserve_after: r.tr_after } : {}),
    block_height: Number(r.block_height), receipt_id: r.receipt_id, time: Number(r.time), source: r.source,
  };
}

export function lastPrice(store: Store, id: number): number | null {
  const r = one(store, "SELECT price_e12 FROM trades WHERE launch_id = ? ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1", id);
  return r ? e12ToNumber(BigInt(String(r.price_e12))) : null;
}

export function volume(store: Store, id: number, since: number): { quote: number; trades: number } {
  const r = one(store, "SELECT COALESCE(SUM(CAST(quote_amount AS INTEGER)), 0) AS q, COUNT(*) AS n FROM trades WHERE launch_id = ? AND time >= ?", id, since);
  return { quote: quoteToNumber(BigInt(Number(r?.q ?? 0))), trades: Number(r?.n ?? 0) };
}

export function stageOf(l: Row, now: number): "new" | "open" | "closing" | "passed" | "failed" {
  const status = String(l.status);
  if (status === "passed") return "passed";
  if (status === "failed" || status === "creation_failed" || status === "dissolved") return "failed";
  const commitEnd = l.commit_end === null ? null : Number(l.commit_end);
  const walkEnd = l.walk_end === null ? null : Number(l.walk_end);
  if (status === "creating") return "new";
  if ((commitEnd !== null && now >= commitEnd) || (walkEnd !== null && walkEnd - now < NEW_WINDOW)) return "closing";
  if (l.opens_at !== null && now - Number(l.opens_at) < NEW_WINDOW) return "new";
  return "open";
}

export function launchSummary(ctx: Ctx, l: Row): Json {
  const id = Number(l.launch_id);
  const now = ctx.now();
  const soft = l.soft_cap === null ? null : BigInt(String(l.soft_cap));
  const raw = soft && soft > 0n ? (BigInt(String(l.total_active)) * 10_000n) / soft : null;
  const progress = raw === null ? null : Number(raw > 20_000n ? 20_000n : raw);
  return {
    launch_id: String(id), symbol: l.symbol, creator: l.creator, payout_recipient: l.payout_recipient, status: l.status, stage: stageOf(l, now),
    created_at: l.created_at, opens_at: l.opens_at, commit_end: l.commit_end, walk_end: l.walk_end,
    total_active: l.total_active, funders: l.funders, soft_cap: l.soft_cap, min_funders: l.min_funders, progress_bps: progress,
    verdict: l.verdict, has_market: one(ctx.store, "SELECT 1 AS x FROM pools WHERE launch_id = ?", id) !== undefined,
    last_price: lastPrice(ctx.store, id), volume_24h: volume(ctx.store, id, now - WINDOW_24H).quote, last_block: l.last_block, source: l.source,
  };
}
