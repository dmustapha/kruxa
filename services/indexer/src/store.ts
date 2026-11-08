import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Folder } from "./fold.ts";
import { extractEvents } from "./parse.ts";
import { DERIVED_TABLES, HASH_ORDER, SCHEMA, SCHEMA_VERSION } from "./schema.ts";
import type { Change, ContractSet, NearBlock, PendingChange, Source, StoredEvent } from "./types.ts";

type Row = Record<string, unknown>;
type Listener = (c: Change) => void;

export interface Checkpoint {
  height: number;
  hash: string;
}

export interface IngestResult {
  height: number;
  inserted: number;
  duplicate: boolean;
  rebuilt: boolean;
}

export class ReorgError extends Error {
  readonly height: number;
  constructor(height: number) {
    super(`block ${height} hash differs from the stored one`);
    this.height = height;
  }
}

const BLOCK_WINDOW = 512;

export class Store {
  readonly db: DatabaseSync;
  readonly contracts: ContractSet;
  readonly network: string;
  badEvents = 0;
  private readonly folder: Folder;
  private listeners: Listener[] = [];

  constructor(path: string, opts: { contracts: ContractSet; network: string }) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;");
    this.contracts = opts.contracts;
    this.network = opts.network;
    this.folder = new Folder(this.db);
    this.migrate();
    this.setMeta("network", opts.network);
  }

  /** Events are the source of truth, so a schema change just drops the derived tables and refolds. */
  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const have = this.getMeta("schema_version");
    const legacy = have === undefined && this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'launches'").get() !== undefined;
    const stale = legacy || (have !== undefined && Number(have) !== SCHEMA_VERSION);
    if (stale) for (const t of DERIVED_TABLES) this.db.exec(`DROP TABLE IF EXISTS ${t}`);
    this.db.exec(SCHEMA);
    if (stale) this.rebuild();
    this.setMeta("schema_version", String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  getMeta(k: string): string | undefined {
    const r = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k) as Row | undefined;
    return r ? String(r.v) : undefined;
  }

  setMeta(k: string, v: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(k, v);
  }

  checkpoint(): Checkpoint | null {
    const r = this.db.prepare("SELECT height, hash FROM blocks ORDER BY height DESC LIMIT 1").get() as Row | undefined;
    return r ? { height: Number(r.height), hash: String(r.hash) } : null;
  }

  /** Stored hash of a height, used by the tailer to find the fork point. */
  blockHash(height: number): string | undefined {
    const r = this.db.prepare("SELECT hash FROM blocks WHERE height = ?").get(height) as Row | undefined;
    return r ? String(r.hash) : undefined;
  }

  eventCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as Row).n);
  }

  /**
   * Ingest one block. Idempotent: events are keyed by (receipt id, log index), so re-delivering a block changes nothing.
   * A block at a known height with a different hash raises ReorgError; the caller rolls back and retries.
   */
  ingestBlock(nb: NearBlock, source: Source): IngestResult {
    const h = nb.block.header;
    const known = this.blockHash(h.height);
    if (known !== undefined && known !== h.hash) throw new ReorgError(h.height);
    const time = Number(BigInt(h.timestamp_nanosec) / 1_000_000_000n);
    const events = extractEvents(nb, this.contracts);
    return this.tx(() => {
      this.db.prepare("INSERT OR IGNORE INTO blocks VALUES (?, ?, ?, ?, ?)").run(h.height, h.hash, h.prev_hash, time, source);
      const fresh = events.filter((e) => this.insertEvent(e, h.height, h.hash, time, source));
      const rebuilt = fresh.length > 0 && fresh.some((e) => this.beforeLastApplied(h.height, e.ord, e.logIndex));
      if (rebuilt) this.rebuild();
      else fresh.forEach((e) => this.applyOne({ ...e, blockHeight: h.height, blockHash: h.hash, time, source }, true));
      const last = fresh[fresh.length - 1];
      if (last && !rebuilt) this.setLastApplied(h.height, last.ord, last.logIndex);
      this.db.prepare("DELETE FROM blocks WHERE height < ?").run(h.height - BLOCK_WINDOW);
      return { height: h.height, inserted: fresh.length, duplicate: known !== undefined && fresh.length === 0, rebuilt };
    });
  }

  /** Drop everything above `height` and refold. Used for reorgs. */
  rollbackTo(height: number): void {
    this.tx(() => {
      this.db.prepare("DELETE FROM blocks WHERE height > ?").run(height);
      this.db.prepare("DELETE FROM events WHERE block_height > ?").run(height);
      this.rebuild();
    });
  }

  /** Clear the derived tables and refold every stored event in canonical order. */
  rebuild(): void {
    for (const t of DERIVED_TABLES) this.db.exec(`DELETE FROM ${t}`);
    this.db.exec("DELETE FROM meta WHERE k = 'last_applied'");
    const rows = this.db.prepare("SELECT * FROM events ORDER BY block_height, ord, log_index").all() as Row[];
    for (const r of rows) this.applyOne(rowToEvent(r), false);
    const last = rows[rows.length - 1];
    if (last) this.setLastApplied(Number(last.block_height), Number(last.ord), Number(last.log_index));
  }

  /** sha256 of the canonical read model plus the event set. Equal events must give an equal hash. */
  stateHash(): string {
    const hash = createHash("sha256");
    for (const [table, order] of Object.entries(HASH_ORDER)) {
      const cols = table === "events" ? "receipt_id, log_index, ord, block_height, time, contract, kind, event, data, source" : "*";
      hash.update(`#${table}\n`);
      for (const r of this.db.prepare(`SELECT ${cols} FROM ${table} ORDER BY ${order}`).all()) hash.update(JSON.stringify(r) + "\n");
    }
    return hash.digest("hex");
  }

  private applyOne(e: StoredEvent, notify: boolean): void {
    this.db.exec("SAVEPOINT ev");
    try {
      this.folder.apply(e, (c) => notify && this.fire(c, e));
      this.db.exec("RELEASE ev");
    } catch (err) {
      this.db.exec("ROLLBACK TO ev; RELEASE ev");
      this.badEvents++;
      console.error(`indexer: skipped ${e.event} at ${e.blockHeight}: ${(err as Error).message}`);
    }
  }

  private fire(c: PendingChange, e: StoredEvent): void {
    const seq = Number((this.db.prepare("SELECT seq FROM events WHERE receipt_id = ? AND log_index = ?").get(e.receiptId, e.logIndex) as Row).seq);
    for (const l of this.listeners) l({ ...c, seq } as Change);
  }

  private insertEvent(e: Omit<StoredEvent, "blockHeight" | "blockHash" | "time" | "source">, height: number, hash: string, time: number, source: Source): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO events (receipt_id, log_index, ord, block_height, block_hash, time, contract, kind, event, data, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.receiptId, e.logIndex, e.ord, height, hash, time, e.contract, e.kind, e.event, JSON.stringify(e.data), source);
    return Number(r.changes) === 1;
  }

  private beforeLastApplied(height: number, ord: number, logIndex: number): boolean {
    const last = this.getMeta("last_applied");
    if (!last) return false;
    const [h = 0, o = 0, l = 0] = last.split(":").map(Number);
    return height < h || (height === h && (ord < o || (ord === o && logIndex < l)));
  }

  private setLastApplied(height: number, ord: number, logIndex: number): void {
    this.setMeta("last_applied", `${height}:${ord}:${logIndex}`);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

function rowToEvent(r: Row): StoredEvent {
  return {
    receiptId: String(r.receipt_id), logIndex: Number(r.log_index), ord: Number(r.ord), contract: String(r.contract),
    kind: r.kind === "market" ? "market" : r.kind === "launcher" ? "launcher" : "core", event: String(r.event), data: JSON.parse(String(r.data)) as Record<string, unknown>,
    blockHeight: Number(r.block_height), blockHash: String(r.block_hash), time: Number(r.time), source: r.source === "fixture" ? "fixture" : "chain",
  };
}
