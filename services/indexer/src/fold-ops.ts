import type { DatabaseSync } from "node:sqlite";
import { ZERO, Sql, big, intOrNull, launchId, mixSource, nsToSec, optBig, optStr, str } from "./fold-util.ts";
import type { Emit, Row } from "./fold-util.ts";
import type { StoredEvent } from "./types.ts";

type Touch = (id: number, e: StoredEvent) => Row;
type Json = Record<string, unknown>;

const SOLVENCY_LEGS = ["native", "intents"] as const;

/**
 * Folds the operations, custody and governance events (ops log, halts, upgrade queue, force-resolves, solvency reports, owed balances,
 * launch token custody, genesis side data). Pure function of (state, event) like the main Folder: replays and reorg rebuilds agree.
 */
export class OpsFolder {
  private readonly sql: Sql;
  private readonly touch: Touch;

  constructor(db: DatabaseSync, touch: Touch) {
    this.sql = new Sql(db);
    this.touch = touch;
  }

  apply(e: StoredEvent, emit: Emit): void {
    switch (e.event) {
      case "paused": case "frozen": case "unpaused": return this.pauseState(e);
      case "genesis_paused": case "genesis_resumed": return this.setFlag("state:genesis", { paused: e.event === "genesis_paused", by: str(e.data.by) || null, at: e.time });
      case "genesis_relayer_set": return this.setFlag("genesis_relayer", { account: str(e.data.account), at: e.time });
      case "beta_opened": return this.setFlag(`beta:${e.kind}`, { by: str(e.data.by) || null, at: e.time });
      case "market_set": return this.setFlag(`market_account:${e.kind}`, { account: str(e.data.market), at: e.time });
      case "global_cap_lowered": case "global_cap_queued": case "global_cap_applied": return this.cap("cap:global", e);
      case "launch_cap_queued": case "launch_cap_applied": return this.cap("cap:launch", e);
      case "cap_lowered": case "cap_queued": case "cap_applied": return this.cap(`cap:launcher:${str(e.data.kind, "seed")}`, e);
      case "halted": case "resumed": return this.halt(e, emit);
      case "upgrade_queued": case "upgrade_cancelled": case "upgraded": return this.upgrade(e);
      case "force_resolve_queued": case "op_force_resolved": return this.forceResolve(e);
      case "solvency_report": return this.solvency(e);
      case "owed_near_credited": case "owed_near_withdrawn": case "owed_credited": case "owed_claimed": return this.owed(e);
      case "creator_alloc_claimed": case "tokens_swept": case "stream_lengthened": case "refund_batch": case "refund_route_set":
      case "token_delivery_refused": case "orphan_credit_refused": case "deposit_rejected_refundable": return this.custody(e);
      default: return;
    }
  }

  /** Called by the main folder for `market_paused`, which it already applies to the pools. */
  marketState(e: StoredEvent): void {
    const launch = e.data.launch_id === undefined ? null : String(e.data.launch_id);
    if (launch === null) this.setFlag("state:market", { paused: e.data.paused !== false, by: str(e.data.by) || null, at: e.time });
  }

  /** A failed AllocClaim or Sweep leg re-credits exactly what the debit took (contract `settle_token_leg`). */
  payoutResolved(id: number, kind: string, ok: boolean, amount: bigint, e: StoredEvent): void {
    if (ok || (kind !== "AllocClaim" && kind !== "Sweep")) return;
    const c = this.custodyRow(id, e);
    const col = kind === "AllocClaim" ? "alloc_claimed" : "swept";
    const next = BigInt(String(c[col])) - amount;
    this.sql.run(`UPDATE launch_custody SET ${col} = ? WHERE launch_id = ?`, (next < 0n ? 0n : next).toString(), id);
  }

  /** Genesis fields the contract keeps beside the committed data: abort reason, F0 messages, attestation hashes, reopen count. */
  genesisExtras(id: number, stage: string, d: Json, cur: Row | undefined): void {
    const list = (k: string): unknown[] => JSON.parse(String(cur?.[k] ?? "[]")) as unknown[];
    const aborted = stage === "aborted";
    this.sql.run(
      `UPDATE genesis SET reopen_count = ?, reopened_at = ?, abort_reason = ?, abort_by = ?, max_total_claim = ?, f0_messages = ?, f0_sign_requests = ?, attestations = ? WHERE launch_id = ?`,
      Number(cur?.reopen_count ?? 0), (cur?.reopened_at as number | null | undefined) ?? null,
      aborted ? str(d.reason) : ((cur?.abort_reason as string | null | undefined) ?? null), aborted ? str(d.by) : ((cur?.abort_by as string | null | undefined) ?? null),
      optStr(d.max_total_claim) ?? ((cur?.max_total_claim as string | null | undefined) ?? null),
      JSON.stringify(list("f0_messages")), JSON.stringify(list("f0_sign_requests")), JSON.stringify(list("attestations")), id,
    );
  }

