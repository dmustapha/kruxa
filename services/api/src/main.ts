import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../../indexer/src/fixtures.ts";
import { NeardataSource } from "../../indexer/src/sources.ts";
import { Store } from "../../indexer/src/store.ts";
import { Tailer } from "../../indexer/src/tailer.ts";
import { asOf } from "./common.ts";
import type { Ctx } from "./common.ts";
import { createApp } from "./http.ts";

/**
 * Single process: tail the chain into SQLite and serve the API. All configuration is environment variables:
 *   KRUXA_NETWORK  testnet | mainnet | fixture   (default testnet; fixture = offline generator, no network)
 *   KRUXA_DB       SQLite file                    (default ./data/indexer.db; mount a persistent volume here)
 *   KRUXA_CORE / KRUXA_MARKET   comma lists of contract account ids to index
 *   KRUXA_START_HEIGHT  height or "tip"           (used only when the DB is empty)
 *   PORT, HOST, KRUXA_POLL_MS, KRUXA_MAX_LAG
 */
function env(name: string, dflt: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? dflt : v;
}

function list(name: string): string[] {
  return env(name, "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const network = env("KRUXA_NETWORK", "testnet");
  const dbPath = env("KRUXA_DB", "./data/indexer.db");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const fixture = network === "fixture";
  const contracts = fixture ? FIXTURE_CONTRACTS : { core: list("KRUXA_CORE"), market: list("KRUXA_MARKET") };
  if (!fixture && contracts.core.length + contracts.market.length === 0) throw new Error("set KRUXA_CORE and/or KRUXA_MARKET to the contract account ids to index");
  const store = new Store(dbPath, { contracts, network });
  let tailer: Tailer | null = null;
  if (fixture) {
    for (const b of generateFixtureBlocks(Number(env("KRUXA_FIXTURE_SEED", "7")))) store.ingestBlock(b, "fixture");
  } else {
    const start = env("KRUXA_START_HEIGHT", "tip");
    tailer = new Tailer(store, new NeardataSource(network), "chain", start === "tip" ? "tip" : Number(start));
    void tailer.run(Number(env("KRUXA_POLL_MS", "1500")));
  }
  const ctx: Ctx = {
    store, startedAt: Math.floor(Date.now() / 1000), maxLagBlocks: Number(env("KRUXA_MAX_LAG", "120")),
    now: () => (fixture ? (asOf(store).block_time ?? 0) : Math.floor(Date.now() / 1000)),
    tail: () => ({ headHeight: tailer?.status.headHeight ?? null, lastError: tailer?.status.lastError ?? null }),
    dataSource: fixture ? "fixture" : "neardata",
  };
  const app = createApp(ctx);
  const port = await app.listen(Number(env("PORT", "8787")), env("HOST", "0.0.0.0"));
  console.log(`kruxa api listening on :${port} network=${network} db=${dbPath} source=${ctx.dataSource}`);
  const stop = async (): Promise<void> => {
    tailer?.stop();
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
