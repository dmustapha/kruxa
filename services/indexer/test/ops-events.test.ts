import assert from "node:assert/strict";
import { test } from "node:test";
import { bookNext } from "../src/book.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks, generateFullFixtureBlocks } from "../src/fixtures.ts";
import { CORE_EVENTS, extractEvents } from "../src/parse.ts";
import { Store } from "../src/store.ts";
import type { NearBlock } from "../src/types.ts";
import { evLine, mkBlock, rows } from "./helpers.ts";

const CORE = FIXTURE_CONTRACTS.core[0] as string;
const MARKET = FIXTURE_CONTRACTS.market[0] as string;
const LAUNCHER = (FIXTURE_CONTRACTS.launcher as string[])[0] as string;
const T0 = 1_900_000_000;
const ns = (sec: number): string => (BigInt(sec) * 1_000_000_000n).toString();
const hex = (c: string): string => c.repeat(64);

type Item = [string, string, Record<string, unknown>];

/** One block per event, contract/event/data triples, strictly increasing heights and times. */
class Chain {
  readonly store: Store;
  readonly blocks: NearBlock[] = [];
  private height = 100;
  private prev = "genesis";
  private receipts = 0;

  constructor(store?: Store) {
    this.store = store ?? new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  }

  push(...items: Item[]): void {
    for (const [contract, event, data] of items) {
      this.height += 2;
      const hash = `b${this.height}`;
      const b = mkBlock(this.height, hash, this.prev, T0 + this.height, [{ id: `r${++this.receipts}`, executor: contract, line: evLine(event, data) }]);
      this.blocks.push(b);
      this.prev = hash;
      this.store.ingestBlock(b, "fixture");
    }
  }

  core(event: string, data: Record<string, unknown> = {}): void {
    this.push([CORE, event, data]);
  }
}

function withLaunches(): Chain {
  const c = new Chain();
  for (const id of ["1", "2"]) {
    c.core("charter_created", { launch_id: id, creator: `c${id}.testnet`, symbol: `S${id}`, name: `Name ${id}`, charter_hash: hex("0"), soft_cap: "50000000", min_funders: 3, stream_days: 30, total_supply: "1000000" });
    c.core("trial_opened", { launch_id: id, opens_at: ns(T0), commit_end: ns(T0 + 86400), walk_end: ns(T0 + 2 * 86400) });
  }
  return c;
}

const one = (s: Store, sql: string, ...p: Array<string | number>): Record<string, unknown> => rows(s, sql, ...p)[0] ?? {};

/** Core events added to the parser by this work; each one is emitted by contracts/core/src (see EVENTS.md "Operations and custody"). */
const NEW_KINDS = ["creator_alloc_claimed", "f0_message_registered", "f0_sign_requested", "genesis_reopened", "halted", "resumed", "op_force_resolved", "force_resolve_queued",
  "orphan_credit_refused", "owed_near_credited", "owed_near_withdrawn", "refund_batch", "refund_route_set", "solvency_report", "stream_lengthened", "token_delivery_refused",
  "tokens_swept", "upgrade_cancelled", "upgrade_queued", "upgraded"];

test("every core event the contract emits is in the parser's allow list", () => {
  for (const e of NEW_KINDS) assert.ok(CORE_EVENTS.has(e), e);
});

test("new core events count only from the configured core account", () => {
  const line = evLine("halted", { launch_id: "1", by: "x", reason: "r" });
  const block = (executor: string): NearBlock => mkBlock(10, "h", "p", T0, [{ id: "r", executor, line }]);
  assert.equal(extractEvents(block(CORE), FIXTURE_CONTRACTS).length, 1);
  assert.equal(extractEvents(block(MARKET), FIXTURE_CONTRACTS).length, 0);
  assert.equal(extractEvents(block(LAUNCHER), FIXTURE_CONTRACTS).length, 0);
  assert.equal(extractEvents(block("evil.testnet"), FIXTURE_CONTRACTS).length, 0);
  assert.equal(extractEvents(mkBlock(10, "h", "p", T0, [{ id: "r", executor: CORE, line, status: { Failure: {} } }]), FIXTURE_CONTRACTS).length, 0);
});

