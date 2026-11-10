import type { BlockSource, NearBlock } from "./types.ts";

/** JSON-RPC transport: resolves to the `result`, throws RpcError for a JSON-RPC error object. Injected so tests need no network. */
export type RpcCall = (method: string, params: unknown) => Promise<unknown>;

export class RpcError extends Error {
  readonly name_: string;
  constructor(name: string, message: string) {
    super(message);
    this.name_ = name;
  }
}

export function httpRpc(url: string, timeoutMs = 15_000): RpcCall {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc ${res.status} for ${method}`);
    const body = JSON.parse(await res.text()) as { result?: unknown; error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown } };
    if (body.error) throw new RpcError(body.error.cause?.name ?? body.error.name ?? "RPC_ERROR", String(body.error.message ?? body.error.data ?? "rpc error"));
    return body.result;
  };
}

interface RpcHeader {
  height: number;
  hash: string;
  prev_hash: string;
  timestamp_nanosec: string;
}
interface RpcBlock {
  header: RpcHeader;
  chunks: Array<{ chunk_hash: string }>;
}
interface RpcAction {
  FunctionCall?: { method_name?: string; args?: string };
}
interface RpcTx {
  hash: string;
  signer_id: string;
  receiver_id: string;
  actions?: RpcAction[];
}
type Outcome = NonNullable<NonNullable<NearBlock["shards"][number]["receipt_execution_outcomes"]>[number]>;
interface TxStatus {
  receipts_outcome?: Array<{ block_hash: string; id: string; outcome: Outcome["execution_outcome"]["outcome"] }>;
}

/** Outcomes filed under blocks that were never requested (skipped or still ahead) are dropped oldest first beyond this many blocks. */
const MAX_PENDING = 2000;

export interface RpcSourceOptions {
  /** Contract accounts whose events are indexed. Only transactions that can reach them are fetched. */
  accounts: string[];
  /** How many blocks back a transaction can have been included and still be matched with a receipt executed now. Default 40 (about 40 s). */
  window?: number;
  /** Fetch the status of every transaction instead of only those that touch `accounts`. Heavy on mainnet; catches third-party relays. */
  scanAllTransactions?: boolean;
}

/**
 * Block-scan fallback over plain NEAR JSON-RPC (ARCHITECTURE 5.11). There is no RPC method that lists the receipts executed in a block, so a block is
 * rebuilt from transaction statuses: every transaction included in the last `window` blocks (and in the block itself, for local receipts) that touches a watched account is resolved with
 * EXPERIMENTAL_tx_status (FINAL), and the receipt outcomes are filed under the block hash they executed in.
 * Limits, all shown in `limits`: (1) a receipt that executes more than `window` blocks after its transaction is missed; (2) flows started by a third party
 * with no watched account in the transaction (an Intents withdrawal that ends in `ft_on_transfer` to core) are missed unless `scanAllTransactions`;
 * (3) the order of outcomes inside one block follows the receipt tree, not exact execution order. neardata stays the primary source.
 */
export class RpcSource implements BlockSource {
  readonly name = "rpc";
  readonly network: string;
  readonly limits = ["receipts older than the scan window are missed", "third-party relays that never name a watched account are missed", "in-block order follows the receipt tree"];
  private readonly call: RpcCall;
  private readonly watched: Set<string>;
  private readonly window: number;
  private readonly all: boolean;
  private readonly scanned = new Set<number>();
  private readonly byBlock = new Map<string, Array<Outcome>>();
  private readonly seen = new Set<string>();
  private readonly heights = new Map<number, RpcBlock | null>();

  constructor(network: string, call: RpcCall, opts: RpcSourceOptions) {
    this.network = network;
    this.call = call;
    this.watched = new Set(opts.accounts);
    this.window = opts.window ?? 40;
    this.all = opts.scanAllTransactions === true;
  }

  async finalHeight(): Promise<number> {
    const b = (await this.call("block", { finality: "final" })) as RpcBlock;
    if (typeof b?.header?.height !== "number") throw new Error("rpc: block(final) returned no header");
    return b.header.height;
  }

  async block(height: number): Promise<NearBlock | null> {
    const b = await this.blockAt(height);
    if (b === null) return null;
    for (let k = Math.max(1, height - this.window); k <= height; k++) await this.scan(k);
    this.forget(height - this.window - 1);
    const outcomes = this.byBlock.get(b.header.hash) ?? [];
    this.byBlock.delete(b.header.hash);
    return {
      block: { header: { height: b.header.height, hash: b.header.hash, prev_hash: b.header.prev_hash, timestamp_nanosec: b.header.timestamp_nanosec } },
      shards: [{ shard_id: 0, receipt_execution_outcomes: outcomes }],
    };
  }

  /** null for a skipped height (UNKNOWN_BLOCK), like neardata. Results are cached because every height is read as inclusion block and as execution block. */
  private async blockAt(height: number): Promise<RpcBlock | null> {
    if (this.heights.has(height)) return this.heights.get(height) ?? null;
    try {
      const b = (await this.call("block", { block_id: height })) as RpcBlock;
      this.heights.set(height, b);
      return b;
    } catch (err) {
      if (err instanceof RpcError && err.name_ === "UNKNOWN_BLOCK") {
        this.heights.set(height, null);
        return null;
      }
      throw err;
    }
  }

  private forget(below: number): void {
    for (const k of this.byBlock.keys()) {
      if (this.byBlock.size <= MAX_PENDING) break;
      this.byBlock.delete(k);
    }
    for (const k of this.seen) {
      if (this.seen.size <= MAX_PENDING * 20) break;
      this.seen.delete(k);
    }
    for (const h of this.heights.keys()) if (h < below) this.heights.delete(h);
    for (const h of this.scanned) if (h < below) this.scanned.delete(h);
  }

  private async scan(height: number): Promise<void> {
    if (this.scanned.has(height)) return;
    const b = await this.blockAt(height);
    if (b) for (const c of b.chunks) await this.scanChunk(c.chunk_hash);
    this.scanned.add(height);
  }

  private async scanChunk(chunkHash: string): Promise<void> {
    const chunk = (await this.call("chunk", { chunk_id: chunkHash })) as { transactions?: RpcTx[] };
    for (const tx of chunk.transactions ?? []) {
      if (this.seen.has(tx.hash) || !this.relevant(tx)) continue;
      const st = (await this.call("EXPERIMENTAL_tx_status", { tx_hash: tx.hash, sender_account_id: tx.signer_id, wait_until: "FINAL" })) as TxStatus;
      this.seen.add(tx.hash);
      for (const r of st.receipts_outcome ?? []) {
        const list = this.byBlock.get(r.block_hash) ?? [];
        if (!list.some((o) => o.execution_outcome.id === r.id)) list.push({ execution_outcome: { id: r.id, outcome: r.outcome } });
        this.byBlock.set(r.block_hash, list);
      }
    }
  }

  /** A transaction can reach a watched contract if it is sent to one, signed by one, or is an `ft_transfer(_call)` whose `receiver_id` is one. */
  private relevant(tx: RpcTx): boolean {
    if (this.all || this.watched.has(tx.receiver_id) || this.watched.has(tx.signer_id)) return true;
    return (tx.actions ?? []).some((a) => this.transfersToWatched(a.FunctionCall));
  }

  private transfersToWatched(fc: RpcAction["FunctionCall"]): boolean {
    if (!fc || (fc.method_name !== "ft_transfer_call" && fc.method_name !== "ft_transfer")) return false;
    try {
      const args = JSON.parse(Buffer.from(fc.args ?? "", "base64").toString("utf8")) as { receiver_id?: unknown };
      return typeof args.receiver_id === "string" && this.watched.has(args.receiver_id);
    } catch {
      return false;
    }
  }
}

export interface FallbackOptions {
  /** After this many consecutive primary failures the primary is skipped for `cooldownMs`. Default 3. */
  maxFailures?: number;
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Primary source (neardata) with a secondary (RPC block scan) behind a circuit breaker. A primary error serves that call from the secondary; after
 * `maxFailures` in a row the primary is not tried again until the cooldown passes, so a dead host costs one timeout, not one per block.
 */
export class FallbackSource implements BlockSource {
  readonly network: string;
  readonly primary: BlockSource;
  readonly secondary: BlockSource;
  activeName: string;
  fallbackCalls = 0;
  lastPrimaryError: string | null = null;
  private failures = 0;
  private skipUntil = 0;
  private readonly maxFailures: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(primary: BlockSource, secondary: BlockSource, opts: FallbackOptions = {}) {
    this.primary = primary;
    this.secondary = secondary;
    this.network = primary.network;
    this.activeName = primary.name;
    this.maxFailures = opts.maxFailures ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  get name(): string {
    return this.activeName;
  }

  finalHeight(): Promise<number> {
    return this.route((s) => s.finalHeight());
  }

  block(height: number): Promise<NearBlock | null> {
    return this.route((s) => s.block(height));
  }

  private async route<T>(fn: (s: BlockSource) => Promise<T>): Promise<T> {
    if (this.now() >= this.skipUntil) {
      try {
        const out = await fn(this.primary);
        this.failures = 0;
        this.activeName = this.primary.name;
        return out;
      } catch (err) {
        this.lastPrimaryError = (err as Error).message;
        if (++this.failures >= this.maxFailures) this.skipUntil = this.now() + this.cooldownMs;
      }
    }
    this.fallbackCalls++;
    this.activeName = this.secondary.name;
    return fn(this.secondary);
  }
}
