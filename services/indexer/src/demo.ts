import { Store } from "./store.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "./fixtures.ts";
import { e12ToNumber, quoteToNumber } from "./price.ts";

/** `make indexer-demo`: ingest fixture events into a temp SQLite file and print the 5m candle series for launch 1. */
const store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
for (const b of generateFixtureBlocks()) store.ingestBlock(b, "fixture");
const rows = store.db.prepare("SELECT * FROM candles WHERE launch_id = 1 AND interval = '5m' ORDER BY t LIMIT 12").all() as Array<Record<string, unknown>>;
console.log("SOURCE: FIXTURE DATA (offline generator, not chain)");
console.log("launch 1 ALPHA, interval 5m, first 12 candles");
console.log("time_utc             open        high        low         close       vol_usdc  n");
for (const r of rows) {
  const f = (k: string): string => e12ToNumber(BigInt(String(r[k]))).toFixed(8).padEnd(11);
  const iso = new Date(Number(r.t) * 1000).toISOString().slice(0, 19);
  console.log(`${iso}  ${f("o")} ${f("h")} ${f("l")} ${f("c")} ${quoteToNumber(BigInt(String(r.v))).toFixed(2).padStart(8)}  ${r.n}`);
}
console.log(`events=${store.eventCount()} state_hash=${store.stateHash().slice(0, 16)}`);
store.close();