test("halted and resumed track the halt per launch with a count and the first reason", () => {
  const c = withLaunches();
  c.core("halted", { launch_id: "1", by: "guardian.testnet", reason: "dispute" });
  assert.equal(one(c.store, "SELECT halted, reason, halted_by, halt_count FROM halts WHERE launch_id = 1").halted, 1);
  c.core("resumed", { launch_id: "1" });
  const h = one(c.store, "SELECT * FROM halts WHERE launch_id = 1");
  assert.deepEqual([h.halted, h.reason, h.halted_by, h.halt_count], [0, "dispute", "guardian.testnet", 1]);
  assert.ok(h.resumed_at !== null);
  c.core("halted", { launch_id: "1", by: "owner.testnet", reason: "again" });
  const again = one(c.store, "SELECT * FROM halts WHERE launch_id = 1");
  assert.deepEqual([again.halted, again.reason, again.halt_count, again.resumed_at], [1, "again", 2, null]);
});

test("upgrade queue: queue, supersede, cancel, apply", () => {
  const c = withLaunches();
  const status = (): string[] => rows(c.store, "SELECT status FROM upgrades ORDER BY block_height").map((r) => String(r.status));
  c.core("upgrade_queued", { code_hash: hex("a"), effective_at: ns(T0 + 600) });
  assert.deepEqual(status(), ["queued"]);
  c.core("upgrade_queued", { code_hash: hex("b"), effective_at: ns(T0 + 900) });
  assert.deepEqual(status(), ["superseded", "queued"]);
  c.core("upgrade_cancelled", { code_hash: hex("b"), by: "guardian.testnet" });
  assert.deepEqual(status(), ["superseded", "cancelled"]);
  assert.equal(one(c.store, "SELECT resolved_by FROM upgrades WHERE status = 'cancelled'").resolved_by, "guardian.testnet");
  c.core("upgrade_queued", { code_hash: hex("c"), effective_at: ns(T0 + 1200) });
  c.core("upgraded", { code_hash: hex("c") });
  assert.deepEqual(status(), ["superseded", "cancelled", "applied"]);
  c.core("upgraded", { code_hash: hex("d") });
  assert.equal(rows(c.store, "SELECT * FROM upgrades WHERE code_hash = ?", hex("d")).length, 1, "an unseen queue (indexer started late) still records the applied hash");
  c.core("upgrade_queued", { code_hash: "not-a-hash", effective_at: ns(T0) });
  assert.equal(c.store.badEvents, 1);
});

test("force-resolve: queued, executed against the oldest match, or recorded alone when the queue was missed", () => {
  const c = withLaunches();
  c.core("force_resolve_queued", { launch_id: "2", amount: "100", ok: true, effective_at: ns(T0 + 500) });
  c.core("force_resolve_queued", { launch_id: "2", amount: "100", ok: true, effective_at: ns(T0 + 600) });
  c.core("op_force_resolved", { launch_id: "2", amount: "100", ok: true, evidence: "receipt A" });
  const r = rows(c.store, "SELECT state, evidence FROM force_resolves ORDER BY block_height");
  assert.deepEqual(r.map((x) => x.state), ["executed", "queued"]);
  assert.equal(r[0]?.evidence, "receipt A");
  c.core("op_force_resolved", { launch_id: "1", amount: "7", ok: false, evidence: "late start" });
  const late = one(c.store, "SELECT state, queued_at FROM force_resolves WHERE launch_id = 1");
  assert.deepEqual([late.state, late.queued_at], ["executed", null]);
});

