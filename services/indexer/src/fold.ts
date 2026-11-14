import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { DEFAULT_TOKEN_DECIMALS, bucketStart, priceE12 } from "./price.ts";
import { INSTANT_ID_BASE, INTERVALS } from "./types.ts";
import type { StoredEvent } from "./types.ts";
import { bookNext, ZERO_BOOK_HASH } from "./book.ts";
import { OpsFolder } from "./fold-ops.ts";
import { ZERO, big, intOrNull, launchId, mixSource, nsToSec, optBig, str } from "./fold-util.ts";
import type { Emit, Row } from "./fold-util.ts";

/** Applies one event to the derived tables. Must be a pure function of (state, event) so replays agree. */
export class Folder {
  readonly db: DatabaseSync;
  private readonly ops: OpsFolder;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.ops = new OpsFolder(db, (id, e) => this.touchLaunch(id, e));
  }

  private get(sql: string, ...p: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...p) as Row | undefined;
  }
  private run(sql: string, ...p: SQLInputValue[]): void {
    this.db.prepare(sql).run(...p);
  }

  apply(e: StoredEvent, emit: Emit): void {
    this.checkNamespace(e);
    if (e.kind === "launcher") return this.applyLauncher(e, emit);
    switch (e.event) {
      case "charter_created": return this.charterCreated(e, emit);
      case "trial_opened": return this.trialOpened(e, emit);
      case "contributed": return this.book(e, emit, "contributed");
      case "walked": return this.book(e, emit, "walked");
      case "verdict": return this.verdict(e, emit);
      case "pass_allocated": return this.passAllocated(e, emit);
      case "payout_resolved": return this.payoutResolved(e, emit);
      case "tokens_claimed": return this.tokensClaimed(e);
      case "token_creation_failed": return this.setStatus(e, "creation_failed", emit);
      case "dissolved": return this.setStatus(e, "dissolved", emit);
      case "genesis_committed": return this.genesis(e, "committed", emit);
      case "genesis_confirmed": return this.genesis(e, "confirmed", emit);
      case "genesis_aborted": return this.genesis(e, "aborted", emit);
      case "genesis_reopened": case "f0_message_registered": case "f0_sign_requested": case "attest_log": return this.ops.genesisSide(e, emit);
      case "external_pool": return this.externalPool(e);
      case "pool_opened": return this.poolOpened(e, emit);
      case "swap": return this.swap(e, emit);
      case "creator_claimed": return this.creatorClaimed(e);
      case "market_paused": return this.marketPaused(e);
      default: return this.ops.apply(e, emit);
    }
  }

  /**
   * Trial and instant ids never collide: core events may only name ids below 1e9, launcher events only ids at or above it, and a market
   * pool must carry the mode that matches its id range (the market enforces R_ID_NAMESPACE; the indexer refuses to trust a mismatch).
   */
  private checkNamespace(e: StoredEvent): void {
    if (e.data.launch_id === undefined) return;
    const id = launchId(e.data);
    const instant = id >= INSTANT_ID_BASE;
    if (e.kind === "core" && instant) throw new Error(`core event for instant id ${id}`);
    if (e.kind === "launcher" && !instant) throw new Error(`launcher event for trial id ${id}`);
    if (e.kind === "market" && e.event === "pool_opened" && e.data.mode !== undefined && (e.data.mode === "instant") !== instant) {
      throw new Error(`pool mode ${String(e.data.mode)} does not match id ${id}`);
    }
  }

  private touchLaunch(id: number, e: StoredEvent): Row {
    const l = this.get("SELECT * FROM launches WHERE launch_id = ?", id);
    if (!l) throw new Error(`unknown launch ${id}`);
    this.run("UPDATE launches SET last_block = ?, source = ? WHERE launch_id = ?", e.blockHeight, mixSource(l.source, e.source), id);
    return l;
  }

  private charterCreated(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const creator = str(d.creator);
    const recipient = str(d.payout_recipient) || str(d.stream_recipient) || creator;
    const tokenDecimals = intOrNull(d.token_decimals) ?? DEFAULT_TOKEN_DECIMALS;
    this.run(
      `INSERT OR IGNORE INTO launches (launch_id, creator, payout_recipient, symbol, name, total_supply, charter_hash, status, created_at, total_active, funders,
        soft_cap, min_funders, stream_days, token_decimals, book_hash, reasons, contributed_total, walked_total, stream_total, stream_drawn, last_block, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, '0', 0, ?, ?, ?, ?, '', '[]', '0', '0', '0', '0', ?, ?)`,
      id, creator, recipient, str(d.symbol), str(d.name) || null, optBig(d.total_supply)?.toString() ?? null, str(d.charter_hash), e.time,
      optBig(d.soft_cap)?.toString() ?? null, intOrNull(d.min_funders), intOrNull(d.stream_days), tokenDecimals, e.blockHeight, e.source,
    );
    emit({ type: "launch", launchId: id });
  }

  private trialOpened(e: StoredEvent, emit: Emit): void {
    const id = launchId(e.data);
    this.touchLaunch(id, e);
    this.run("UPDATE launches SET status = 'open', opens_at = ?, commit_end = ?, walk_end = ? WHERE launch_id = ?",
      nsToSec(e.data.opens_at), nsToSec(e.data.commit_end), nsToSec(e.data.walk_end), id);
    emit({ type: "launch", launchId: id });
  }

  private book(e: StoredEvent, emit: Emit, kind: "contributed" | "walked"): void {
    const d = e.data;
    const id = launchId(d);
    const l = this.touchLaunch(id, e);
    const holder = str(d.holder);
    const amount = big(kind === "contributed" ? d.net : d.amount, kind);
    const col = kind === "contributed" ? "contributed" : "walked";
    const pos = this.get("SELECT * FROM positions WHERE launch_id = ? AND holder = ?", id, holder);
    const open = BigInt(String(pos?.contributed ?? ZERO)) - BigInt(String(pos?.walked ?? ZERO));
    const next = BigInt(String(pos?.[col] ?? ZERO)) + amount;
    this.run(
      `INSERT INTO positions (launch_id, holder, contributed, walked, tokens_claimed, source) VALUES (?, ?, '0', '0', '0', ?)
       ON CONFLICT (launch_id, holder) DO UPDATE SET source = excluded.source`,
      id, holder, mixSource(pos?.source, e.source),
    );
    this.run(`UPDATE positions SET ${col} = ? WHERE launch_id = ? AND holder = ?`, next.toString(), id, holder);
    const totalCol = kind === "contributed" ? "contributed_total" : "walked_total";
    this.run(`UPDATE launches SET ${totalCol} = ?, total_active = ?, funders = ?, book_hash = ? WHERE launch_id = ?`,
      (BigInt(String(l[totalCol])) + amount).toString(), big(d.total_active, "total_active").toString(),
      intOrNull(d.funders) ?? 0, str(d.book_hash), id);
    this.foldBook(e, l, kind, holder, amount, open);
    emit({ type: "launch", launchId: id });
  }

  /** Replays the contract's rolling book hash from the events alone and records the first height where the logged hash disagrees. */
  private foldBook(e: StoredEvent, l: Row, kind: "contributed" | "walked", holder: string, amount: bigint, openBefore: bigint): void {
    const contributed = kind === "contributed";
    const total = BigInt(String(l.contributed_total)) - BigInt(String(l.walked_total)) + (contributed ? amount : -amount);
    const funders = Math.max(0, Number(l.book_funders) + (contributed ? (openBefore === 0n ? 1 : 0) : -1));
    const prev = String(l.book_hash_recomputed) || ZERO_BOOK_HASH;
    const hash = bookNext(prev, contributed ? 1 : 2, holder, amount, total < 0n ? 0n : total, funders);
    const logged = str(e.data.book_hash);
    const bad = logged !== "" && logged !== hash && l.book_mismatch_at === null;
    this.run("UPDATE launches SET book_hash_recomputed = ?, book_events = book_events + 1, book_funders = ?, book_mismatch_at = COALESCE(book_mismatch_at, ?) WHERE launch_id = ?",
      hash, funders, bad ? e.blockHeight : null, Number(l.launch_id));
  }

  private verdict(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    this.touchLaunch(id, e);
    const pass = d.outcome === "PASS";
    const reasons = Array.isArray(d.reasons) ? d.reasons.filter((r): r is string => typeof r === "string") : [];
    this.run(
      "UPDATE launches SET status = ?, verdict = ?, inputs_hash = ?, reasons = ?, settled_at = ?, total_active = ?, funders = ? WHERE launch_id = ?",
      pass ? "passed" : "failed", pass ? "PASS" : "FAIL", str(d.inputs_hash) || null, JSON.stringify(reasons), e.time,
      big(d.total_active, "total_active").toString(), intOrNull(d.funders) ?? 0, id,
    );
    emit({ type: "launch", launchId: id });
  }

  private passAllocated(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    this.touchLaunch(id, e);
    const alloc = Object.fromEntries(["accepted", "launch_fee", "lp_quote", "stream", "excess_pool"].map((k) => [k, big(d[k], k).toString()]));
    this.run("UPDATE launches SET allocation = ?, stream_total = ? WHERE launch_id = ?", JSON.stringify(alloc), alloc.stream ?? ZERO, id);
    emit({ type: "launch", launchId: id });
  }

  private payoutResolved(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const l = this.touchLaunch(id, e);
    const kind = str(d.kind);
    const amount = big(d.amount, "amount");
    const ok = d.ok === true;
    this.run("INSERT OR REPLACE INTO payouts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, e.blockHeight, e.ord, e.logIndex, e.receiptId, e.time, kind, amount.toString(), ok ? 1 : 0, str(l.payout_recipient), e.source);
    this.ops.payoutResolved(id, kind, ok, amount, e);
    if (kind === "Stream" && ok) {
      this.run("UPDATE launches SET stream_drawn = ? WHERE launch_id = ?", (BigInt(String(l.stream_drawn)) + amount).toString(), id);
    }
    emit({ type: "launch", launchId: id });
  }

  private tokensClaimed(e: StoredEvent): void {
    const d = e.data;
    const id = launchId(d);
    this.touchLaunch(id, e);
    const holder = str(d.holder);
    const amount = big(d.amount, "amount");
    const pos = this.get("SELECT * FROM positions WHERE launch_id = ? AND holder = ?", id, holder);
    this.run(
      `INSERT INTO positions (launch_id, holder, contributed, walked, tokens_claimed, source) VALUES (?, ?, '0', '0', ?, ?)
       ON CONFLICT (launch_id, holder) DO UPDATE SET tokens_claimed = ?, source = excluded.source`,
      id, holder, amount.toString(), mixSource(pos?.source, e.source), (BigInt(String(pos?.tokens_claimed ?? ZERO)) + amount).toString(),
    );
    this.addBalance(id, holder.startsWith("near:") ? holder.slice(5) : holder, amount);
  }

  private setStatus(e: StoredEvent, status: string, emit: Emit): void {
    const id = launchId(e.data);
    this.touchLaunch(id, e);
    this.run("UPDATE launches SET status = ? WHERE launch_id = ?", status, id);
    emit({ type: "launch", launchId: id });
  }

  private addBalance(id: number, holder: string, delta: bigint): void {
    const cur = this.get("SELECT balance FROM balances WHERE launch_id = ? AND holder = ?", id, holder);
    const next = BigInt(String(cur?.balance ?? ZERO)) + delta;
    this.run("INSERT OR REPLACE INTO balances VALUES (?, ?, ?)", id, holder, next.toString());
  }

  private poolOpened(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const l = this.touchLaunch(id, e);
    const authNull = (k: string): number | null => (k in d ? (d[k] === null ? 1 : 0) : null);
    const terms = typeof d.terms === "object" && d.terms !== null ? (d.terms as Row) : null;
    const nsOpen = nsToSec(d.opened_ns);
    const tradeFrom = nsToSec(d.trade_from_ns) || null; // absent or 0 = trading opened with the pool
    this.run(
      `INSERT OR IGNORE INTO pools (launch_id, opened_at, quote_reserve, token_reserve, fee_bps, paused, payout_recipient, token_decimals,
         mint_authority_null, freeze_authority_null, creator_bps, creator_claimed, creator_fees, fees_total, source, token, market, terms, mode, creator, trade_from)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, '0', '0', '0', ?, ?, ?, ?, ?, ?, ?)`,
      id, nsOpen ?? e.time, (optBig(d.q) ?? optBig(d.quote_reserve))?.toString() ?? null, (optBig(d.t) ?? optBig(d.token_reserve))?.toString() ?? null,
      intOrNull(d.fee_bps), str(d.payout_recipient) || str(l.payout_recipient), intOrNull(d.token_decimals) ?? Number(l.token_decimals),
      authNull("mint_authority"), authNull("freeze_authority"), intOrNull(d.creator_bps), e.source,
      str(d.token) || null, e.contract, terms ? JSON.stringify(terms) : null, d.mode === "instant" ? "instant" : "trial", str(d.creator) || null,
      tradeFrom,
    );
    if (d.mode === "instant" && typeof d.token === "string") this.run("UPDATE instants SET token = COALESCE(token, ?) WHERE launch_id = ?", d.token, id);
    const supply = optBig(d.total_supply);
    if (supply !== null) this.run("UPDATE launches SET total_supply = ? WHERE launch_id = ?", supply.toString(), id);
    if (this.get("SELECT 1 AS x FROM flags WHERE k = 'market_paused_global'")) {
      this.run("UPDATE pools SET paused = 1 WHERE launch_id = ?", id);
    }
    emit({ type: "launch", launchId: id });
  }

  private feeSlices(d: Row): Record<string, string> | null {
    const src = (typeof d.slices === "object" && d.slices !== null ? d.slices : typeof d.fee_slices === "object" && d.fee_slices !== null ? d.fee_slices : d) as Row;
    const pick = (k: string): unknown => src[k] ?? src[`fee_${k}`];
    const names = ["creator", "platform", "holders", "lp", "referral"];
    if (names.some((n) => optBig(pick(n)) === null)) return null;
    const out = Object.fromEntries(names.map((n) => [n, String(optBig(pick(n)))]));
    for (const extra of ["surcharge", "red_holders", "red_referral"]) {
      const v = optBig(src[extra]);
      if (v !== null) out[extra] = v.toString();
    }
    return out;
  }

  private swap(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const pool = this.get("SELECT * FROM pools WHERE launch_id = ?", id);
    if (!pool) throw new Error(`swap before pool_opened for launch ${id}`);
    const side = d.side === "buy" || d.side === "sell" ? d.side : null;
    if (!side) throw new Error("bad swap side");
    const amountIn = big(d.amount_in, "amount_in");
    const amountOut = big(d.amount_out, "amount_out");
    const fee = optBig(d.fee_total) ?? 0n;
    // Gross USDC: a buy pays amount_in; a sell receives amount_out net of the fee (EVENTS.md), so add the fee back.
    const quote = side === "buy" ? amountIn : amountOut + fee;
    const token = side === "buy" ? amountOut : amountIn;
    const qr = optBig(d.q) ?? optBig(d.quote_reserve) ?? optBig((d.reserves_after as Row | undefined)?.quote);
    const tr = optBig(d.t) ?? optBig(d.token_reserve) ?? optBig((d.reserves_after as Row | undefined)?.token);
    const dec = Number(pool.token_decimals);
    // EVENTS.md: the chart price is q/t after the swap; fall back to the execution price when reserves are not logged.
    const price = (qr !== null && tr !== null ? priceE12(qr, tr, dec) : null) ?? priceE12(quote, token, dec);
    if (price === null) throw new Error("zero token amount in swap");
    const trader = str(d.trader) || str(d.account);
    const holder = side === "buy" ? str(d.receiver) || trader : trader;
    const slices = this.feeSlices(d);
    this.run("INSERT OR REPLACE INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, e.blockHeight, e.ord, e.logIndex, e.receiptId, e.time, side, trader, amountIn.toString(), amountOut.toString(),
      quote.toString(), token.toString(), price.toString(), fee.toString(), slices ? JSON.stringify(slices) : null,
      qr?.toString() ?? null, tr?.toString() ?? null, e.source);
    this.addBalance(id, holder, side === "buy" ? amountOut : -amountIn);
    const add = (col: string, v: string | undefined): string => (BigInt(String(pool[col])) + BigInt(v ?? "0")).toString();
    this.run(
      `UPDATE pools SET quote_reserve = COALESCE(?, quote_reserve), token_reserve = COALESCE(?, token_reserve), fees_total = ?, creator_fees = ?,
         fees_platform = ?, fees_holders = ?, fees_lp = ?, fees_referral = ?, source = ? WHERE launch_id = ?`,
      qr?.toString() ?? null, tr?.toString() ?? null, add("fees_total", fee.toString()), add("creator_fees", slices?.creator),
      add("fees_platform", slices?.platform), add("fees_holders", slices?.holders), add("fees_lp", slices?.lp), add("fees_referral", slices?.referral),
      mixSource(pool.source, e.source), id,
    );
    this.touchLaunch(id, e);
    emit({ type: "trade", launchId: id, trade: { launch_id: String(id), side, trader, price_e12: price.toString(), quote: quote.toString(), time: e.time, source: e.source, block_height: e.blockHeight, receipt_id: e.receiptId } });
    this.updateCandles(id, e.time, price, quote, e.source, emit);
  }

  /** Folds genesis_committed, genesis_confirmed (EVENTS.md core section) and genesis_aborted; old proposed field names stay accepted. */
  private genesis(e: StoredEvent, stage: "committed" | "confirmed" | "aborted", emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    this.touchLaunch(id, e);
    const cur = this.get("SELECT * FROM genesis WHERE launch_id = ?", id);
    if (cur?.stage === "confirmed" && stage === "committed") return;
    const text = (...keys: string[]): string | null => {
      for (const k of keys) if (typeof d[k] === "string" && d[k] !== "") return d[k] as string;
      return null;
    };
    const keep = (k: string, v: string | null): string | null => v ?? ((cur?.[k] as string | null | undefined) ?? null);
    const authority = (k: string): string => (k in d ? (d[k] === null ? "null" : "set") : String(cur?.[k] ?? "unknown"));
    const list = (k: string, fallback: unknown): string[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter((c): c is string => typeof c === "string") : (JSON.parse(String(fallback ?? "[]")) as string[]));
    this.run(
      `INSERT OR REPLACE INTO genesis (launch_id, stage, network, path, spec_hash, mint, tx_create, tx_authority, distributor, root, mint_authority, freeze_authority,
         checks, updated_at, source, signatures, slot, ceremony_hash, leaf_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, stage, keep("network", text("network")), keep("path", text("path", "mode")), keep("spec_hash", text("spec_hash", "genesis_spec_hash")), keep("mint", text("mint")),
      keep("tx_create", text("tx_create")), keep("tx_authority", text("tx_authority")), keep("distributor", text("distributor")), keep("root", text("root", "merkle_root")),
      authority("mint_authority"), authority("freeze_authority"), JSON.stringify(list("verified_checks", cur?.checks)), e.time, mixSource(cur?.source, e.source),
      JSON.stringify(list("sigs", cur?.signatures)), keep("slot", text("slot") ?? (typeof d.slot === "number" ? String(d.slot) : null)),
      keep("ceremony_hash", text("ceremony_hash")), intOrNull(d.leaf_count) ?? ((cur?.leaf_count as number | null | undefined) ?? null),
    );
    this.ops.genesisExtras(id, stage, d, cur);
    emit({ type: "launch", launchId: id });
  }

  private externalPool(e: StoredEvent): void {
    const d = e.data;
    const id = launchId(d);
    this.touchLaunch(id, e);
    if (typeof d.venue !== "string" || typeof d.pool !== "string" || typeof d.url !== "string") throw new Error("bad external_pool");
    this.run("INSERT OR REPLACE INTO external_pools VALUES (?, ?, ?, ?, ?)", id, d.venue, d.pool, d.url, e.source);
  }

  private updateCandles(id: number, time: number, price: bigint, quote: bigint, source: string, emit: Emit): void {
    for (const interval of INTERVALS) {
      const t = bucketStart(time, interval);
      const cur = this.get("SELECT * FROM candles WHERE launch_id = ? AND interval = ? AND t = ?", id, interval, t);
      const o = cur ? String(cur.o) : price.toString();
      const h = cur && BigInt(String(cur.h)) > price ? String(cur.h) : price.toString();
      const l = cur && BigInt(String(cur.l)) < price ? String(cur.l) : price.toString();
      const v = (BigInt(String(cur?.v ?? ZERO)) + quote).toString();
      const n = Number(cur?.n ?? 0) + 1;
      const src = mixSource(cur?.source, source);
      this.run("INSERT OR REPLACE INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, interval, t, o, h, l, price.toString(), v, n, src);
      if (interval === "1m") emit({ type: "candle", launchId: id, candle: { t, o, h, l, c: price.toString(), v, n, source: src } });
    }
  }

  private applyLauncher(e: StoredEvent, emit: Emit): void {
    switch (e.event) {
      case "instant_created": return this.instantCreated(e, emit);
      case "instant_token_ready": return this.instantStatus(e, "token_ready", emit);
      case "instant_creation_failed": return this.instantFail(e, "creation_failed", emit);
      case "instant_seeded": return this.instantStatus(e, "seeded", emit);
      case "instant_handoff": return this.instantStatus(e, "handoff", emit);
      case "instant_opened": return this.instantOpened(e, emit);
      case "instant_abandoned": return this.instantFail(e, "abandoned", emit);
      case "instant_aborted": return this.instantFail(e, "aborted", emit);
      case "alloc_claimed": return this.allocClaimed(e, emit);
      case "fee_credited": return this.feeCredited(e);
      default: return this.ops.apply(e, emit);
    }
  }

  private instantCreated(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const creator = str(d.creator);
    const supply = optBig(d.total_supply);
    const seed = big(d.seed_q, "seed_q");
    const fee = optBig(d.launch_fee) ?? 0n;
    this.run(
      `INSERT OR IGNORE INTO launches (launch_id, creator, payout_recipient, symbol, name, total_supply, mode, charter_hash, status, created_at, total_active, funders,
        token_decimals, book_hash, reasons, contributed_total, walked_total, stream_total, stream_drawn, last_block, source)
       VALUES (?, ?, ?, ?, ?, ?, 'instant', ?, 'creating', ?, '0', 0, ?, '', '[]', '0', '0', '0', '0', ?, ?)`,
      id, creator, str(d.payout_recipient) || creator, str(d.symbol), str(d.name) || null, supply?.toString() ?? null, str(d.charter_hash), e.time,
      intOrNull(d.token_decimals) ?? DEFAULT_TOKEN_DECIMALS, e.blockHeight, e.source,
    );
    this.run(
      `INSERT OR IGNORE INTO instants (launch_id, creator_alloc, pool_tokens, cliff_days, vest_days, seed_q, launch_fee, supply_model, terms, source, trade_delay_secs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, (optBig(d.creator_alloc) ?? 0n).toString(), (optBig(d.pool_tokens) ?? 0n).toString(), intOrNull(d.cliff_days) ?? 0, intOrNull(d.vest_days) ?? 0,
      seed.toString(), fee.toString(), str(d.supply_model) || "near_factory_fixed", d.terms ? JSON.stringify(d.terms) : null, e.source,
      intOrNull(d.trade_delay_secs) ?? 0,
    );
    emit({ type: "launch", launchId: id });
  }

  private instantRow(id: number, e: StoredEvent): Row {
    const i = this.get("SELECT * FROM instants WHERE launch_id = ?", id);
    if (!i) throw new Error(`launcher event before instant_created for ${id}`);
    this.touchLaunch(id, e);
    this.run("UPDATE instants SET source = ? WHERE launch_id = ?", mixSource(i.source, e.source), id);
    return i;
  }

  private instantStatus(e: StoredEvent, status: string, emit: Emit): void {
    const id = launchId(e.data);
    this.instantRow(id, e);
    this.run("UPDATE launches SET status = ? WHERE launch_id = ?", status, id);
    if (status === "token_ready" && typeof e.data.token === "string") this.run("UPDATE instants SET token = ? WHERE launch_id = ?", e.data.token, id);
    emit({ type: "launch", launchId: id });
  }

  private instantFail(e: StoredEvent, status: string, emit: Emit): void {
    const id = launchId(e.data);
    this.instantRow(id, e);
    this.run("UPDATE launches SET status = ? WHERE launch_id = ?", status, id);
    this.run("UPDATE instants SET failure = ? WHERE launch_id = ?", status, id);
    emit({ type: "launch", launchId: id });
  }

  private instantOpened(e: StoredEvent, emit: Emit): void {
    const id = launchId(e.data);
    this.instantRow(id, e);
    this.run("UPDATE launches SET status = 'trading' WHERE launch_id = ?", id);
    this.run("UPDATE instants SET opened_at = ?, token = COALESCE(?, token) WHERE launch_id = ?", nsToSec(e.data.opened_at) ?? e.time, str(e.data.token) || null, id);
    emit({ type: "launch", launchId: id });
  }

  private allocClaimed(e: StoredEvent, emit: Emit): void {
    const d = e.data;
    const id = launchId(d);
    const i = this.instantRow(id, e);
    const amount = big(d.amount, "amount");
    const total = optBig(d.claimed_total) ?? BigInt(String(i.alloc_claimed)) + amount;
    const recipient = str(d.recipient);
    this.run("UPDATE instants SET alloc_claimed = ? WHERE launch_id = ?", total.toString(), id);
    this.run("INSERT OR REPLACE INTO payouts VALUES (?, ?, ?, ?, ?, ?, 'alloc_claimed', ?, 1, ?, ?)",
      id, e.blockHeight, e.ord, e.logIndex, e.receiptId, e.time, amount.toString(), recipient, e.source);
    this.addBalance(id, recipient, amount);
    emit({ type: "launch", launchId: id });
  }

  private feeCredited(e: StoredEvent): void {
    const id = launchId(e.data);
    const i = this.instantRow(id, e);
    this.run("UPDATE instants SET fee_credited = ? WHERE launch_id = ?", (BigInt(String(i.fee_credited)) + big(e.data.amount, "amount")).toString(), id);
  }

  private creatorClaimed(e: StoredEvent): void {
    const d = e.data;
    const id = launchId(d);
    const pool = this.get("SELECT * FROM pools WHERE launch_id = ?", id);
    if (!pool) throw new Error(`creator_claimed before pool_opened for launch ${id}`);
    const amount = big(d.amount, "amount");
    this.run("UPDATE pools SET creator_claimed = ? WHERE launch_id = ?", (BigInt(String(pool.creator_claimed)) + amount).toString(), id);
    this.run("INSERT OR REPLACE INTO payouts VALUES (?, ?, ?, ?, ?, ?, 'creator_claimed', ?, 1, ?, ?)",
      id, e.blockHeight, e.ord, e.logIndex, e.receiptId, e.time, amount.toString(), str(d.recipient) || str(pool.payout_recipient), e.source);
  }

  private marketPaused(e: StoredEvent): void {
    const paused = e.data.paused === false ? 0 : 1;
    this.ops.marketState(e);
    if (e.data.launch_id === undefined) {
      this.run("DELETE FROM flags WHERE k = 'market_paused_global'");
      if (paused) this.run("INSERT INTO flags VALUES ('market_paused_global', '1')");
      this.run("UPDATE pools SET paused = ?", paused);
      return;
    }
    this.run("UPDATE pools SET paused = ? WHERE launch_id = ?", paused, launchId(e.data));
  }
}
