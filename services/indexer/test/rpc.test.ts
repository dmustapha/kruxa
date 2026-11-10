import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_CONTRACTS, generateFullFixtureBlocks } from "../src/fixtures.ts";
import { FallbackSource, RpcError, RpcSource } from "../src/rpc.ts";
import type { RpcCall } from "../src/rpc.ts";
import { ListSource } from "../src/sources.ts";
import { Store } from "../src/store.ts";
import { Tailer } from "../src/tailer.ts";
import type { BlockSource, NearBlock } from "../src/types.ts";
import { fixtureStore } from "./helpers.ts";

const ACCOUNTS = [...FIXTURE_CONTRACTS.core, ...FIXTURE_CONTRACTS.market, ...(FIXTURE_CONTRACTS.launcher ?? [])];

interface FakeChain {
  call: RpcCall;
  calls: string[];
  firstHeight: number;
}

/**
 * A NEAR JSON-RPC stand-in built from fixture blocks. Each fixture block H becomes two chain blocks: an inclusion block H-1 whose chunk holds one
 * transaction per receipt (plus one unrelated transaction that must never be resolved), and the execution block H holding the outcomes.
 */
function fakeChain(blocks: NearBlock[], opts: { transferVia?: boolean } = {}): FakeChain {
  const headers = new Map<number, { header: Record<string, unknown>; chunks: Array<{ chunk_hash: string }> }>();
  const chunks = new Map<string, { transactions: Array<Record<string, unknown>> }>();
  const statuses = new Map<string, { receipts_outcome: Array<Record<string, unknown>> }>();
  let prev = "chain-genesis";
  for (const b of blocks) {
    const h = b.block.header.height;
    const incl = `incl-${h - 1}`;
    const txs: Array<Record<string, unknown>> = [{ hash: `tx-noise-${h}`, signer_id: "noise.testnet", receiver_id: "noise.testnet", actions: [] }];
    const outcomes = b.shards.flatMap((s) => s.receipt_execution_outcomes ?? []);
    outcomes.forEach((o, i) => {
      const hash = `tx-${o.execution_outcome.id}`;
      const viaToken = opts.transferVia === true && i % 2 === 1;
      const args = Buffer.from(JSON.stringify({ receiver_id: o.execution_outcome.outcome.executor_id, amount: "1" })).toString("base64");
      txs.push(viaToken
        ? { hash, signer_id: "user.testnet", receiver_id: "usdc.testnet", actions: [{ FunctionCall: { method_name: "ft_transfer_call", args } }] }
        : { hash, signer_id: "user.testnet", receiver_id: o.execution_outcome.outcome.executor_id, actions: [] });
      statuses.set(hash, { receipts_outcome: [{ block_hash: b.block.header.hash, id: o.execution_outcome.id, outcome: o.execution_outcome.outcome }] });
    });
    chunks.set(`chunk-${h - 1}`, { transactions: txs });
    headers.set(h - 1, { header: { height: h - 1, hash: incl, prev_hash: prev, timestamp_nanosec: b.block.header.timestamp_nanosec }, chunks: [{ chunk_hash: `chunk-${h - 1}` }] });
    headers.set(h, { header: { ...b.block.header, prev_hash: incl }, chunks: [] });
    prev = b.block.header.hash;
  }
  const calls: string[] = [];
  const tip = blocks[blocks.length - 1]?.block.header.height ?? 0;
  const call: RpcCall = async (method, params) => {
    const p = params as Record<string, unknown>;
    calls.push(method === "EXPERIMENTAL_tx_status" ? `tx:${String(p.tx_hash)}` : method);
    if (method === "block") {
      if (p.finality === "final") return headers.get(tip);
      const b = headers.get(Number(p.block_id));
      if (!b) throw new RpcError("UNKNOWN_BLOCK", "no block");
      return b;
    }
    if (method === "chunk") return chunks.get(String(p.chunk_id));
    if (method === "EXPERIMENTAL_tx_status") return statuses.get(String(p.tx_hash)) ?? { receipts_outcome: [] };
    throw new Error(`unexpected ${method}`);
  };
  return { call, calls, firstHeight: (blocks[0]?.block.header.height ?? 1) - 1 };
}

function emptyStore(): Store {
  return new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
}

test("RPC block scan rebuilds the same read model as the primary source, skipping unrelated transactions", async () => {
  const blocks = generateFullFixtureBlocks(7, 20);
  const chain = fakeChain(blocks);
  const store = emptyStore();
  const source = new RpcSource("fixture", chain.call, { accounts: ACCOUNTS, window: 4 });
  const tailer = new Tailer(store, source, "fixture", chain.firstHeight);
  await tailer.catchUp();
  assert.equal(store.stateHash(), fixtureStore(blocks).stateHash());
  assert.equal(store.badEvents, 0);
  assert.equal(chain.calls.filter((c) => c.startsWith("tx:tx-noise")).length, 0, "an unrelated transaction is never resolved");
  assert.ok(chain.calls.filter((c) => c.startsWith("tx:")).length > 0);
});