test("solvency_report keeps both legs, a missing intents leg as null, and the alert flag", () => {
  const c = withLaunches();
  c.core("solvency_report", { at: ns(T0), native: { balance: "90", liability: "60", ok: true }, intents: { balance: "5", liability: "9", ok: false }, ok: false, intents_alert: true });
  c.core("solvency_report", { at: ns(T0 + 60), native: { balance: "90", liability: "60", ok: true }, intents: null, ok: true, intents_alert: false });
  const [a, b] = rows(c.store, "SELECT * FROM solvency_reports ORDER BY block_height");
  assert.deepEqual([a?.ok, a?.intents_alert, a?.native_balance, a?.intents_ok, a?.at], [0, 1, "90", 0, T0]);
  assert.deepEqual([b?.ok, b?.intents_balance, b?.intents_ok], [1, null, null]);
});

test("owed balances: core NEAR, market token and launcher token are kept apart; balance is credited minus claimed", () => {
  const c = withLaunches();
  c.core("owed_near_credited", { account: "a.testnet", amount: "500" });
  c.core("owed_near_withdrawn", { account: "a.testnet", amount: "200" });
  c.core("owed_near_credited", { account: "a.testnet", amount: "200" });
  c.push([MARKET, "owed_credited", { account: "a.testnet", token: "usdc.t", amount: "30", reason: "sell_payout" }], [MARKET, "owed_claimed", { account: "a.testnet", token: "usdc.t", amount: "30" }]);
  c.push([LAUNCHER, "owed_credited", { account: "a.testnet", token: "usdc.t", amount: "9", reason: "creator" }]);
  const r = rows(c.store, "SELECT scope, token, credited, claimed FROM owed ORDER BY scope");
  assert.deepEqual(r.map((x) => [x.scope, x.token, x.credited, x.claimed]), [["core", "NEAR", "700", "200"], ["launcher", "usdc.t", "9", "0"], ["market", "usdc.t", "30", "30"]]);
});

test("custody: creator allocation, sweeps, failed legs re-credit, stream lengthening, refund and refusal counters", () => {
  const c = withLaunches();
  const cust = (): Record<string, unknown> => one(c.store, "SELECT * FROM launch_custody WHERE launch_id = 1");
  c.core("creator_alloc_claimed", { launch_id: "1", recipient: "c1.testnet", amount: "400" });
  c.core("creator_alloc_claimed", { launch_id: "1", recipient: "c1.testnet", amount: "70" });
  c.core("payout_resolved", { launch_id: "1", kind: "AllocClaim", amount: "70", ok: false });
  c.core("token_delivery_refused", { launch_id: "1", kind: "AllocClaim", receiver: "c1.testnet", reason: "not registered" });
  assert.deepEqual([cust().alloc_claimed, cust().delivery_refusals], ["400", 1]);
  c.core("tokens_swept", { launch_id: "1", amount: "50", mode: "sink:dead.testnet", payer: "k.testnet" });
  c.core("payout_resolved", { launch_id: "1", kind: "Sweep", amount: "50", ok: false });
  assert.deepEqual([cust().swept, cust().sweep_mode], ["0", "sink:dead.testnet"]);
  c.core("tokens_swept", { launch_id: "1", amount: "20", mode: "hold", payer: "k.testnet" });
  assert.deepEqual([cust().swept, cust().sweep_mode], ["20", "hold"]);
  c.core("stream_lengthened", { launch_id: "1", end_ns: ns(T0 + 99999), unlocked_at_change: "1200" });
  c.core("refund_batch", { launch_id: "1", handled: 3, paid: 2 });
  c.core("refund_batch", { launch_id: "1", handled: 1, paid: 1 });
  c.core("refund_route_set", { launch_id: "1", holder: "near:x.testnet", amount: "5", intents_account: "x.intents" });
  c.core("orphan_credit_refused", { launch_id: "1", holder: "near:x.testnet", nonce_spent: true });
  c.core("deposit_rejected_refundable", { launch_id: "1", holder: "near:x.testnet", code: "R_WINDOW" });
  const k = cust();
  assert.deepEqual([k.stream_end_ns, k.stream_unlocked_at_change, k.stream_lengthened, k.refund_batches, k.refund_handled, k.refund_paid, k.refund_routes, k.orphan_refusals, k.rejected_refundable],
    [ns(T0 + 99999), "1200", 1, 2, 4, 3, 1, 1, 1]);
  c.core("creator_alloc_claimed", { launch_id: "99", recipient: "x", amount: "1" });
  assert.equal(c.store.badEvents, 1, "a launch the indexer never saw is skipped, not invented");
  assert.equal(rows(c.store, "SELECT * FROM launch_custody WHERE launch_id = 99").length, 0);
});

