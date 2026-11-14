import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../indexer/src/store.ts";
import { Tailer } from "../../indexer/src/tailer.ts";
import type { BlockSource, ContractSet, NearBlock } from "../../indexer/src/types.ts";
import { bakeSnapshot } from "./snapshot.ts";
import { buildSource } from "./source.ts";

/**
 * Scheduled-job helpers for the GitHub Actions snapshot path (docs/runbooks/hosting.md, "Free path").
 *   node src/snapshot-ci.ts run <db> <outdir> <meta-out> [prev-meta]
 * One run: catch the SQLite read model up to the chain within a time budget, bake every API page into <outdir>,
 * check the bake against the previous run's meta, and write the new meta. Exit 0 = safe to publish, 1 = keep what is published.
 * Configuration is environment variables only, all public: KRUXA_NETWORK, KRUXA_CORE, KRUXA_MARKET, KRUXA_LAUNCHER,
 * KRUXA_START_HEIGHT (used only on a fresh database), KRUXA_NEARDATA_URL, KRUXA_RPC_URL, KRUXA_INGEST_BUDGET_S (default 240), KRUXA_BLOCK_PACE_MS (default 450).
 */
export interface Meta {
  network: string;
  config: string;
  block_height: number | null;
  event_count: number;
  launch_count: number;
  state_hash: string;
  baked_at: number;
}

export interface IngestReport {
  blocks: number;
  head: number | null;
  error: string | null;
}

export const configSignature = (network: string, c: ContractSet): string => [network, c.core.join(","), c.market.join(","), (c.launcher ?? []).join(",")].join("|");

/** The files the app reads on every page load. A bake without them is never published. */
export const REQUIRED_FILES = ["api/health.json", "api/launches.json", "api/stats.json", "api/ops-log.json", "api/ops/status.json"];

/** Why a bake must not replace the published one, or null when it may. Never lets an empty or older database overwrite good data. */
export function rejectBake(next: Meta, files: string[], prev: Meta | null): string | null {
  const missing = REQUIRED_FILES.filter((f) => !files.includes(f));
  if (missing.length > 0) return `bake is missing ${missing.join(", ")}`;
  if (next.block_height === null) return "database has no block yet (empty ingest), nothing to publish";
  if (prev === null) return null;
  if (prev.config !== next.config) return `contract config changed (${prev.config} to ${next.config}); set KRUXA_SNAPSHOT_RESET=1 once to start a new history`;
  if (prev.block_height !== null && next.block_height < prev.block_height) return `block height went backwards (${prev.block_height} to ${next.block_height})`;
  if (next.event_count < prev.event_count) return `event count shrank (${prev.event_count} to ${next.event_count})`;
  if (next.launch_count < prev.launch_count) return `launch count shrank (${prev.launch_count} to ${next.launch_count})`;
  return null;
}

/** Wraps a source so a public rate limit (neardata answers 429 above about two requests a second) is respected and retried. */
export class PacedSource implements BlockSource {
  readonly network: string;
  private last = 0;
  private readonly inner: BlockSource;
  private readonly paceMs: number;
  private readonly retries: number;
  constructor(inner: BlockSource, paceMs: number, retries = 6) {
    this.inner = inner;
    this.paceMs = paceMs;
    this.retries = retries;
    this.network = inner.network;
  }
  get name(): string { return this.inner.name; }
  finalHeight(): Promise<number> { return this.retry(() => this.inner.finalHeight()); }
  block(height: number): Promise<NearBlock | null> { return this.retry(() => this.inner.block(height)); }

