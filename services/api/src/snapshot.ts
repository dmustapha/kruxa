import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { Store } from "../../indexer/src/store.ts";
import { INTERVALS } from "../../indexer/src/types.ts";
import { all, asOf } from "./common.ts";
import type { Ctx } from "./common.ts";
import { createApp } from "./http.ts";

/**
 * Snapshot mode (ARCHITECTURE 5.11: the app degrades to baked snapshots when the service is down).
 *   node src/snapshot.ts bake <db> <network> <outdir> [core,..] [market,..] [launcher,..]   write the feed, every launch and token page, ops pages
 *   node src/snapshot.ts serve <dir> [port]                                                  serve those files at the API paths, read-only, labelled RECORDED
 * Files mirror API paths without the query string (api/launches.json, api/token/1/candles-1h.json). Everything served from a snapshot says so:
 * the header `x-kruxa-data: snapshot`, and `/api/health` carries `status: "snapshot"` with the bake time and the block it was taken at.
 */
const OPS_SCOPES = ["core", "market", "launcher"];
const SAFE_ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-expose-headers": "x-kruxa-data" };

export interface BakeResult {
  files: string[];
  asOf: { block_height: number | null; block_time: number | null };
}

function snapshotCtx(store: Store, network: string): Ctx {
  return {
    store, startedAt: 0, maxLagBlocks: 0, now: () => (network === "fixture" ? (asOf(store).block_time ?? 0) : Math.floor(Date.now() / 1000)),
    tail: () => ({ headHeight: null, lastError: null }), dataSource: "snapshot", daySeconds: network === "fixture" ? 600 : 86_400,
  };
}

