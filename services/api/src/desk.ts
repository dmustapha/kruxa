
import { ApiError, all, asOf, launchSummary, one, parseId, sourceOf, tradeJson, lastPrice } from "./common.ts";
import type { Ctx, Json, Row } from "./common.ts";
import { eventRef, vestingOf } from "./queries.ts";

function bare(account: string): string {
  return account.startsWith("near:") ? account.slice(5) : account;
}

function checkAccount(account: string): string {
  if (account.length < 2 || account.length > 128 || /[\s"'\\]/.test(account)) throw new ApiError(400, "bad_account", "account is not a valid id");
  return bare(account);
}

/** After `stream_lengthened` the cap is the unlocked amount at the change plus a slower line to the new end (core `stream_cap`). */
function lengthenedMeter(l: Row, c: Row, now: number): Json {
  const total = BigInt(String(l.stream_total));
  const drawn = BigInt(String(l.stream_drawn));
  const base = BigInt(String(c.stream_unlocked_at_change));
  const from = Number(c.stream_changed_at);
  const end = Number(BigInt(String(c.stream_end_ns)) / 1_000_000_000n);
  const dur = Math.max(1, end - from);
  const el = Math.max(0, Math.min(now - from, dur));
  const unlocked = base + ((total - base) * BigInt(el)) / BigInt(dur);
  return {
    recipient: l.payout_recipient, total: total.toString(), drawn: drawn.toString(), unlocked: unlocked.toString(), drawable_estimate: (unlocked > drawn ? unlocked - drawn : 0n).toString(),
    starts_at: Number(l.settled_at), ends_at: end, progress_bps: total === 0n ? null : Number((unlocked * 10_000n) / total), lengthened: Number(c.stream_lengthened),
  };
}

function streamMeter(ctx: Ctx, l: Row, now: number): Json | null {
  if (l.verdict !== "PASS" || l.settled_at === null) return null;
  const c = one(ctx.store, "SELECT * FROM launch_custody WHERE launch_id = ? AND stream_end_ns IS NOT NULL", Number(l.launch_id));
  if (c) return lengthenedMeter(l, c, now);
  const total = BigInt(String(l.stream_total));
  const drawn = BigInt(String(l.stream_drawn));
  const start = Number(l.settled_at);
  const days = l.stream_days === null ? null : Number(l.stream_days);
  if (days === null || days <= 0) {
    return { recipient: l.payout_recipient, total: total.toString(), drawn: drawn.toString(), unlocked: null, drawable_estimate: null, starts_at: start, ends_at: null, progress_bps: null };
  }
  const dur = days * 86400;
  const el = Math.max(0, Math.min(now - start, dur));
  const unlocked = (total * BigInt(el)) / BigInt(dur);
  return {
    recipient: l.payout_recipient, total: total.toString(), drawn: drawn.toString(), unlocked: unlocked.toString(),
    drawable_estimate: (unlocked > drawn ? unlocked - drawn : 0n).toString(), starts_at: start, ends_at: start + dur, progress_bps: Math.floor((el * 10_000) / dur),
  };
}

function claimsFor(ctx: Ctx, ids: number[]): Json[] {
  if (ids.length === 0) return [];
  const rows = all(ctx.store, `SELECT * FROM payouts WHERE launch_id IN (${ids.map(() => "?").join(",")}) AND ok = 1 AND kind IN ('Stream', 'creator_claimed', 'alloc_claimed', 'AllocClaim') ORDER BY block_height, ord, log_index`, ...ids);
  return rows.map((r) => ({
    launch_id: String(r.launch_id), kind: r.kind === "Stream" ? "stream_draw" : r.kind === "alloc_claimed" || r.kind === "AllocClaim" ? "alloc_claim" : "creator_claimed", amount: r.amount,
    block_height: Number(r.block_height), receipt_id: r.receipt_id, time: Number(r.time), source: r.source,
  }));
}

export function creatorDesk(ctx: Ctx, rawAccount: string): Json {
  const account = checkAccount(rawAccount);
  const ls = all(ctx.store, "SELECT * FROM launches WHERE creator = ? OR payout_recipient = ? ORDER BY launch_id", account, account);
  const now = ctx.now();
  let drawn = 0n, fees = 0n, claimed = 0n, allocClaimed = 0n;
  const launches = ls.map((l) => {
    const p = one(ctx.store, "SELECT * FROM pools WHERE launch_id = ?", Number(l.launch_id));
    const f = BigInt(String(p?.creator_fees ?? "0"));
    const c = BigInt(String(p?.creator_claimed ?? "0"));
    const sd = BigInt(String(l.stream_drawn));
    const inst = one(ctx.store, "SELECT alloc_claimed FROM instants WHERE launch_id = ?", Number(l.launch_id));
    const ac = BigInt(String(inst?.alloc_claimed ?? "0"));
    drawn += sd; fees += f; claimed += c; allocClaimed += ac;
    const role = l.creator === account && l.payout_recipient === account ? "both" : l.creator === account ? "creator" : "payout_recipient";
    return {
      launch: launchSummary(ctx, l), role, stream: streamMeter(ctx, l, now), allocation: inst ? vestingOf(ctx, l) : null,
      earnings: { market_fees_creator_slice: f.toString(), claimed: c.toString(), claimable_estimate: (f > c ? f - c : 0n).toString(), stream_drawn: sd.toString(), alloc_claimed: ac.toString() },
    };
  });
  const claims = claimsFor(ctx, ls.map((l) => Number(l.launch_id)));
  return {
    account, launches, totals: { stream_drawn: drawn.toString(), market_fees_creator_slice: fees.toString(), claimed: claimed.toString(), alloc_claimed: allocClaimed.toString() },
    claims, as_of: asOf(ctx.store), source: sourceOf(ctx.store, [...ls, ...claims] as Row[]),
  };
}

export function creatorClaimsCsv(ctx: Ctx, rawAccount: string): string {
  const desk = creatorDesk(ctx, rawAccount);
  const lines = ["launch_id,kind,amount,block_height,receipt_id,time,source"];
  for (const c of desk.claims as Json[]) lines.push([c.launch_id, c.kind, c.amount, c.block_height, c.receipt_id, c.time, c.source].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

function positionStatus(l: Row, contributed: bigint, walked: bigint, claimed: bigint, now: number): string {
  if (contributed === 0n) return "market_only";
  if (contributed === walked) return "walked";
  if (l.verdict === "FAIL" || l.status === "creation_failed") return "refundable";
  if (l.verdict === "PASS") return claimed > 0n ? "claimed" : "claimable";
  if (l.walk_end !== null && now >= Number(l.walk_end)) return "awaiting_settle";
  return "active";
}

export function portfolio(ctx: Ctx, rawAccount: string): Json {
  const account = checkAccount(rawAccount);
  const keys = [account, `near:${account}`];
  const pos = all(ctx.store, "SELECT * FROM positions WHERE holder IN (?, ?)", ...keys);
  const bals = all(ctx.store, "SELECT * FROM balances WHERE holder = ? AND CAST(balance AS INTEGER) > 0", account);
  const ids = [...new Set([...pos.map((p) => Number(p.launch_id)), ...bals.map((b) => Number(b.launch_id))])].sort((a, b) => a - b);
  const now = ctx.now();
  const positions = ids.map((id) => {
    const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", id) as Row;
    const ps = pos.filter((p) => Number(p.launch_id) === id);
    const sum = (k: string): bigint => ps.reduce((a, p) => a + BigInt(String(p[k])), 0n);
    const [c, w, cl] = [sum("contributed"), sum("walked"), sum("tokens_claimed")];
    const bal = BigInt(String(bals.find((b) => Number(b.launch_id) === id)?.balance ?? "0"));
    const price = lastPrice(ctx.store, id);
    const dec = Number(l.token_decimals);
    return {
      launch: launchSummary(ctx, l), contributed: c.toString(), walked: w.toString(), active: (c > w ? c - w : 0n).toString(), tokens_claimed: cl.toString(),
      status: positionStatus(l, c, w, cl, now), market_balance: bal.toString(), market_value_quote: price === null ? null : (Number(bal) / 10 ** dec) * price,
    };
  });
  const motion = ids.length === 0 ? [] : all(ctx.store, `SELECT * FROM payouts WHERE launch_id IN (${ids.map(() => "?").join(",")}) AND ok = 0 AND kind != 'creator_claimed' ORDER BY block_height`, ...ids)
    .map((r) => ({ launch_id: String(r.launch_id), kind: r.kind, amount: r.amount, ok: false, receipt_id: r.receipt_id }));
  return { account, positions, funds_in_motion: motion, as_of: asOf(ctx.store), source: sourceOf(ctx.store, [...pos, ...bals, ...ids.map((i) => one(ctx.store, "SELECT source FROM launches WHERE launch_id = ?", i) as Row)]) };
}

/** Result of the indexer's own replay of the rolling book hash (fold_check): null until a book event exists, false from the first disagreement. */
function bookFold(l: Row): Json {
  const events = Number(l.book_events);
  return {
    book_hash_recomputed: events === 0 ? null : l.book_hash_recomputed, fold_ok: events === 0 ? null : l.book_mismatch_at === null,
    fold_events: events, fold_first_mismatch_block: l.book_mismatch_at ?? null,
  };
}

/** Internal consistency of the indexed book: sum of (contributed - walked) equals total_active and active holder count equals funders. */
function ledgerConsistent(ctx: Ctx, l: Row): boolean {
  const ps = all(ctx.store, "SELECT contributed, walked FROM positions WHERE launch_id = ?", Number(l.launch_id));
  const net = ps.reduce((a, p) => a + BigInt(String(p.contributed)) - BigInt(String(p.walked)), 0n);
  const active = ps.filter((p) => BigInt(String(p.contributed)) > BigInt(String(p.walked))).length;
  return net.toString() === String(l.total_active) && active === Number(l.funders);
}

export function verify(ctx: Ctx, rawId: string): Json {
  const id = parseId(rawId);
  const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", id);
  if (!l) throw new ApiError(404, "not_found", `no launch ${id}`);
  if (l.mode === "instant") {
    const evs = all(ctx.store, "SELECT event, block_height, receipt_id, log_index, time, source FROM events WHERE json_extract(data, '$.launch_id') = ? AND event != 'swap' ORDER BY block_height, ord, log_index", String(id));
    return {
      launch_id: String(id), mode: "instant", charter_hash: l.charter_hash, inputs_hash: null, book_hash_folded: null, book_hash_stored: null, fold_ok: null,
      fold_note: "instant launches have no trial, verdict or book to recompute; the launcher's get_instant and get_vesting views and the market's get_pool are the checks",
      ledger_consistent: null, book_events: 0, verdict: null, event_count: evs.length, events: evs.map(eventRef), recompute: `near view <launcher> get_instant '{"launch_id":"${id}"}'`,
      as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l]),
    };
  }
  const ev = all(ctx.store, "SELECT event, block_height, receipt_id, log_index, time, source FROM events WHERE json_extract(data, '$.launch_id') = ? AND event NOT IN ('contributed', 'walked', 'swap') ORDER BY block_height, ord, log_index", String(id));
  const bookEvents = Number(one(ctx.store, "SELECT COUNT(*) AS n FROM events WHERE json_extract(data, '$.launch_id') = ? AND event IN ('contributed', 'walked')", String(id))?.n);
  return {
    launch_id: String(id), mode: "trial", charter_hash: l.charter_hash, inputs_hash: l.inputs_hash, book_hash_folded: l.book_hash,
    book_hash_stored: null, ...bookFold(l),
    fold_note: "book_hash_folded is the hash the contract logged on its latest book event. book_hash_recomputed is the same rolling hash replayed here from the contributed and walked events alone; fold_ok says the two agree at every event. It is not compared with get_state (the indexer makes no view calls): scripts/verify.sh is the independent check against the contract.",
    ledger_consistent: ledgerConsistent(ctx, l), book_events: bookEvents, verdict: l.verdict, event_count: ev.length, events: ev.map(eventRef),
    recompute: `./scripts/verify.sh ${id}`, as_of: asOf(ctx.store), source: sourceOf(ctx.store, [l]),
  };
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function launchesCsv(ctx: Ctx): string {
  const lines = ["launch_id,symbol,creator,status,total_active,funders,verdict,source"];
  for (const l of all(ctx.store, "SELECT * FROM launches ORDER BY launch_id")) {
    lines.push([l.launch_id, l.symbol, l.creator, l.status, l.total_active, l.funders, l.verdict, l.source].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

export function tradesCsv(ctx: Ctx, launchId: string | null): string {
  const id = launchId === null ? null : parseId(launchId);
  const rows = all(ctx.store, "SELECT * FROM trades WHERE (? IS NULL OR launch_id = ?) ORDER BY launch_id, block_height, ord, log_index", id, id);
  const lines = ["launch_id,time,side,trader,amount_in,amount_out,price,fee_total,block_height,receipt_id,source"];
  for (const r of rows) {
    const t = tradeJson(r);
    lines.push([t.launch_id, t.time, t.side, t.trader, t.amount_in, t.amount_out, t.price, t.fee_total, t.block_height, t.receipt_id, t.source].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