  private async retry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.last + this.paceMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      try {
        return await call();
      } catch (err) {
        if (attempt >= this.retries) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
}

/** Ingest in small steps until the source is at its head or the time budget is spent. Blocks already stored count even if a later step fails. */
export async function ingestWithBudget(store: Store, source: BlockSource, start: number | "tip", budgetMs: number, step = 40): Promise<IngestReport> {
  const tailer = new Tailer(store, source, "chain", start);
  const deadline = Date.now() + budgetMs;
  let blocks = 0;
  let error: string | null = null;
  try {
    for (let n = step; n === step && Date.now() < deadline; ) {
      n = await tailer.catchUp(step);
      blocks += n;
    }
  } catch (err) {
    error = (err as Error).message;
  }
  return { blocks, head: tailer.status.headHeight, error };
}

const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const env = (k: string, d = ""): string => (process.env[k] === undefined || process.env[k] === "" ? d : String(process.env[k]));

function readMeta(path: string | undefined): Meta | null {
  return path && path !== "-" && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Meta) : null;
}

function metaOf(store: Store, config: string, health: Record<string, unknown>, bakedAt: number): Meta {
  const a = health.as_of as { block_height: number | null };
  return {
    network: store.network, config, block_height: a.block_height, event_count: Number(health.event_count), launch_count: Number(health.launch_count),
    state_hash: String(health.state_hash), baked_at: bakedAt,
  };
}

async function run(db: string, outDir: string, metaOut: string, prevPath?: string): Promise<number> {
  const network = env("KRUXA_NETWORK", "testnet");
  const contracts: ContractSet = { core: csv(process.env.KRUXA_CORE), market: csv(process.env.KRUXA_MARKET), launcher: csv(process.env.KRUXA_LAUNCHER) };
  if (contracts.core.length + contracts.market.length + (contracts.launcher?.length ?? 0) === 0) throw new Error("set KRUXA_CORE, KRUXA_MARKET and/or KRUXA_LAUNCHER (repo variables)");
  const config = configSignature(network, contracts);
  const prev = readMeta(prevPath);
  if (prev && prev.config !== config) throw new Error(`contract config changed (${prev.config} to ${config}); set KRUXA_SNAPSHOT_RESET=1 once to start a new history`);
  const store = new Store(db, { contracts, network });
  const accounts = [...contracts.core, ...contracts.market, ...(contracts.launcher ?? [])];
  const inner = buildSource(network, accounts, { neardataUrl: env("KRUXA_NEARDATA_URL"), rpcUrl: env("KRUXA_RPC_URL"), rpcOnly: env("KRUXA_RPC_ONLY") === "1" });
  const start = env("KRUXA_START_HEIGHT", "tip");
  const report = await ingestWithBudget(store, new PacedSource(inner, Number(env("KRUXA_BLOCK_PACE_MS", "450"))), start === "tip" ? "tip" : Number(start), Number(env("KRUXA_INGEST_BUDGET_S", "240")) * 1000);
  console.log(`ingest: ${report.blocks} blocks, head ${report.head}, source ${inner.name}${report.error ? `, error: ${report.error}` : ""}`);
  if (report.error && report.blocks === 0) { store.close(); console.error("no progress and the source failed; keeping the published snapshot"); return 1; }
  const bakedAt = Math.floor(Date.now() / 1000);
  const baked = bakeSnapshot(store, outDir, bakedAt);
  const health = JSON.parse(readFileSync(join(outDir, "api/health.json"), "utf8")) as Record<string, unknown>;
  const next = metaOf(store, config, health, bakedAt);
  store.close();
  const why = rejectBake(next, baked.files, prev);
  if (why) { console.error(`bake rejected: ${why}`); return 1; }
  writeFileSync(metaOut, JSON.stringify(next, null, 2));
  console.log(`baked ${baked.files.length} files as of block ${next.block_height} (${next.launch_count} launches, ${next.event_count} events)`);
  return 0;
}

if (import.meta.main) {
  const [cmd, db, outDir, metaOut, prev] = process.argv.slice(2);
  if (cmd !== "run" || !db || !outDir || !metaOut) throw new Error("usage: snapshot-ci.ts run <db> <outdir> <meta-out> [prev-meta]");
  run(db, outDir, metaOut, prev).then((code) => process.exit(code), (err) => { console.error(String(err instanceof Error ? err.message : err)); process.exit(1); });
}