test("genesis: abort keeps the reason, reopen resets the record and counts, F0 messages and attestations accumulate", () => {
  const c = withLaunches();
  const commit = { launch_id: "1", g_pub: hex("1"), mint: hex("2"), merkle_root: hex("3"), genesis_spec_hash: hex("4"), leaf_count: 3, max_total_claim: "60", mode: "F0" };
  const g = (): Record<string, unknown> => one(c.store, "SELECT * FROM genesis WHERE launch_id = 1");
  c.core("genesis_committed", commit);
  c.core("f0_message_registered", { launch_id: "1", tx_index: 1, message_sha256: hex("6") });
  c.core("f0_message_registered", { launch_id: "1", tx_index: 0, message_sha256: hex("5") });
  c.core("f0_message_registered", { launch_id: "1", tx_index: 0, message_sha256: hex("7") });
  c.core("f0_sign_requested", { launch_id: "1", tx_index: 0 });
  c.core("f0_sign_requested", { launch_id: "1", tx_index: 0 });
  c.core("attest_log", { launch_id: "1", attestation_hash: hex("8") });
  assert.deepEqual([g().stage, g().path, g().max_total_claim, g().leaf_count], ["committed", "F0", "60", 3]);
  assert.deepEqual(JSON.parse(String(g().f0_messages)), [{ tx_index: 0, message_sha256: hex("7") }, { tx_index: 1, message_sha256: hex("6") }]);
  assert.deepEqual(JSON.parse(String(g().f0_sign_requests)), [0]);
  assert.deepEqual(JSON.parse(String(g().attestations)), [hex("8")]);
  c.core("genesis_aborted", { launch_id: "1", by: "guardian.testnet", reason: "signer offline" });
  assert.deepEqual([g().stage, g().abort_reason, g().abort_by], ["aborted", "signer offline", "guardian.testnet"]);
  assert.equal(JSON.parse(String(g().f0_messages)).length, 2, "an abort does not erase what was registered");
  c.core("genesis_reopened", { launch_id: "1", by: "owner.testnet" });
  assert.deepEqual([g().stage, g().reopen_count, g().abort_reason, g().path, g().root, g().f0_messages, g().attestations], ["pending", 1, null, null, null, "[]", "[]"]);
  c.core("genesis_committed", commit);
  assert.deepEqual([g().stage, g().reopen_count, g().abort_reason], ["committed", 1, null]);
  c.core("genesis_aborted", { launch_id: "1", by: "owner.testnet", reason: "again" });
  c.core("genesis_reopened", { launch_id: "1", by: "owner.testnet" });
  assert.equal(g().reopen_count, 2);
});

