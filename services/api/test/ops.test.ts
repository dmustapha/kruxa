import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURE_CONTRACTS, FIXTURE_DAY_SECONDS, generateFullFixtureBlocks } from "../../indexer/src/fixtures.ts";
import { OPS_HASHES } from "../../indexer/src/fixtures-ops.ts";
import { Store } from "../../indexer/src/store.ts";
import { asOf } from "../src/common.ts";
import type { Ctx } from "../src/common.ts";
import { createApp } from "../src/http.ts";
import type { App } from "../src/http.ts";
import { OPS_CATEGORY } from "../src/ops-summary.ts";
import { bakeSnapshot, serveSnapshot } from "../src/snapshot.ts";

let app: App;
let base: string;
let store: Store;

before(async () => {
  store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFullFixtureBlocks(7, 60)) store.ingestBlock(b, "fixture");
  const ctx: Ctx = { store, startedAt: 0, maxLagBlocks: 10, now: () => asOf(store).block_time ?? 0, tail: () => ({ headHeight: null, lastError: null }), dataSource: "fixture", daySeconds: FIXTURE_DAY_SECONDS };
  app = createApp(ctx);
  base = `http://127.0.0.1:${await app.listen(0)}`;
});
after(async () => {
  await app.close();
  store.close();
});

async function get(path: string, origin = base): Promise<{ status: number; body: any; headers: Headers }> {
  const r = await fetch(origin + path);
  const text = await r.text();
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text, headers: r.headers };
}

test("/api/ops/status: operating state for the status page", async () => {
  const s = (await get("/api/ops/status")).body;
  assert.equal(s.source, "fixture");
  assert.equal(s.core.state, "live");
  assert.equal(s.core.observed, true);
  assert.equal(s.market.paused, false);
  assert.deepEqual(s.genesis, { paused: false, relayer: "relayer.fixture.testnet" });
  assert.equal(s.market_account.core, "market.fixture.testnet");
  assert.deepEqual(s.creator_gate, { core_open: true, launcher_open: true });
  assert.equal(s.caps.global.value, "1000000000");
  assert.equal(s.caps.global.queued.value, "6000000000");
  assert.equal(s.caps.launch.queued.value, "2000000000");
  assert.equal(s.pending_upgrade.code_hash, OPS_HASHES.upgradePending);
  assert.deepEqual(s.halted_launches, ["4"]);
  assert.equal(s.force_resolves_queued, 1);
  assert.equal(s.owed.near_total_yocto, "310000000000000000000000");
  assert.equal(s.solvency.ok, true);
  assert.equal(s.solvency.intents, null);
  assert.ok(s.solvency.age_s >= 0);
  assert.ok(s.since_block > 0 && typeof s.basis === "string");
});

test("/api/ops/status shows a freeze as paused once its time is up", async () => {
  const frozen = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFullFixtureBlocks(7, 5)) frozen.ingestBlock(b, "fixture");
  const t = asOf(frozen).block_time ?? 0;
  frozen.db.prepare("INSERT OR REPLACE INTO flags VALUES ('state:core', ?)").run(JSON.stringify({ state: "frozen", by: "g", until: t + 100, at: t }));
  let clock = t;
  const a = createApp({ store: frozen, startedAt: 0, maxLagBlocks: 10, now: () => clock, tail: () => ({ headHeight: null, lastError: null }), dataSource: "fixture", daySeconds: 600 });
  assert.equal((a.handle("/api/ops/status").body as any).core.effective_state, "frozen");
  clock = t + 100;
  assert.equal((a.handle("/api/ops/status").body as any).core.effective_state, "paused");
  await a.close();
  frozen.close();
});

test("upgrade queue endpoint: pending, applied and cancelled, newest first", async () => {
  const u = (await get("/api/ops/upgrades")).body;
  assert.deepEqual(u.items.map((i: any) => i.status), ["queued", "applied", "cancelled"]);
  assert.equal(u.pending.code_hash, OPS_HASHES.upgradePending);
  assert.equal(u.items[2].resolved_by, "guardian.testnet");
  assert.ok(u.items[0].effective_at > u.items[0].queued_at);
});

