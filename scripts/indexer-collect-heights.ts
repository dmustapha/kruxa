// Read-only: turn the transactions recorded in txlog.jsonl files (rows with `tx` and `signer`) into the set of block heights where
// their receipts executed, so the indexer can be fed exactly those blocks from a rate-limited public source.
//   node scripts/indexer-collect-heights.ts <out.json> <txlog.jsonl>...
// Each hash is resolved with JSON-RPC EXPERIMENTAL_tx_status (a view of the chain, nothing is sent or signed).
import { readFileSync, writeFileSync } from "node:fs";
import { httpRpc } from "../services/indexer/src/rpc.ts";

const RPC = process.env.KRUXA_RPC_URL ?? "https://test.rpc.fastnear.com";
const GAP_MS = 400;
const raw = httpRpc(RPC);
let lastCall = 0;

/** The public RPC allows only a few calls a second: space calls out and back off on 429. */
const call: typeof raw = async (method, params) => {
  for (let attempt = 1; ; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      return await raw(method, params);
    } catch (err) {
      if (!String((err as Error).message).includes("429") || attempt >= 8) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
};

interface TxStatus {
  transaction_outcome: { block_hash: string };
  receipts_outcome: Array<{ block_hash: string }>;
}

function loadTxs(files: string[]): Map<string, string> {
  const txs = new Map<string, string>();
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { tx?: string | null; signer?: string };
      if (row.tx && row.signer) txs.set(row.tx, row.signer);
    }
  }
  return txs;
}

async function heightOf(blockHash: string, cache: Map<string, number>): Promise<number> {
  const hit = cache.get(blockHash);
  if (hit !== undefined) return hit;
  const b = (await call("block", { block_id: blockHash })) as { header: { height: number } };
  cache.set(blockHash, b.header.height);
  return b.header.height;
}

async function main(): Promise<void> {
  const [out, ...files] = process.argv.slice(2);
  if (!out || files.length === 0) throw new Error("usage: indexer-collect-heights.ts <out.json> <txlog.jsonl>...");
  const txs = loadTxs(files);
  const heights = new Set<number>();
  const blockCache = new Map<string, number>();
  const unresolved: string[] = [];
  for (const [hash, signer] of txs) {
    try {
      const st = (await call("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" })) as TxStatus;
      const blocks = new Set([st.transaction_outcome.block_hash, ...st.receipts_outcome.map((r) => r.block_hash)]);
      for (const bh of blocks) heights.add(await heightOf(bh, blockCache));
    } catch {
      unresolved.push(hash);
    }
  }
  const sorted = [...heights].sort((a, b) => a - b);
  writeFileSync(out, JSON.stringify({ rpc: RPC, tx_hashes: txs.size, unresolved, heights: sorted }));
  console.log(`tx_hashes=${txs.size} unresolved=${unresolved.length} heights=${sorted.length} min=${sorted[0]} max=${sorted[sorted.length - 1]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