test("RPC scan follows ft_transfer_call to a watched account, and scanAllTransactions resolves the rest", async () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const chain = fakeChain(blocks, { transferVia: true });
  const store = emptyStore();
  await new Tailer(store, new RpcSource("fixture", chain.call, { accounts: ACCOUNTS, window: 4 }), "fixture", chain.firstHeight).catchUp();
  assert.equal(store.stateHash(), fixtureStore(blocks).stateHash());

  const all = fakeChain(blocks);
  await new Tailer(emptyStore(), new RpcSource("fixture", all.call, { accounts: ACCOUNTS, window: 4, scanAllTransactions: true }), "fixture", all.firstHeight).catchUp();
  assert.ok(all.calls.some((c) => c.startsWith("tx:tx-noise")));
});

test("RPC scan: a skipped height reads as null, finalHeight is the final block, a window too small misses a late receipt", async () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const chain = fakeChain(blocks);
  const source = new RpcSource("fixture", chain.call, { accounts: ACCOUNTS, window: 4 });
  assert.equal(await source.finalHeight(), blocks[blocks.length - 1]?.block.header.height);
  assert.equal(await source.block(1), null);
  assert.ok(source.limits.length >= 3);
  // a receipt executed after the window closed on its transaction is missed, which is why the window is documented as a limit
  const target = blocks.find((x) => (x.shards[0]?.receipt_execution_outcomes?.length ?? 0) > 0) as NearBlock;
  const h = target.block.header.height;
  const wide = await new RpcSource("fixture", fakeChain(blocks).call, { accounts: ACCOUNTS, window: 4 }).block(h);
  const narrow = await new RpcSource("fixture", fakeChain(blocks).call, { accounts: ACCOUNTS, window: 0 }).block(h);
  assert.ok((wide?.shards[0]?.receipt_execution_outcomes?.length ?? 0) > 0);
  assert.equal(narrow?.shards[0]?.receipt_execution_outcomes?.length, 0);
});

test("fallback: a failing primary is served by the secondary, the breaker skips it, and it returns after the cooldown", async () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  let primaryCalls = 0;
  let primaryDown = true;
  const good = new ListSource(blocks);
  const flaky: BlockSource = {
    name: "neardata", network: "fixture",
    finalHeight: async () => { primaryCalls++; if (primaryDown) throw new Error("neardata 503"); return good.finalHeight(); },
    block: async (h) => { primaryCalls++; if (primaryDown) throw new Error("neardata 503"); return good.block(h); },
  };
  const chain = fakeChain(blocks);
  const rpc = new RpcSource("fixture", chain.call, { accounts: ACCOUNTS, window: 4 });
  let clock = 0;
  const fb = new FallbackSource(flaky, rpc, { maxFailures: 2, cooldownMs: 1000, now: () => clock });
  const store = emptyStore();
  const t = new Tailer(store, fb, "fixture", chain.firstHeight);
  await t.catchUp(10);
  assert.equal(fb.name, "rpc");
  assert.equal(primaryCalls, 2, "after two failures the primary is not asked again");
  assert.ok(fb.fallbackCalls > 5);
  assert.match(fb.lastPrimaryError ?? "", /503/);
  primaryDown = false;
  clock = 5000;
  assert.equal(await fb.finalHeight(), blocks[blocks.length - 1]?.block.header.height);
  assert.equal(fb.name, "neardata");
  assert.ok(primaryCalls > 2);
});

test("fallback: neardata first, then RPC mid-stream, still converges on the same state as one source", async () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const split = Math.floor(blocks.length / 2);
  const chain = fakeChain(blocks);
  const store = emptyStore();
  // neardata-style blocks for the first half (no inclusion blocks), then the RPC scan continues from the checkpoint
  const nd = new ListSource(blocks.slice(0, split));
  await new Tailer(store, nd, "fixture", blocks[0]?.block.header.height ?? 0).catchUp();
  const rpc = new RpcSource("fixture", chain.call, { accounts: ACCOUNTS, window: 4 });
  const down: BlockSource = { name: "neardata", network: "fixture", finalHeight: async () => { throw new Error("down"); }, block: async () => { throw new Error("down"); } };
  const fb = new FallbackSource(down, rpc, { maxFailures: 1 });
  const tail = new Tailer(store, fb, "fixture", 0);
  await tail.catchUp();
  assert.equal(store.checkpoint()?.height, blocks[blocks.length - 1]?.block.header.height);
  assert.equal(store.eventCount(), fixtureStore(blocks).eventCount());
});
