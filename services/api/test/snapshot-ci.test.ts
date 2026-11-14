import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURE_CONTRACTS, generateFullFixtureBlocks } from "../../indexer/src/fixtures.ts";
import { ListSource } from "../../indexer/src/sources.ts";
import { Store } from "../../indexer/src/store.ts";
import { PacedSource, REQUIRED_FILES, configSignature, ingestWithBudget, rejectBake } from "../src/snapshot-ci.ts";
import type { Meta } from "../src/snapshot-ci.ts";
import { bakeAccounts, bakeSnapshot, snapshotFile } from "../src/snapshot.ts";

const meta = (over: Partial<Meta> = {}): Meta => ({ network: "testnet", config: "c", block_height: 100, event_count: 50, launch_count: 3, state_hash: "h", baked_at: 1, ...over });

test("rejectBake: an empty or older ingest never replaces good data", () => {
  assert.equal(rejectBake(meta(), REQUIRED_FILES, null), null);
  assert.equal(rejectBake(meta(), REQUIRED_FILES, meta({ block_height: 90 })), null);
  assert.match(rejectBake(meta({ block_height: null }), REQUIRED_FILES, meta()) ?? "", /empty ingest/);
  assert.match(rejectBake(meta({ block_height: 99 }), REQUIRED_FILES, meta()) ?? "", /backwards/);
  assert.match(rejectBake(meta({ event_count: 10 }), REQUIRED_FILES, meta()) ?? "", /event count shrank/);
  assert.match(rejectBake(meta({ launch_count: 0 }), REQUIRED_FILES, meta()) ?? "", /launch count shrank/);
  assert.match(rejectBake(meta({ config: "other" }), REQUIRED_FILES, meta()) ?? "", /config changed/);
  assert.match(rejectBake(meta(), REQUIRED_FILES.slice(1), null) ?? "", /missing api\/health.json/);
});

test("configSignature separates core, market and launcher", () => {
  assert.notEqual(configSignature("testnet", { core: ["a"], market: [] }), configSignature("testnet", { core: [], market: ["a"] }));
});

test("ingestWithBudget folds blocks in steps and resumes from the stored checkpoint", async () => {
  const blocks = generateFullFixtureBlocks(7, 40);
  const store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  const src = new ListSource(blocks);
  const first = await ingestWithBudget(store, src, blocks[0]!.block.header.height, 60_000, 25);
  assert.equal(first.error, null);
  assert.ok(first.blocks > 0);
  const events = store.eventCount();
  const again = await ingestWithBudget(store, src, "tip", 60_000, 25);
  assert.equal(again.blocks, 0);
  assert.equal(store.eventCount(), events);
  store.close();
});

test("ingestWithBudget reports a failing source without losing blocks already stored", async () => {
  const blocks = generateFullFixtureBlocks(7, 20);
  const store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  const ok = new ListSource(blocks);
  let calls = 0;
  const flaky = { name: "flaky", network: "fixture", finalHeight: () => ok.finalHeight(), block: async (h: number) => { if (++calls > 5) throw new Error("neardata 503"); return ok.block(h); } };
  const r = await ingestWithBudget(store, new PacedSource(flaky, 0, 1), blocks[0]!.block.header.height, 60_000, 3);
  assert.match(r.error ?? "", /503/);
  assert.ok(store.checkpoint() !== null);
  store.close();
});

test("the bake covers every API read the app makes", () => {
  const store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFullFixtureBlocks(7, 60)) store.ingestBlock(b, "fixture");
  const out = mkdtempSync(join(tmpdir(), "kruxa-bake-"));
  const { files } = bakeSnapshot(store, out, 1700000000);
  const id = String((store.db.prepare("SELECT launch_id FROM launches ORDER BY launch_id LIMIT 1").get() as { launch_id: number }).launch_id);
  const account = bakeAccounts(store)[0] as string;
  const reads = [
    "/api/health", "/api/launches", "/api/stats", "/api/ops-log", `/api/launch/${id}`, `/api/launch/${id}/custody`, `/api/token/${id}`, `/api/token/${id}/trades`,
    `/api/token/${id}/holders`, `/api/token/${id}/depth`, `/api/token/${id}/candles`, `/api/verify/${id}`, `/api/creator/${account}`, `/api/portfolio/${account}`, "/api/ops/status", "/api/ops/upgrades",
  ];
  for (const path of reads) {
    const rel = snapshotFile(path, new URLSearchParams("interval=1h"));
    assert.ok(rel && files.includes(rel), `${path} -> ${rel} is not baked`);
    assert.ok(existsSync(join(out, rel)));
  }
  assert.ok(files.includes("api/ops-log-core.json"));
  assert.equal(JSON.parse(readFileSync(join(out, "api/health.json"), "utf8")).status, "snapshot");
  store.close();
});