test("halts endpoint: active filter and reasons", async () => {
  const all = (await get("/api/ops/halts")).body.items;
  assert.equal(all.length, 2);
  const active = (await get("/api/ops/halts?active=true")).body.items;
  assert.deepEqual(active.map((h: any) => [h.launch_id, h.halted, h.reason]), [["4", true, "genesis rehearsal in progress"]]);
  assert.equal((await get("/api/ops/halts?active=false")).body.items[0].launch_id, "3");
  assert.equal((await get("/api/ops/halts?active=maybe")).status, 400);
  const detail = (await get("/api/launch/4")).body;
  assert.equal(detail.halted, true);
  assert.equal(detail.halt.halted_by, "owner.testnet");
  assert.equal((await get("/api/launch/3")).body.halted, false);
  assert.equal((await get("/api/launch/3")).body.halt.halt_count, 1);
  assert.equal((await get("/api/launches?limit=50")).body.items.find((l: any) => l.launch_id === "4").halted, true);
});

test("force-resolves endpoint: queue and execution", async () => {
  const r = (await get("/api/ops/force-resolves")).body.items;
  assert.deepEqual(r.map((x: any) => [x.launch_id, x.state, x.ok]).sort(), [["1", "queued", false], ["2", "executed", true]]);
  assert.equal(r.find((x: any) => x.state === "executed").evidence.startsWith("receipt"), true);
  assert.equal((await get("/api/ops/force-resolves?state=queued")).body.items.length, 1);
  assert.equal((await get("/api/ops/force-resolves?state=x")).status, 400);
});

test("solvency endpoint: newest first, a failing report is visible", async () => {
  const s = (await get("/api/ops/solvency")).body;
  assert.equal(s.items.length, 3);
  assert.equal(s.failing, 1);
  assert.equal(s.items[1].ok, false);
  assert.equal(s.items[1].native.ok, false);
  assert.equal(s.items[0].intents_alert, true);
  assert.equal(s.latest.block_height, s.items[0].block_height);
  assert.equal((await get("/api/ops/solvency?limit=1")).body.items.length, 1);
});

test("owed endpoint: outstanding balances, by account and scope", async () => {
  const o = (await get("/api/ops/owed")).body.items;
  assert.deepEqual(o.map((x: any) => [x.account, x.token, x.balance]), [["alice.testnet", "NEAR", "300000000000000000000000"], ["bob.testnet", "NEAR", "10000000000000000000000"]]);
  assert.equal((await get("/api/ops/owed?account=bob.testnet")).body.items.length, 1);
  assert.equal((await get("/api/ops/owed?scope=market")).body.items.length, 0);
  assert.equal((await get("/api/ops/owed?scope=nope")).status, 400);
});

test("launch custody endpoint: token allocation, sweeps, refunds and the lengthened stream", async () => {
  const a = (await get("/api/launch/1/custody")).body;
  assert.equal(a.creator_allocation.claimed, "40000000000", "the failed 7e9 claim was re-credited");
  assert.equal(a.deliveries.refused, 1);
  assert.deepEqual(a.deliveries.failed_legs.map((x: any) => [x.kind, x.amount]), [["AllocClaim", "7000000000"]]);
  assert.equal(a.stream.lengthened, 1);
  assert.equal(a.stream.unlocked_at_change, "1200000");
  assert.ok(a.stream.end_at > a.stream.changed_at);
  assert.ok(a.events.some((e: any) => e.event === "stream_lengthened"));
  const b = (await get("/api/launch/2/custody")).body;
  assert.deepEqual([b.sweep.swept, b.sweep.mode, b.refunds.batches, b.refunds.handled, b.refunds.paid, b.refunds.routed_to_intents], ["900000000", "hold", 1, 2, 1, 1]);
  const d = (await get("/api/launch/4/custody")).body;
  assert.deepEqual([d.sweep.mode, d.orphan_credits_refused, d.deposits_refused_refundable], ["sink:dead.testnet", 1, 1]);
  assert.equal(d.halted, true);
  assert.equal((await get("/api/launch/3/custody")).body.creator_allocation.claimed, "0");
  assert.equal((await get("/api/launch/999/custody")).status, 404);
  assert.equal((await get("/api/launch/x/custody")).status, 400);
});

