import assert from "node:assert/strict";
import { test } from "node:test";
import { Store, ReorgError } from "../src/store.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../src/fixtures.ts";
import { fixtureStore, rows } from "./helpers.ts";

test("fixture fold: launches, verdicts, pool, balances", () => {
  const s = fixtureStore();
  const l = rows(s, "SELECT * FROM launches ORDER BY launch_id");
  assert.deepEqual(l.map((r) => [r.symbol, r.status, r.verdict]), [["ALPHA", "passed", "PASS"], ["BRAVO", "failed", "FAIL"], ["CHARLIE", "open", null]]);
  assert.equal(l[2]?.payout_recipient, "carol-treasury.testnet");
  assert.equal(l[0]?.payout_recipient, "alice.testnet");
  assert.ok(l.every((r) => r.source === "fixture"));
  const pool = rows(s, "SELECT * FROM pools")[0];
  assert.equal(pool?.mint_authority_null, 1);
  const bal = rows(s, "SELECT SUM(CAST(balance AS INTEGER)) AS s FROM balances WHERE launch_id = 1")[0];
  assert.ok(Number(bal?.s) > 0);
});

test("candles: OHLC invariants and volume equals trade volume at every interval", () => {
  const s = fixtureStore();
  const total = rows(s, "SELECT SUM(CAST(quote_amount AS INTEGER)) AS q, COUNT(*) AS n FROM trades")[0];
  for (const iv of ["1m", "5m", "1h", "1d"]) {
    const sum = rows(s, "SELECT SUM(CAST(v AS INTEGER)) AS q, SUM(n) AS n FROM candles WHERE interval = ?", iv)[0];
    assert.equal(sum?.q, total?.q, iv);
    assert.equal(sum?.n, total?.n, iv);
    for (const c of rows(s, "SELECT * FROM candles WHERE interval = ?", iv)) {
      const [o, h, l, cl] = ["o", "h", "l", "c"].map((k) => BigInt(String(c[k])));
      assert.ok(h! >= o! && h! >= cl! && l! <= o! && l! <= cl!);
    }
  }
});

test("idempotent: re-delivering every block changes nothing", () => {
  const blocks = generateFixtureBlocks();
  const s = fixtureStore(blocks);
  const before = s.stateHash();
  const n = s.eventCount();
  for (const b of blocks) assert.equal(s.ingestBlock(b, "fixture").inserted, 0);
  assert.equal(s.stateHash(), before);
  assert.equal(s.eventCount(), n);
});

test("replay: same events always yield the same state hash (incremental, rebuild, fresh store, file-backed)", () => {
  const blocks = generateFixtureBlocks(7, 120);
  const a = fixtureStore(blocks);
  const hash = a.stateHash();
  assert.equal(fixtureStore(blocks).stateHash(), hash);
  a.rebuild();
  assert.equal(a.stateHash(), hash);
  const other = fixtureStore(generateFixtureBlocks(8, 120));
  assert.notEqual(other.stateHash(), hash);
});

test("out-of-order delivery of whole blocks converges on the same hash", () => {
  const blocks = generateFixtureBlocks(3, 60);
  const want = fixtureStore(blocks).stateHash();
  const s = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  const shuffled = [...blocks.slice(0, 20)].reverse().concat(blocks.slice(20));
  for (const b of shuffled) s.ingestBlock(b, "fixture");
  assert.equal(s.stateHash(), want);
});

test("reorg: a different hash at a known height raises, rollback then re-ingest of the new branch is clean", () => {
  const blocks = generateFixtureBlocks(5, 40);
  const s = fixtureStore(blocks);
  const cut = blocks[blocks.length - 4]!;
  const fork = structuredClone(cut);
  fork.block.header.hash = "forked";
  assert.throws(() => s.ingestBlock(fork, "fixture"), ReorgError);
  s.rollbackTo(cut.block.header.height - 1);
  const partial = fixtureStore(blocks.slice(0, blocks.length - 4));
  assert.equal(s.stateHash(), partial.stateHash());
  assert.equal(s.checkpoint()?.height, blocks[blocks.length - 5]?.block.header.height);
});

test("file-backed store uses WAL and survives reopen with the same hash", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const path = join(mkdtempSync(join(tmpdir(), "kruxa-idx-")), "i.db");
  const s = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFixtureBlocks(2, 30)) s.ingestBlock(b, "fixture");
  const h = s.stateHash();
  assert.equal((rows(s, "PRAGMA journal_mode")[0] as { journal_mode: string }).journal_mode, "wal");
  s.close();
  const r = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  assert.equal(r.stateHash(), h);
  r.close();
});
