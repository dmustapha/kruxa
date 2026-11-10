import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { PendingChange } from "./types.ts";

export type Row = Record<string, unknown>;
export type Emit = (c: PendingChange) => void;

export const ZERO = "0";

export function big(v: unknown, field: string): bigint {
  if (typeof v === "string" && /^-?[0-9]+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  throw new Error(`bad amount in ${field}`);
}

export function optBig(v: unknown): bigint | null {
  return typeof v === "string" && /^[0-9]+$/.test(v) ? BigInt(v) : null;
}

export function launchId(d: Row): number {
  const v = d.launch_id;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error("bad launch_id");
  return n;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function nsToSec(v: unknown): number | null {
  return typeof v === "string" && /^[0-9]+$/.test(v) ? Number(BigInt(v) / 1_000_000_000n) : null;
}

export function intOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
}

export function mixSource(a: unknown, b: string): string {
  return a === "fixture" || b === "fixture" ? "fixture" : "chain";
}


/** Small prepared-statement helpers shared by the folders. */
export class Sql {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  get(sql: string, ...p: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...p) as Row | undefined;
  }
  run(sql: string, ...p: SQLInputValue[]): void {
    this.db.prepare(sql).run(...p);
  }
}

/** Unsigned decimal string, or null. */
export function optStr(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