test("the creator desk meter follows a lengthened stream and lists the alloc claim", async () => {
  const desk = (await get("/api/creator/alice.testnet")).body;
  const l1 = desk.launches.find((l: any) => l.launch.launch_id === "1");
  assert.equal(l1.stream.lengthened, 1);
  assert.ok(BigInt(l1.stream.unlocked) >= 1_200_000n);
  assert.ok(desk.claims.some((c: any) => c.kind === "alloc_claim" && c.amount === "40000000000"));
  assert.ok(!desk.claims.some((c: any) => c.kind === "alloc_claim" && c.amount === "7000000000"), "a failed leg is not a claim");
});

test("launch genesis endpoint: reopen history, F0 messages, attestations", async () => {
  const g = (await get("/api/launch/4/genesis")).body;
  assert.equal(g.stage, "committed");
  assert.equal(g.path, "F0");
  assert.equal(g.reopen_count, 1);
  assert.ok(g.reopened_at > 0);
  assert.equal(g.abort, null);
  assert.deepEqual(g.f0.messages.map((m: any) => m.tx_index), [0]);
  assert.deepEqual(g.f0.sign_requests, []);
  assert.equal(g.attestations.length, 1);
  assert.equal(g.leaf_count, 3);
  assert.deepEqual(g.history.map((h: any) => h.event), ["genesis_committed", "f0_message_registered", "f0_message_registered", "f0_sign_requested", "genesis_aborted", "genesis_reopened",
    "genesis_committed", "f0_message_registered", "attest_log"]);
  const aborted = g.history.find((h: any) => h.event === "genesis_aborted");
  assert.equal(aborted.data.reason, "signer offline during the ceremony");
  assert.equal((await get("/api/launch/1/genesis")).body.stage, "confirmed");
  assert.equal((await get("/api/launch/1000000000/genesis")).status, 404);
  assert.equal((await get("/api/launch/4")).body.genesis.reopen_count, 1);
  assert.equal((await get("/api/token/1")).body.genesis.stage, "confirmed");
});

test("verify: the indexer replays the rolling book hash", async () => {
  const v = (await get("/api/verify/4")).body;
  assert.deepEqual([v.fold_ok, v.fold_events, v.fold_first_mismatch_block], [true, 3, null]);
  assert.equal(v.book_hash_recomputed, v.book_hash_folded);
  assert.equal((await get("/api/verify/1000000000")).body.fold_ok, null);
});

test("ops-log carries the new events with categories, launch ids and filters", async () => {
  const all = (await get("/api/ops-log?limit=200")).body;
  const names = new Set(all.items.map((i: any) => i.event));
  for (const e of ["halted", "resumed", "upgrade_queued", "upgrade_cancelled", "upgraded", "force_resolve_queued", "op_force_resolved", "solvency_report", "owed_near_credited",
    "creator_alloc_claimed", "tokens_swept", "token_delivery_refused", "stream_lengthened", "refund_batch", "refund_route_set", "orphan_credit_refused", "genesis_reopened",
    "f0_message_registered", "attest_log", "genesis_aborted", "frozen"]) assert.ok(names.has(e), e);
  assert.ok(all.items.every((i: any) => OPS_CATEGORY[i.event] === i.category && typeof i.summary === "string" && !i.summary.includes("[object")));
  assert.equal((await get("/api/ops-log?category=upgrade")).body.items.length, 5);
  assert.equal((await get("/api/ops-log?category=halt")).body.items.length, 3);
  const l4 = (await get("/api/ops-log?launch_id=4&limit=200")).body.items;
  assert.ok(l4.length >= 8 && l4.every((i: any) => i.launch_id === "4"));
  assert.equal((await get("/api/ops-log?category=bogus")).status, 400);
  assert.equal((await get("/api/ops-log?launch_id=abc")).status, 400);
  const halted = all.items.find((i: any) => i.event === "halted" && i.launch_id === "3");
  assert.equal(halted.summary, "launch 3 halted by guardian.testnet: metadata dispute, trial paused for review");
  const p1 = (await get("/api/ops-log?limit=10")).body;
  const p2 = (await get(`/api/ops-log?limit=10&before=${p1.next_cursor}`)).body;
  assert.ok(p2.items[0].block_height < p1.items[9].block_height);
});

