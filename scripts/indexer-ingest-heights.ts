// Read-only historical ingest for a public rate-limited block source: fetch only the listed block heights from neardata.xyz
// (the heights where the recorded testnet transactions executed, from indexer-collect-heights.ts) and feed them to the
// indexer Store in height order. Nothing is sent or signed.
//   node scripts/indexer-ingest-heights.ts <db> <network> <heights.json> <core,..> <market,..> [launcher,..]
import { readFileSync } from "node:fs";
import { NeardataSource } from "../services/indexer/src/sources.ts";
import { Store } from "../services/indexer/src/store.ts";

const PACE_MS = 600; // neardata answers 429 above about two requests a second

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function fetchBlock(src: NeardataSource, height: number) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await src.block(height);
    } catch (err) {
      if (attempt >= 12) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const [db, network, file, core, market, launcher] = process.argv.slice(2);
  if (!db || !network || !file) throw new Error("usage: indexer-ingest-heights.ts <db> <network> <heights.json> <core,..> <market,..> [launcher,..]");
  const { heights } = JSON.parse(readFileSync(file, "utf8")) as { heights: number[] };
  const store = new Store(db, { contracts: { core: list(core), market: list(market), launcher: list(launcher) }, network });
  const src = new NeardataSource(network);
  let events = 0;
  let fetched = 0;
  for (const [i, height] of heights.entries()) {
    const nb = await fetchBlock(src, height);
    if (nb) {
      events += store.ingestBlock(nb, "chain").inserted;
      fetched++;
    }
    if ((i + 1) % 200 === 0) console.log(`progress ${i + 1}/${heights.length} events=${store.eventCount()}`);
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  console.log(`heights=${heights.length} fetched=${fetched} events_inserted=${events} store_events=${store.eventCount()} checkpoint=${store.checkpoint()?.height ?? "none"}`);
  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
