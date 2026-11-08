import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../indexer/src/store.ts";
import { asOf, all } from "./common.ts";
import type { Ctx } from "./common.ts";
import { createApp } from "./http.ts";

/**
 * `node src/snapshot.ts <db> <network> <outdir> [core,..] [market,..]`: bake the feed, every launch and token page to static JSON
 * so the app can serve them with the indexer stopped (degrade-to-snapshot mode). Files mirror API paths, e.g. api/launches.json.
 */
const [dbPath, network = "testnet", outDir = "./snapshot", core = "", market = ""] = process.argv.slice(2);
if (!dbPath) throw new Error("usage: snapshot.ts <db> <network> <outdir> [core] [market]");
const store = new Store(dbPath, { contracts: { core: core.split(",").filter(Boolean), market: market.split(",").filter(Boolean) }, network });
const ctx: Ctx = { store, startedAt: 0, maxLagBlocks: 0, now: () => (network === "fixture" ? (asOf(store).block_time ?? 0) : Math.floor(Date.now() / 1000)), tail: () => ({ headHeight: null, lastError: null }), dataSource: "snapshot" };
const app = createApp(ctx);
const out = (rel: string, body: unknown): void => {
  mkdirSync(join(outDir, rel, ".."), { recursive: true });
  writeFileSync(join(outDir, rel), JSON.stringify(body));
};
out("api/launches.json", app.handle("/api/launches", new URLSearchParams("limit=200")).body);
for (const r of all(store, "SELECT launch_id FROM launches")) {
  const id = String(r.launch_id);
  out(`api/launch/${id}.json`, app.handle(`/api/launch/${id}`).body);
  out(`api/token/${id}.json`, app.handle(`/api/token/${id}`).body);
  out(`api/token/${id}/candles-1h.json`, app.handle(`/api/token/${id}/candles`, new URLSearchParams("interval=1h")).body);
}
out("api/health.json", app.handle("/api/health").body);
await app.close();
store.close();
console.log(`snapshot written to ${outDir}`);
