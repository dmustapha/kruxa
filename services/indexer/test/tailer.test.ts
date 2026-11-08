import assert from "node:assert/strict";
import { test } from "node:test";
import { ListSource } from "../src/sources.ts";
import { Tailer } from "../src/tailer.ts";
import { Store } from "../src/store.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../src/fixtures.ts";
import { fixtureStore } from "./helpers.ts";

const mk = (): Store => new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });

test("tailer catches up through skipped heights and resumes from the checkpoint", async () => {
  const blocks = generateFixtureBlocks(1, 30);
  const s = mk();
  const src = new ListSource(blocks.slice(0, 20));
  const t = new Tailer(s, src, "fixture", blocks[0]!.block.header.height);
  assert.equal(await t.catchUp(), 20);
  src.replace(blocks);
  assert.equal(await t.catchUp(), blocks.length - 20);
  assert.equal(s.stateHash(), fixtureStore(blocks).stateHash());
});

test("tailer follows a reorg: orphaned blocks vanish, the new branch is folded", async () => {
  const blocks = generateFixtureBlocks(1, 30);
  const s = mk();
  const src = new ListSource(blocks);
  const t = new Tailer(s, src, "fixture", blocks[0]!.block.header.height);
  await t.catchUp();
  const keep = blocks.length - 3;
  const branch = structuredClone(blocks.slice(keep));
  let prev = blocks[keep - 1]!.block.header.hash;
  branch.forEach((b, i) => {
    b.block.header.hash = `alt-${i}`;
    b.block.header.prev_hash = prev;
    prev = `alt-${i}`;
    for (const sh of b.shards) for (const o of sh.receipt_execution_outcomes ?? []) o.execution_outcome.id += "-alt";
  });
  src.replace([...blocks.slice(0, keep), ...branch]);
  await t.catchUp();
  assert.ok(t.status.reorgs >= 1);
  assert.equal(s.checkpoint()?.hash, "alt-2");
  assert.equal(s.stateHash(), fixtureStore([...blocks.slice(0, keep), ...branch]).stateHash());
});