test("existing endpoints keep their shape: launch feed, token page, stats and health still answer", async () => {
  assert.equal((await get("/api/launches")).status, 200);
  const token = (await get("/api/token/1")).body;
  for (const k of ["launch", "pool", "stats", "genesis", "safety", "creator", "external_pools"]) assert.ok(k in token, k);
  for (const k of ["stage", "phase", "tab", "has_market"]) assert.ok(k in token.launch, k);
  assert.equal((await get("/api/health")).body.state_hash, store.stateHash());
  assert.equal((await get("/api/stats")).status, 200);
});

// --- snapshot mode ---------------------------------------------------------------------------------------------------

test("snapshot: bake from the fixture store, serve it, and every page equals the live API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kruxa-snap-"));
  const baked = bakeSnapshot(store, dir, 1_900_000_000);
  assert.ok(baked.files.length > 60);
  for (const f of ["api/launches.json", "api/stats.json", "api/ops-log.json", "api/ops/status.json", "api/ops/upgrades.json", "api/ops/solvency.json", "api/launch/1/custody.json", "api/launch/4/genesis.json", "api/token/1/candles-1h.json"]) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  assert.ok(!existsSync(join(dir, "api/launch/1000000000/genesis.json")), "instant launches have no genesis page");
  const server = serveSnapshot(dir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const snap = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const p of ["/api/launches", "/api/ops/status", "/api/ops/halts", "/api/ops/force-resolves", "/api/ops/owed", "/api/launch/1", "/api/launch/4/genesis", "/api/launch/2/custody", "/api/token/1", "/api/token/1000000000", "/api/token/1/trades"]) {
      const live = (await get(p === "/api/launches" ? "/api/launches?limit=200" : p)).body;
      const recorded = await get(p, snap);
      assert.equal(recorded.status, 200, p);
      assert.deepEqual(recorded.body, live, p);
      assert.equal(recorded.headers.get("x-kruxa-data"), "snapshot");
    }
    assert.deepEqual((await get("/api/token/1/candles?interval=1h", snap)).body, (await get("/api/token/1/candles?interval=1h")).body);
    const health = (await get("/api/health", snap)).body;
    assert.deepEqual([health.status, health.data_source, health.baked_at], ["snapshot", "snapshot", 1_900_000_000]);
    assert.equal(health.snapshot.block_height, asOf(store).block_height);
    assert.equal(health.state_hash, store.stateHash());
    assert.equal((await get("/api/ops-log?limit=200", snap)).body.items.length, (await get("/api/ops-log?limit=200")).body.items.length);
    assert.equal((await get("/api/launch/9999", snap)).body.error.code, "not_in_snapshot");
    assert.equal((await get("/api/stream", snap)).body.error.code, "snapshot_no_stream");
    assert.equal((await get("/api/token/1/candles?interval=9h", snap)).status, 404);
    assert.equal((await get("/api/../etc/passwd", snap)).status, 404);
    assert.equal((await fetch(snap + "/api/health", { method: "POST" })).status, 405);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "api/health.json"), "utf8")).snapshot.baked_at, 1_900_000_000);
});

test("OpenAPI documents every new endpoint and every $ref resolves", () => {
  const yaml = readFileSync(new URL("../../../docs/interfaces/api.openapi.yaml", import.meta.url), "utf8");
  for (const p of ["/api/ops/status", "/api/ops/upgrades", "/api/ops/halts", "/api/ops/force-resolves", "/api/ops/solvency", "/api/ops/owed", "/api/launch/{id}/custody", "/api/launch/{id}/genesis"]) {
    assert.ok(yaml.includes(`\n  ${p}:\n`), p);
  }
  const defined = new Set([...yaml.matchAll(/^ {4}(\w+):$/gm)].map((m) => m[1]));
  const refs = [...yaml.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1] as string);
  assert.deepEqual([...new Set(refs)].filter((r) => !defined.has(r)), []);
  assert.match(yaml, /version: 1\.3\.0/);
});
