/** Shapes shared by the indexer modules. Block shape follows neardata.xyz `/v0/block/{height}`. */

export type Source = "chain" | "fixture";
export type Interval = "1m" | "5m" | "1h" | "1d";

export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86400 };
export const INTERVALS = Object.keys(INTERVAL_SECONDS) as Interval[];

export const EVENT_STANDARD = "kruxa";
export const EVENT_VERSION = "1.0.0";

/** The subset of a neardata block the indexer reads. Unknown fields are ignored. */
export interface NearBlock {
  block: { header: { height: number; hash: string; prev_hash: string; timestamp_nanosec: string } };
  shards: Array<{
    shard_id?: number;
    receipt_execution_outcomes?: Array<{
      execution_outcome: {
        id: string;
        outcome: { executor_id: string; logs: string[]; status: unknown };
      };
    }>;
  }>;
}

export interface ContractSet {
  core: string[];
  market: string[];
}

/** One parsed NEP-297 event, before storage. */
export interface ParsedEvent {
  receiptId: string;
  logIndex: number;
  /** Position of the receipt outcome inside the block (shard-major). Part of the canonical order. */
  ord: number;
  contract: string;
  kind: "core" | "market";
  event: string;
  data: Record<string, unknown>;
}

export interface StoredEvent extends ParsedEvent {
  blockHeight: number;
  blockHash: string;
  /** Block time in unix seconds. */
  time: number;
  source: Source;
}

/** Change notifications emitted while folding, consumed by the SSE stream. */
export type Change =
  | { type: "trade"; launchId: number; trade: Record<string, unknown>; seq: number }
  | { type: "candle"; launchId: number; candle: Record<string, unknown>; seq: number }
  | { type: "launch"; launchId: number; seq: number };

/** A change before the store stamps its event sequence number. */
export type PendingChange =
  | { type: "trade"; launchId: number; trade: Record<string, unknown> }
  | { type: "candle"; launchId: number; candle: Record<string, unknown> }
  | { type: "launch"; launchId: number };

export interface BlockSource {
  readonly name: string;
  readonly network: string;
  finalHeight(): Promise<number>;
  /** null when the height was skipped (no block at that height). */
  block(height: number): Promise<NearBlock | null>;
}