test("pause, freeze, cap, relayer and gate events fold into the operating-state flags", () => {
  const c = withLaunches();
  const flag = (k: string): Record<string, unknown> => JSON.parse(String(one(c.store, "SELECT v FROM flags WHERE k = ?", k).v)) as Record<string, unknown>;
  c.core("frozen", { by: "guardian.testnet", until: ns(T0 + 1000) });
  assert.deepEqual([flag("state:core").state, flag("state:core").until], ["frozen", T0 + 1000]);
  c.core("unpaused", {});
  assert.equal(flag("state:core").state, "live");
  c.core("global_cap_queued", { value: "600", effective_at: ns(T0 + 5000) });
  c.core("global_cap_lowered", { value: "100" });
  assert.deepEqual([flag("cap:global").value, (flag("cap:global").queued as Record<string, unknown>).value], ["100", "600"]);
  c.core("global_cap_applied", { value: "600" });
  assert.deepEqual([flag("cap:global").value, flag("cap:global").queued], ["600", null]);
  c.core("launch_cap_queued", { value: "9", effective_at: ns(T0 + 5000) });
  assert.equal((flag("cap:launch").queued as Record<string, unknown>).value, "9");
  c.core("genesis_paused", { by: "g.testnet" });
  c.core("genesis_relayer_set", { account: "relayer.testnet" });
  c.core("beta_opened", { by: "owner.testnet" });
  c.core("market_set", { market: "m.testnet" });
  assert.deepEqual([flag("state:genesis").paused, flag("genesis_relayer").account, flag("beta:core").by, flag("market_account:core").account], [true, "relayer.testnet", "owner.testnet", "m.testnet"]);
  c.push([LAUNCHER, "paused", { by: "g.testnet" }]);
  assert.equal(flag("state:launcher").state, "paused");
  c.push([MARKET, "market_paused", { paused: true, by: "g.testnet" }]);
  assert.equal(flag("state:market").paused, true);
});

test("book hash fold: the replay equals the logged hash on honest events and flags the first tampered one", () => {
  const honest = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFixtureBlocks(7, 10)) honest.ingestBlock(b, "fixture");
  for (const l of rows(honest, "SELECT * FROM launches WHERE book_events > 0")) {
    assert.equal(l.book_hash_recomputed, l.book_hash, `launch ${String(l.launch_id)}`);
    assert.equal(l.book_mismatch_at, null);
  }
  // independent check of the primitive: a single contribution on an empty book
  const first = bookNext("0".repeat(64), 1, "near:a.testnet", 5n, 5n, 1);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, bookNext("0".repeat(64), 2, "near:a.testnet", 5n, 5n, 1));
  const bad = generateFixtureBlocks(7, 10);
  const isFirstBook = (log: string | undefined): boolean => (log ?? "").includes('"contributed"') && (log ?? "").includes('"launch_id":"1"');
  const target = bad.find((b) => b.shards[0]?.receipt_execution_outcomes?.some((o) => isFirstBook(o.execution_outcome.outcome.logs[0])));
  const out = target?.shards[0]?.receipt_execution_outcomes?.find((o) => isFirstBook(o.execution_outcome.outcome.logs[0]))?.execution_outcome.outcome;
  assert.ok(out);
  out.logs = [out.logs[0]!.replace(/"book_hash":"[0-9a-f]{2}/, '"book_hash":"zz')];
  const tampered = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of bad) tampered.ingestBlock(b, "fixture");
  const l1 = one(tampered, "SELECT * FROM launches WHERE launch_id = 1");
  assert.equal(l1.book_mismatch_at, target?.block.header.height);
});

// --- reorg rollback and idempotent replay, for every new event kind -------------------------------------------------

function eventNames(b: NearBlock): string[] {
  return (b.shards[0]?.receipt_execution_outcomes ?? []).flatMap((o) => o.execution_outcome.outcome.logs.map((l) => (JSON.parse(l.slice("EVENT_JSON:".length)) as { event: string }).event));
}

function build(blocks: NearBlock[]): Store {
  const s = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of blocks) s.ingestBlock(b, "fixture");
  return s;
}