  genesisSide(e: StoredEvent, emit: Emit): void {
    const id = launchId(e.data);
    this.touch(id, e);
    this.sql.run("INSERT OR IGNORE INTO genesis (launch_id, stage, mint_authority, freeze_authority, checks, updated_at, source) VALUES (?, 'pending', 'unknown', 'unknown', '[]', ?, ?)", id, e.time, e.source);
    const row = this.sql.get("SELECT * FROM genesis WHERE launch_id = ?", id) as Row;
    this.sql.run("UPDATE genesis SET updated_at = ?, source = ? WHERE launch_id = ?", e.time, mixSource(row.source, e.source), id);
    if (e.event === "genesis_reopened") this.reopenGenesis(id, row, e);
    if (e.event === "f0_message_registered") this.f0Message(id, row, e);
    if (e.event === "f0_sign_requested") this.pushUnique(id, row, "f0_sign_requests", intOrNull(e.data.tx_index));
    if (e.event === "attest_log") this.pushUnique(id, row, "attestations", str(e.data.attestation_hash) || null);
    emit({ type: "launch", launchId: id });
  }

  /** The contract resets the whole genesis record to its default; only the reopen history survives, in the counters and the event log. */
  private reopenGenesis(id: number, row: Row, e: StoredEvent): void {
    this.sql.run(
      `UPDATE genesis SET stage = 'pending', network = NULL, path = NULL, spec_hash = NULL, mint = NULL, tx_create = NULL, tx_authority = NULL, distributor = NULL, root = NULL,
         mint_authority = 'unknown', freeze_authority = 'unknown', checks = '[]', signatures = '[]', slot = NULL, ceremony_hash = NULL, leaf_count = NULL,
         reopen_count = ?, reopened_at = ?, abort_reason = NULL, abort_by = NULL, max_total_claim = NULL, f0_messages = '[]', f0_sign_requests = '[]', attestations = '[]'
       WHERE launch_id = ?`,
      Number(row.reopen_count) + 1, e.time, id,
    );
  }

  private f0Message(id: number, row: Row, e: StoredEvent): void {
    const index = intOrNull(e.data.tx_index);
    const hash = str(e.data.message_sha256);
    if (index === null || hash === "") throw new Error("bad f0_message_registered");
    const list = (JSON.parse(String(row.f0_messages)) as Array<{ tx_index: number; message_sha256: string }>).filter((m) => m.tx_index !== index);
    list.push({ tx_index: index, message_sha256: hash });
    list.sort((a, b) => a.tx_index - b.tx_index);
    this.sql.run("UPDATE genesis SET f0_messages = ? WHERE launch_id = ?", JSON.stringify(list), id);
  }

  private pushUnique(id: number, row: Row, col: "f0_sign_requests" | "attestations", value: string | number | null): void {
    if (value === null) throw new Error(`bad value for ${col}`);
    const list = JSON.parse(String(row[col])) as Array<string | number>;
    if (!list.includes(value)) list.push(value);
    this.sql.run(`UPDATE genesis SET ${col} = ? WHERE launch_id = ?`, JSON.stringify(list), id);
  }

  private setFlag(k: string, v: Json): void {
    this.sql.run("INSERT OR REPLACE INTO flags VALUES (?, ?)", k, JSON.stringify(v));
  }

  private flag(k: string): Json | null {
    const r = this.sql.get("SELECT v FROM flags WHERE k = ?", k);
    return r ? (JSON.parse(String(r.v)) as Json) : null;
  }

  private pauseState(e: StoredEvent): void {
    const state = e.event === "paused" ? "paused" : e.event === "frozen" ? "frozen" : "live";
    this.setFlag(`state:${e.kind}`, { state, by: str(e.data.by) || null, until: e.event === "frozen" ? nsToSec(e.data.until) : null, at: e.time });
  }