/** Bake every page the app reads from a store. `bakedAt` is injectable so a fixture bake is reproducible. */
export function bakeSnapshot(store: Store, outDir: string, bakedAt: number = Math.floor(Date.now() / 1000)): BakeResult {
  const app = createApp(snapshotCtx(store, store.network));
  const files: string[] = [];
  const out = (rel: string, body: unknown): void => {
    const file = join(outDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    files.push(rel);
  };
  const page = (path: string, query = ""): unknown => app.handle(path, new URLSearchParams(query)).body;
  out("api/launches.json", page("/api/launches", "limit=200"));
  out("api/stats.json", page("/api/stats"));
  out("api/ops-log.json", page("/api/ops-log", "limit=200"));
  for (const scope of OPS_SCOPES) out(`api/ops-log-${scope}.json`, page("/api/ops-log", `limit=200&scope=${scope}`));
  for (const p of ["status", "upgrades", "halts", "force-resolves", "solvency", "owed"]) out(`api/ops/${p}.json`, page(`/api/ops/${p}`));
  for (const r of all(store, "SELECT launch_id FROM launches")) bakeLaunch(String(r.launch_id), out, page);
  for (const account of bakeAccounts(store)) {
    out(`api/creator/${account}.json`, page(`/api/creator/${account}`));
    out(`api/portfolio/${account}.json`, page(`/api/portfolio/${account}`));
  }
  const a = asOf(store);
  const health = page("/api/health") as Record<string, unknown>;
  out("api/health.json", { ...health, status: "snapshot", data_source: "snapshot", uptime_s: 0, baked_at: bakedAt, snapshot: { baked_at: bakedAt, block_height: a.block_height, block_time: a.block_time } });
  void app.close();
  return { files, asOf: a };
}

function bakeLaunch(id: string, out: (rel: string, body: unknown) => void, page: (p: string, q?: string) => unknown): void {
  out(`api/launch/${id}.json`, page(`/api/launch/${id}`));
  out(`api/launch/${id}/custody.json`, page(`/api/launch/${id}/custody`));
  out(`api/token/${id}.json`, page(`/api/token/${id}`));
  out(`api/token/${id}/trades.json`, page(`/api/token/${id}/trades`, "limit=200"));
  out(`api/token/${id}/holders.json`, page(`/api/token/${id}/holders`, "limit=200"));
  out(`api/token/${id}/depth.json`, page(`/api/token/${id}/depth`));
  out(`api/verify/${id}.json`, page(`/api/verify/${id}`));
  for (const iv of INTERVALS) out(`api/token/${id}/candles-${iv}.json`, page(`/api/token/${id}/candles`, `interval=${iv}`));
  const genesis = page(`/api/launch/${id}/genesis`) as { error?: unknown };
  if (!genesis.error) out(`api/launch/${id}/genesis.json`, genesis);
}

/** Every account the per-account pages (creator desk, portfolio) can say something about. Capped so one busy token cannot bloat the bake. */
export function bakeAccounts(store: Store, cap = 2000): string[] {
  const rows = all(store, `SELECT creator AS a FROM launches UNION SELECT payout_recipient FROM launches UNION SELECT holder FROM balances UNION SELECT holder FROM positions`);
  const accounts = new Set<string>();
  for (const r of rows) {
    const a = String(r.a ?? "").replace(/^near:/, "");
    if (SAFE_ACCOUNT.test(a)) accounts.add(a);
  }
  return [...accounts].sort().slice(0, cap);
}

const ERR = (code: string, message: string): string => JSON.stringify({ error: { code, message } });

/** Maps a request path and query to the baked file; null when the snapshot has no such page. */
export function snapshotFile(path: string, query: URLSearchParams): string | null {
  const candles = /^\/api\/token\/([0-9]+)\/candles$/.exec(path);
  if (path === "/api/ops-log" && OPS_SCOPES.includes(query.get("scope") ?? "")) return `api/ops-log-${query.get("scope")}.json`;
  if (candles) return `api/token/${candles[1]}/candles-${query.get("interval") ?? "1m"}.json`;
  if (!/^\/api\/[A-Za-z0-9/_.-]+$/.test(path) || path.includes("..")) return null;
  return `${path.slice(1)}.json`;
}

/** Static, read-only server over a baked directory. Same paths and JSON shapes as the live API; no SSE (404 with a stable code). */
export function serveSnapshot(dir: string): Server {
  const root = resolve(dir);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const head = { ...CORS, "x-kruxa-data": "snapshot", "cache-control": "no-cache" };
    if (req.method === "OPTIONS") return void res.writeHead(204, head).end();
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405, { ...head, "content-type": "application/json" }).end(ERR("method_not_allowed", "read-only snapshot"));
    if (url.pathname === "/api/stream") return void res.writeHead(404, { ...head, "content-type": "application/json" }).end(ERR("snapshot_no_stream", "the live stream is not available from a snapshot"));
    const rel = snapshotFile(url.pathname, url.searchParams);
    const file = rel === null ? null : resolve(root, rel);
    if (file === null || !file.startsWith(root + sep)) return void res.writeHead(404, { ...head, "content-type": "application/json" }).end(ERR("not_in_snapshot", "this page was not baked into the snapshot"));
    try {
      const body = readFileSync(file);
      res.writeHead(200, { ...head, "content-type": "application/json; charset=utf-8" }).end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { ...head, "content-type": "application/json" }).end(ERR("not_in_snapshot", "this page was not baked into the snapshot"));
    }
  });
}

function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").filter(Boolean);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "bake" && argv[0] !== "serve") argv.unshift("bake"); // the original form: snapshot.ts <db> <network> <outdir> [core] [market]
  const [cmd, a, b, c, d, e, f] = argv;
  if (cmd === "bake") {
    if (!a || !c) throw new Error("usage: snapshot.ts bake <db> <network> <outdir> [core] [market] [launcher]");
    const store = new Store(a, { contracts: { core: csv(d), market: csv(e), launcher: csv(f) }, network: b ?? "testnet" });
    const r = bakeSnapshot(store, c);
    store.close();
    console.log(`snapshot written to ${c}: ${r.files.length} files, as of block ${r.asOf.block_height}`);
  } else if (cmd === "serve") {
    if (!a) throw new Error("usage: snapshot.ts serve <dir> [port]");
    const server = serveSnapshot(a);
    server.listen(Number(b ?? 8788), "127.0.0.1", () => console.log(`serving snapshot ${a} on 127.0.0.1:${b ?? 8788} (read-only, RECORDED data)`));
    process.on("SIGTERM", () => server.close());
    process.on("SIGINT", () => server.close());
  } else {
    throw new Error("usage: snapshot.ts bake|serve ...");
  }
}