test("the full fixture exercises every event kind this work added", () => {
  const seen = new Set(generateFullFixtureBlocks(7, 10).flatMap(eventNames));
  for (const e of ["halted", "resumed", "upgrade_queued", "upgrade_cancelled", "upgraded", "force_resolve_queued", "op_force_resolved", "solvency_report", "owed_near_credited",
    "owed_near_withdrawn", "creator_alloc_claimed", "tokens_swept", "token_delivery_refused", "stream_lengthened", "refund_batch", "refund_route_set", "orphan_credit_refused",
    "deposit_rejected_refundable", "genesis_reopened", "f0_message_registered", "f0_sign_requested", "attest_log", "genesis_aborted"]) assert.ok(seen.has(e), e);
});

test("reorg: rolling back to just before each new event kind equals a store that never saw it", () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const firstOf = new Map<string, number>();
  blocks.forEach((b, i) => eventNames(b).filter((n) => NEW_KINDS.includes(n)).forEach((n) => firstOf.set(n, firstOf.get(n) ?? i)));
  assert.ok(firstOf.size >= 20);
  const cuts = [...new Set(firstOf.values())];
  for (const i of cuts) {
    const s = build(blocks);
    s.rollbackTo((blocks[i]?.block.header.height ?? 0) - 1);
    assert.equal(s.stateHash(), build(blocks.slice(0, i)).stateHash(), `cut before block index ${i} (${eventNames(blocks[i] as NearBlock).join(",")})`);
    assert.equal(s.checkpoint()?.height, blocks[i - 1]?.block.header.height);
  }
});

test("reorg: replacing the tail with a branch that carries different ops events converges on the branch", () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const keep = blocks.length - 6;
  const branch = structuredClone(blocks.slice(keep));
  let prev = blocks[keep - 1]?.block.header.hash ?? "";
  branch.forEach((b, i) => {
    b.block.header.hash = `alt-${i}`;
    b.block.header.prev_hash = prev;
    prev = `alt-${i}`;
    for (const o of b.shards[0]?.receipt_execution_outcomes ?? []) o.execution_outcome.id += "-alt";
  });
  const s = build(blocks);
  s.rollbackTo((blocks[keep]?.block.header.height ?? 0) - 1);
  for (const b of branch) s.ingestBlock(b, "fixture");
  assert.equal(s.stateHash(), build([...blocks.slice(0, keep), ...branch]).stateHash());
});

test("idempotent replay: re-delivering the ops blocks, a rebuild, and a reversed delivery of the ops tail all give one state hash", () => {
  const blocks = generateFullFixtureBlocks(7, 10);
  const s = build(blocks);
  const want = s.stateHash();
  const events = s.eventCount();
  for (const b of blocks) assert.equal(s.ingestBlock(b, "fixture").inserted, 0);
  assert.equal(s.stateHash(), want);
  assert.equal(s.eventCount(), events);
  s.rebuild();
  assert.equal(s.stateHash(), want);
  const opsStart = blocks.findIndex((b) => eventNames(b).includes("beta_opened") && b.shards[0]?.receipt_execution_outcomes?.[0]?.execution_outcome.outcome.executor_id === CORE);
  const shuffled = [...blocks.slice(0, opsStart), ...blocks.slice(opsStart).reverse()];
  const r = new Store(":memory:", { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of shuffled) r.ingestBlock(b, "fixture");
  assert.equal(r.stateHash(), want);
  assert.equal(r.badEvents, 0);
  assert.equal(s.badEvents, 0);
});

test("a database written by schema 3 is dropped and refolded, keeping its events (new projections appear)", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const path = join(mkdtempSync(join(tmpdir(), "kruxa-schema-")), "i.db");
  const blocks = generateFullFixtureBlocks(7, 10);
  const a = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of blocks) a.ingestBlock(b, "fixture");
  const want = a.stateHash();
  a.db.exec("DELETE FROM meta WHERE k = 'schema_version'; INSERT INTO meta VALUES ('schema_version', '3'); DROP TABLE halts; DROP TABLE owed;");
  a.close();
  const b = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  assert.equal(b.stateHash(), want);
  assert.equal(rows(b, "SELECT * FROM halts").length, 2);
  b.close();
});
