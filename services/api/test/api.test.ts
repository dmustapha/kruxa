import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../../indexer/src/fixtures.ts";
import { Store } from "../../indexer/src/store.ts";
import { asOf } from "../src/common.ts";
import type { Ctx, Json } from "../src/common.ts";
import { createApp } from "../src/http.ts";
import type { App } from "../src/http.ts";

let app: App;
let base: string;
let store: Store;
const blocks = generateFixtureBlocks(7, 240);

before(async () => {
  store = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of blocks) store.ingestBlock(b, "fixture");
  const ctx: Ctx = { store, startedAt: 0, maxLagBlocks: 10, now: () => asOf(store).block_time ?? 0, tail: () => ({ headHeight: null, lastError: null }), dataSource: "fixture" };
  app = createApp(ctx);
  base = `http://127.0.0.1:${await app.listen(0)}`;
});
after(async () => {
  await app.close();
  store.close();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(base + path);
  const text = await r.text();
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
}

test("health reports fixture status and a stable state hash", async () => {
  const { body } = await get("/api/health");
  assert.equal(body.status, "fixture");
  assert.equal(body.source, "fixture");
  assert.equal(body.state_hash, store.stateHash());
});

test("launch feed: stages, search, filters, paging", async () => {
  const all = (await get("/api/launches")).body;
  assert.equal(all.source, "fixture");
  const stages = Object.fromEntries(all.items.map((l: Json) => [l.symbol, l.stage]));
  assert.deepEqual(stages, { ALPHA: "passed", BRAVO: "failed", CHARLIE: "new" });
  assert.equal((await get("/api/launches?stage=failed")).body.items[0].symbol, "BRAVO");
  assert.equal((await get("/api/launches?q=alp")).body.total, 1);
  assert.equal((await get("/api/launches?has_market=true")).body.items.length, 1);
  const p1 = (await get("/api/launches?limit=2")).body;
  assert.equal(p1.items.length, 2);
  const p2 = (await get(`/api/launches?limit=2&cursor=${p1.next_cursor}`)).body;
  assert.equal(p2.items.length, 1);
  assert.equal(p2.next_cursor, null);
  assert.equal((await get("/api/launches?stage=bogus")).status, 400);
});

test("launch detail, errors, and read-only", async () => {
  const d = (await get("/api/launch/1")).body;
  assert.equal(d.verdict, "PASS");
  assert.equal(d.verdict_inputs.margin_to_soft_cap, (BigInt(d.total_active) - 50_000_000n).toString());
  assert.ok(d.timeline.some((e: Json) => e.event === "pass_allocated"));
  assert.equal((await get("/api/launch/999")).status, 404);
  assert.equal((await get("/api/launch/abc")).status, 400);
  assert.equal((await fetch(base + "/api/launches", { method: "POST" })).status, 405);
});

test("token page: safety indicators never invent facts", async () => {
  const t = (await get("/api/token/1")).body;
  const by = Object.fromEntries(t.safety.map((s: Json) => [s.id, s.status]));
  assert.equal(by.mint_authority_null, "pass");
  assert.equal(by.creator_fee_within_bound, "pass");
  assert.equal(by.verdict_passed, "pass");
  assert.equal(t.pool.open, true);
  const c = (await get("/api/token/3")).body;
  const byC = Object.fromEntries(c.safety.map((s: Json) => [s.id, s.status]));
  assert.equal(byC.mint_authority_null, "unknown");
  assert.equal(c.pool.open, false);
  assert.equal(c.creator.payout_recipient, "carol-treasury.testnet");
});

test("candles: ascending, fixture-labelled, latest-N and fill", async () => {
  const c = (await get("/api/token/1/candles?interval=5m&limit=10")).body;
  assert.equal(c.candles.length, 10);
  assert.ok(c.candles.every((x: Json, i: number, a: Json[]) => i === 0 || Number(x.t) > Number(a[i - 1]!.t)));
  assert.ok(c.candles.every((x: Json) => x.source === "fixture" && Number(x.h) >= Number(x.l)));
  const t0 = c.candles[0].t;
  assert.equal((await get(`/api/token/1/candles?interval=1h&from=${t0}&to=${t0 + 7200}`)).body.candles.length <= 3, true);
  assert.equal((await get("/api/token/1/candles?interval=2m")).status, 400);
  const filled = (await get("/api/token/1/candles?interval=1d&fill=true")).body;
  assert.ok(filled.candles.length >= 1);
});

test("trades page newest first without overlap; holders and depth", async () => {
  const p1 = (await get("/api/token/1/trades?limit=100")).body;
  assert.equal(p1.items.length, 100);
  const p2 = (await get(`/api/token/1/trades?limit=100&before=${p1.next_cursor}`)).body;
  const ids = new Set([...p1.items, ...p2.items].map((t: Json) => t.receipt_id));
  assert.equal(ids.size, p1.items.length + p2.items.length);
  assert.ok(Number(p1.items[0].time) >= Number(p2.items[0].time));
  const h = (await get("/api/token/1/holders")).body;
  assert.ok(h.items.some((x: Json) => x.is_pool));
  const d = (await get("/api/token/1/depth")).body;
  const buys = d.ladder.filter((r: Json) => r.side === "buy").map((r: Json) => r.price_impact_bps);
  assert.deepEqual([...buys].sort((a, b) => a - b), buys);
  assert.ok(buys[buys.length - 1] > buys[0]);
});

test("creator desk, portfolio and verify", async () => {
  const desk = (await get("/api/creator/alice.testnet")).body;
  assert.equal(desk.launches[0].role, "both");
  assert.equal(desk.launches[0].stream.total, "9000000");
  assert.equal(desk.launches[0].stream.drawn, "250000");
  assert.ok(desk.claims.some((c: Json) => c.kind === "creator_claimed"));
  assert.equal((await get("/api/portfolio/dan.testnet")).body.positions[0].status, "claimed");
  assert.equal((await get("/api/portfolio/fay.testnet")).body.positions[0].status, "claimable");
  const hal = (await get("/api/portfolio/hal.testnet")).body;
  assert.equal(hal.positions[0].status, "walked");
  const v = (await get("/api/verify/1")).body;
  assert.equal(v.ledger_consistent, true);
  assert.equal(v.fold_ok, null);
  assert.equal((await get("/api/verify/2")).body.verdict, "FAIL");
});

test("csv exports have the documented headers", async () => {
  assert.match((await get("/api/export/launches.csv")).body, /^launch_id,symbol,creator,status,total_active,funders,verdict,source\n/);
  assert.match((await get("/api/export/trades.csv?launch_id=1")).body, /^launch_id,time,side,trader,amount_in,amount_out,price,fee_total,block_height,receipt_id,source\n/);
  assert.match((await get("/api/export/creator/alice.testnet/claims.csv")).body, /^launch_id,kind,amount/);
});

test("every path in the OpenAPI file is served", async () => {
  const yaml = readFileSync(new URL("../../../docs/interfaces/api.openapi.yaml", import.meta.url), "utf8");
  const paths = [...yaml.matchAll(/^ {2}(\/api\/[^:]+):$/gm)].map((m) => m[1] as string).filter((p) => p !== "/api/stream");
  assert.ok(paths.length >= 14);
  for (const p of paths) {
    const url = p.replace("{id}", "1").replace("{account}", "alice.testnet");
    const r = await get(url);
    assert.equal(r.status, 200, url);
    if (typeof r.body === "object" && !url.includes("health")) assert.ok(r.body.source === "fixture" || r.body.source === undefined, url);
  }
});

test("SSE: a newly ingested trade arrives on the stream with a fixture label, and Last-Event-ID replays", async () => {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/stream?launch_id=1`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const tip = store.checkpoint()!;
  const line = `EVENT_JSON:${JSON.stringify({ standard: "kruxa", version: "1.0.0", event: "swap", data: [{ launch_id: "1", side: "buy", trader: "zed.testnet", amount_in: "500000", amount_out: "20000000", fee_total: "5000" }] })}`;
  const fresh = { block: { header: { height: tip.height + 2, hash: "sse-1", prev_hash: tip.hash, timestamp_nanosec: ((BigInt(asOf(store).block_time!) + 60n) * 1_000_000_000n).toString() } },
    shards: [{ receipt_execution_outcomes: [{ execution_outcome: { id: "sse-r1", outcome: { executor_id: "market.fixture.testnet", logs: [line], status: { SuccessValue: "" } } } }] }] };
  setTimeout(() => store.ingestBlock(fresh, "fixture"), 50);
  const deadline = Date.now() + 5000;
  while (!/event: trade\n/.test(buf) && Date.now() < deadline) buf += dec.decode((await reader.read()).value);
  ac.abort();
  assert.match(buf, /event: hello/);
  const m = /event: trade\ndata: (.*)\n/.exec(buf);
  assert.ok(m, buf);
  assert.equal(JSON.parse(m![1]!).source, "fixture");
  const id = /id: (\d+)\nevent: trade/.exec(buf)![1]!;
  const ac2 = new AbortController();
  const r2 = await fetch(`${base}/api/stream?launch_id=1`, { signal: ac2.signal, headers: { "last-event-id": String(Number(id) - 1) } });
  const first = dec.decode((await r2.body!.getReader().read()).value);
  ac2.abort();
  assert.match(first, /event: hello/);
});
