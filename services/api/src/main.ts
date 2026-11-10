import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FIXTURE_CONTRACTS, FIXTURE_DAY_SECONDS, generateFullFixtureBlocks } from "../../indexer/src/fixtures.ts";
import { FallbackSource, RpcSource, httpRpc } from "../../indexer/src/rpc.ts";
import { NeardataSource } from "../../indexer/src/sources.ts";
import type { BlockSource } from "../../indexer/src/types.ts";
import { Store } from "../../indexer/src/store.ts";
import { Tailer } from "../../indexer/src/tailer.ts";
import { asOf } from "./common.ts";
import type { Ctx } from "./common.ts";
import { createApp } from "./http.ts";

/**
 * Single process: tail the chain into SQLite and serve the API. All configuration is environment variables:
 *   KRUXA_NETWORK  testnet | mainnet | fixture   (default testnet; fixture = offline generator, no network)
 *   KRUXA_DB       SQLite file                    (default ./data/indexer.db; mount a persistent volume here)
 *   KRUXA_CORE / KRUXA_MARKET / KRUXA_LAUNCHER   comma lists of contract account ids to index (launcher = instant launcher)
 *   KRUXA_INSTANT_DAY_SECONDS  seconds per vesting day (86400; 10 only for the launcher demo profile)
 *   KRUXA_START_HEIGHT  height or "tip"           (used only when the DB is empty)
 *   KRUXA_RPC_URL       NEAR JSON-RPC endpoint; when set, a block scan over it backs up neardata (ARCHITECTURE 5.11). KRUXA_RPC_SCAN_ALL=1 also resolves unrelated transactions
 *   KRUXA_RPC_ONLY=1    use the RPC scan as the only source (neardata not contacted)
 *   PORT, HOST, KRUXA_POLL_MS, KRUXA_MAX_LAG
 */
function env(name: string, dflt: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? dflt : v;
}

function list(name: string): string[] {
  return env(name, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** neardata alone, or neardata backed by an RPC block scan when KRUXA_RPC_URL is set (KRUXA_RPC_ONLY=1 drops neardata). */
function buildSource(network: string, accounts: string[]): BlockSource {
  const neardata = new NeardataSource(network);
  const url = env("KRUXA_RPC_URL", "");
  if (url === "") return neardata;
  const rpc = new RpcSource(network, httpRpc(url), { accounts, scanAllTransactions: env("KRUXA_RPC_SCAN_ALL", "") === "1" });
  return env("KRUXA_RPC_ONLY", "") === "1" ? rpc : new FallbackSource(neardata, rpc);
}

async function main(): Promise<void> {
  const network = env("KRUXA_NETWORK", "testnet");
  const dbPath = env("KRUXA_DB", "./data/indexer.db");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const fixture = network === "fixture";
  const contracts = fixture ? FIXTURE_CONTRACTS : { core: list("KRUXA_CORE"), market: list("KRUXA_MARKET"), launcher: list("KRUXA_LAUNCHER") };
  if (!fixture && contracts.core.length + contracts.market.length + (contracts.launcher?.length ?? 0) === 0) throw new Error("set KRUXA_CORE, KRUXA_MARKET and/or KRUXA_LAUNCHER to the contract account ids to index");
  const store = new Store(dbPath, { contracts, network });
  let tailer: Tailer | null = null;
  let source: BlockSource | null = null;
  if (fixture) {
    for (const b of generateFullFixtureBlocks(Number(env("KRUXA_FIXTURE_SEED", "7")))) store.ingestBlock(b, "fixture");
  } else {
    const start = env("KRUXA_START_HEIGHT", "tip");
    source = buildSource(network, [...contracts.core, ...contracts.market, ...(contracts.launcher ?? [])]);
    tailer = new Tailer(store, source, "chain", start === "tip" ? "tip" : Number(start));
    void tailer.run(Number(env("KRUXA_POLL_MS", "1500")));
  }
  const ctx: Ctx = {
    store, startedAt: Math.floor(Date.now() / 1000), maxLagBlocks: Number(env("KRUXA_MAX_LAG", "120")),
    now: () => (fixture ? (asOf(store).block_time ?? 0) : Math.floor(Date.now() / 1000)),
    tail: () => ({ headHeight: tailer?.status.headHeight ?? null, lastError: tailer?.status.lastError ?? null }),
    get dataSource(): string {
      return fixture ? "fixture" : (source?.name ?? "neardata");
    },
    daySeconds: fixture ? FIXTURE_DAY_SECONDS : Number(env("KRUXA_INSTANT_DAY_SECONDS", "86400")),
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