  /** `queued` holds a timelocked raise; applying it (or an instant lowering of the cap itself) clears or replaces the applied value. */
  private cap(key: string, e: StoredEvent): void {
    const cur = this.flag(key) ?? { value: null, queued: null };
    const value = optBig(e.data.value)?.toString() ?? null;
    if (e.event.endsWith("queued")) cur.queued = { value, effective_at: nsToSec(e.data.effective_at), queued_at: e.time };
    else {
      cur.value = value;
      cur.queued = e.event.endsWith("applied") ? null : cur.queued;
      cur.changed_at = e.time;
    }
    this.setFlag(key, cur);
  }

  private halt(e: StoredEvent, emit: Emit): void {
    const id = launchId(e.data);
    const cur = this.sql.get("SELECT * FROM halts WHERE launch_id = ?", id);
    const on = e.event === "halted";
    this.sql.run(
      `INSERT OR REPLACE INTO halts (launch_id, halted, halted_by, reason, halted_at, resumed_at, halt_count, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, on ? 1 : 0, on ? str(e.data.by) : ((cur?.halted_by as string | null | undefined) ?? null), on ? str(e.data.reason) : ((cur?.reason as string | null | undefined) ?? null),
      on ? e.time : ((cur?.halted_at as number | null | undefined) ?? null), on ? null : e.time, Number(cur?.halt_count ?? 0) + (on ? 1 : 0), mixSource(cur?.source, e.source),
    );
    emit({ type: "launch", launchId: id });
  }

  /** At most one upgrade is pending in the contract: a new queue call replaces the old one without an event, so the old row becomes `superseded`. */
  private upgrade(e: StoredEvent): void {
    const hash = str(e.data.code_hash);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad code_hash");
    const pending = this.sql.get("SELECT * FROM upgrades WHERE status = 'queued' ORDER BY block_height DESC, ord DESC, log_index DESC LIMIT 1");
    if (e.event === "upgrade_queued") {
      if (pending) this.sql.run("UPDATE upgrades SET status = 'superseded', resolved_at = ? WHERE block_height = ? AND ord = ? AND log_index = ?", e.time, pending.block_height as number, pending.ord as number, pending.log_index as number);
      this.sql.run("INSERT INTO upgrades VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, ?)", e.blockHeight, e.ord, e.logIndex, hash, e.time, nsToSec(e.data.effective_at), e.source);
      return;
    }
    const status = e.event === "upgraded" ? "applied" : "cancelled";
    if (pending && pending.code_hash === hash) {
      this.sql.run("UPDATE upgrades SET status = ?, resolved_at = ?, resolved_by = ? WHERE block_height = ? AND ord = ? AND log_index = ?", status, e.time, str(e.data.by) || null, pending.block_height as number, pending.ord as number, pending.log_index as number);
      return;
    }
    this.sql.run("INSERT INTO upgrades VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)", e.blockHeight, e.ord, e.logIndex, hash, status, e.time, e.time, str(e.data.by) || null, e.source);
  }

  /** The event does not name the leg (kind, holder), so a resolution closes the oldest queued entry with the same launch, amount and ok. */
  private forceResolve(e: StoredEvent): void {
    const id = launchId(e.data);
    const amount = big(e.data.amount, "amount").toString();
    const ok = e.data.ok === true ? 1 : 0;
    if (e.event === "force_resolve_queued") {
      this.sql.run("INSERT INTO force_resolves VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, ?)", e.blockHeight, e.ord, e.logIndex, id, amount, ok, e.time, nsToSec(e.data.effective_at), e.source);
      return;
    }
    const queued = this.sql.get("SELECT * FROM force_resolves WHERE state = 'queued' AND launch_id = ? AND amount = ? AND ok = ? ORDER BY block_height, ord, log_index LIMIT 1", id, amount, ok);
    const evidence = str(e.data.evidence);
    if (queued) {
      this.sql.run("UPDATE force_resolves SET state = 'executed', executed_at = ?, evidence = ? WHERE block_height = ? AND ord = ? AND log_index = ?", e.time, evidence, queued.block_height as number, queued.ord as number, queued.log_index as number);
      return;
    }
    this.sql.run("INSERT INTO force_resolves VALUES (?, ?, ?, ?, ?, ?, 'executed', NULL, NULL, ?, ?, ?)", e.blockHeight, e.ord, e.logIndex, id, amount, ok, e.time, evidence, e.source);
  }

  private solvency(e: StoredEvent): void {
    const d = e.data;
    const leg = (k: (typeof SOLVENCY_LEGS)[number]): { balance: string | null; liability: string | null; ok: number | null } => {
      const v = d[k];
      if (typeof v !== "object" || v === null) return { balance: null, liability: null, ok: null };
      const o = v as Json;
      return { balance: optBig(o.balance)?.toString() ?? null, liability: optBig(o.liability)?.toString() ?? null, ok: o.ok === true ? 1 : o.ok === false ? 0 : null };
    };
    const n = leg("native");
    const i = leg("intents");
    this.sql.run("INSERT INTO solvency_reports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      e.blockHeight, e.ord, e.logIndex, e.time, nsToSec(d.at), d.ok === true ? 1 : 0, d.intents_alert === true ? 1 : 0,
      n.balance, n.liability, n.ok, i.balance, i.liability, i.ok, e.receiptId, e.source);
  }

  /** Core `owed_near_*` carry no token (NEAR); market and launcher `owed_*` name the token. balance = credited - claimed (withdrawals debit first). */
  private owed(e: StoredEvent): void {
    const near = e.event.startsWith("owed_near");
    const account = str(e.data.account);
    const token = near ? "NEAR" : str(e.data.token);
    if (account === "" || token === "") throw new Error("bad owed event");
    const amount = big(e.data.amount, "amount");
    const credit = e.event.endsWith("credited");
    const cur = this.sql.get("SELECT * FROM owed WHERE scope = ? AND account = ? AND token = ?", e.kind, account, token);
    const credited = BigInt(String(cur?.credited ?? ZERO)) + (credit ? amount : 0n);
    const claimed = BigInt(String(cur?.claimed ?? ZERO)) + (credit ? 0n : amount);
    this.sql.run("INSERT OR REPLACE INTO owed VALUES (?, ?, ?, ?, ?, ?, ?)", e.kind, account, token, credited.toString(), claimed.toString(), e.time, mixSource(cur?.source, e.source));
  }

  private custodyRow(id: number, e: StoredEvent): Row {
    this.touch(id, e);
    const cur = this.sql.get("SELECT * FROM launch_custody WHERE launch_id = ?", id);
    if (!cur) this.sql.run("INSERT INTO launch_custody VALUES (?, '0', '0', NULL, NULL, NULL, 0, 0, 0, 0, 0, 0, 0, 0, ?, NULL)", id, e.source);
    else this.sql.run("UPDATE launch_custody SET source = ? WHERE launch_id = ?", mixSource(cur.source, e.source), id);
    return cur ?? (this.sql.get("SELECT * FROM launch_custody WHERE launch_id = ?", id) as Row);
  }

  private custody(e: StoredEvent): void {
    const id = launchId(e.data);
    const c = this.custodyRow(id, e);
    const bump = (col: string, by = 1): void => this.sql.run(`UPDATE launch_custody SET ${col} = ${col} + ? WHERE launch_id = ?`, by, id);
    const add = (col: "alloc_claimed" | "swept"): void =>
      this.sql.run(`UPDATE launch_custody SET ${col} = ? WHERE launch_id = ?`, (BigInt(String(c[col])) + big(e.data.amount, "amount")).toString(), id);
    switch (e.event) {
      case "creator_alloc_claimed": return add("alloc_claimed");
      case "tokens_swept":
        add("swept");
        return this.sql.run("UPDATE launch_custody SET sweep_mode = ? WHERE launch_id = ?", str(e.data.mode) || null, id);
      case "stream_lengthened":
        return this.sql.run("UPDATE launch_custody SET stream_end_ns = ?, stream_unlocked_at_change = ?, stream_changed_at = ?, stream_lengthened = stream_lengthened + 1 WHERE launch_id = ?",
          big(e.data.end_ns, "end_ns").toString(), big(e.data.unlocked_at_change, "unlocked_at_change").toString(), e.time, id);
      case "refund_batch":
        bump("refund_batches");
        bump("refund_handled", intOrNull(e.data.handled) ?? 0);
        return bump("refund_paid", intOrNull(e.data.paid) ?? 0);
      case "refund_route_set": return bump("refund_routes");
      case "token_delivery_refused": return bump("delivery_refusals");
      case "orphan_credit_refused": return bump("orphan_refusals");
      default: return bump("rejected_refundable");
    }
  }
}
