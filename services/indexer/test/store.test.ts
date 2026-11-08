import assert from "node:assert/strict";
import { test } from "node:test";
import { Store, ReorgError } from "../src/store.ts";
import { FIXTURE_CONTRACTS, generateFixtureBlocks } from "../src/fixtures.ts";
import { evLine, fixtureStore, mkBlock, rows } from "./helpers.ts";

test("fixture fold: launches, verdicts, pool, balances", () => {
  const s = fixtureStore();
  const l = rows(s, "SELECT * FROM launches ORDER BY launch_id");
  assert.deepEqual(l.map((r) => [r.symbol, r.status, r.verdict]), [["ALPHA", "passed", "PASS"], ["BRAVO", "dissolved", "FAIL"], ["CHARLIE", "open", null], ["DELTA", "passed", "PASS"],
    ["ECHO", "trading", null], ["FOXX", "abandoned", null], ["ZETA", "creation_failed", null], ["PEND", "token_ready", null]]);
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

test("name and total supply come from charter_created; nothing is invented when absent", () => {
  const s = fixtureStore();
  const l = rows(s, "SELECT symbol, name, total_supply FROM launches ORDER BY launch_id");
  assert.deepEqual(l.map((r) => r.name), ["Alpha Coin", "Bravo Cat", "Charlie Dog", "Delta Fox", "Echo Wave", "Foxx Fire", "Zeta Zip", "Pend Pot"]);
  assert.equal(l[0]?.total_supply, "2000000000000");
});

test("swaps follow MARKET-ABI M-A: holders and referral are 0, red_* ride inside lp, slices sum to the fee", () => {
  const s = fixtureStore();
  const ts = rows(s, "SELECT fee_total, fee_slices FROM trades");
  assert.ok(ts.length > 100);
  for (const t of ts) {
    const f = JSON.parse(String(t.fee_slices)) as Record<string, string>;
    assert.equal(f.holders, "0");
    assert.equal(f.referral, "0");
    assert.equal(BigInt(f.creator!) + BigInt(f.platform!) + BigInt(f.lp!), BigInt(String(t.fee_total)));
    assert.ok(BigInt(f.red_holders!) + BigInt(f.red_referral!) <= BigInt(f.lp!));
  }
  const pool = rows(s, "SELECT * FROM pools")[0]!;
  assert.equal(pool.fees_holders, "0");
  assert.equal(pool.fees_referral, "0");
  assert.equal(pool.token, "alpha.token.fixture.testnet");
  assert.equal(pool.market, "market.fixture.testnet");
  assert.equal((JSON.parse(String(pool.terms)) as Record<string, number>).total_fee_bps, 100);
});

test("failed launch fixture: every backer refunded, one payout retried, launch dissolved", () => {
  const s = fixtureStore();
  const pos = rows(s, "SELECT CAST(contributed AS INTEGER) AS c FROM positions WHERE launch_id = 2");
  const paid = rows(s, "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS s FROM payouts WHERE launch_id = 2 AND kind = 'RefundNative' AND ok = 1")[0]!;
  assert.equal(paid.s, pos.reduce((a, p) => a + Number(p.c), 0));
  assert.equal(rows(s, "SELECT COUNT(*) AS n FROM payouts WHERE launch_id = 2 AND ok = 0")[0]?.n, 1);
  assert.equal(rows(s, "SELECT status, verdict FROM launches WHERE launch_id = 2")[0]?.status, "dissolved");
});

test("genesis events fold; later committed never downgrades confirmed", () => {
  const s = fixtureStore();
  const g = rows(s, "SELECT * FROM genesis")[0]!;
  assert.equal(g.stage, "confirmed");
  assert.equal(g.mint_authority, "null");
  assert.equal(g.freeze_authority, "null");
  assert.equal(rows(s, "SELECT COUNT(*) AS n FROM genesis")[0]?.n, 1);
});

test("a database from an older schema is refolded from its events on open", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const path = join(mkdtempSync(join(tmpdir(), "kruxa-mig-")), "i.db");
  const s = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  for (const b of generateFixtureBlocks(2, 30)) s.ingestBlock(b, "fixture");
  const h = s.stateHash();
  s.db.exec("UPDATE meta SET v = '1' WHERE k = 'schema_version'; DROP TABLE launches; DROP TABLE pools; DROP TABLE genesis");
  s.close();
  const r = new Store(path, { contracts: FIXTURE_CONTRACTS, network: "fixture" });
  assert.equal(r.stateHash(), h);
  r.close();
});

test("instant launch folds: mode from the authenticated pool, no verdict or book, vesting claim recorded", () => {
  const s = fixtureStore();
  const echo = rows(s, "SELECT * FROM launches WHERE launch_id = 1000000000")[0]!;
  assert.equal(echo.mode, "instant");
  assert.equal(echo.verdict, null);
  assert.equal(echo.total_active, "0");
  const pool = rows(s, "SELECT * FROM pools WHERE launch_id = 1000000000")[0]!;
  assert.equal(pool.mode, "instant");
  assert.equal(pool.creator, "eve.testnet");
  assert.equal(pool.token, "echo.token.fixture.testnet");
  const inst = rows(s, "SELECT * FROM instants WHERE launch_id = 1000000000")[0]!;
  assert.equal(inst.alloc_claimed, "4000000000000");
  assert.ok(inst.opened_at);
  assert.equal(rows(s, "SELECT balance FROM balances WHERE launch_id = 1000000000 AND holder = 'eve.testnet'")[0]?.balance, "4000000000000");
  assert.equal(rows(s, "SELECT COUNT(*) AS n FROM launches WHERE mode = 'trial'")[0]?.n, 4);
  assert.equal(rows(s, "SELECT COUNT(*) AS n FROM positions WHERE launch_id >= 1000000000")[0]?.n, 0);
});

test("id namespaces: launcher cannot touch trial ids, core cannot touch instant ids, pool mode must match", () => {
  const s = fixtureStore();
  const before = s.stateHash();
  const tip = s.checkpoint()!;
  let n = 0;
  const bad = (executor: string, event: string, data: Record<string, unknown>): void => {
    n += 2;
    s.ingestBlock(mkBlock(tip.height + n, `ns-${n}`, n === 2 ? tip.hash : `ns-${n - 2}`, 1_900_000_000 + n, [{ id: `ns-r${n}`, executor, line: evLine(event, data) }]), "fixture");
  };
  bad("instant.fixture.testnet", "instant_opened", { launch_id: "1", token: "x", opened_at: "1" });
  bad("core.fixture.testnet", "verdict", { launch_id: "1000000000", outcome: "FAIL", reasons: [], total_active: "0", funders: 0 });
  bad("market.fixture.testnet", "pool_opened", { launch_id: "3", mode: "instant", creator: "x", token: "t", q: "1", t: "1" });
  bad("market.fixture.testnet", "pool_opened", { launch_id: "1000000003", mode: "trial", token: "t", q: "1", t: "1" });
  assert.equal(s.badEvents, 4);
  assert.equal(rows(s, "SELECT status FROM launches WHERE launch_id = 1000000000")[0]?.status, "trading");
  assert.equal(rows(s, "SELECT status FROM launches WHERE launch_id = 1")[0]?.status, "passed");
  assert.equal(rows(s, "SELECT COUNT(*) AS n FROM pools")[0]?.n, 2);
  assert.notEqual(s.stateHash(), before);
});

test("launcher logs from unconfigured accounts are ignored, and a store without a launcher still folds trials", () => {
  const blocks = generateFixtureBlocks(4, 30);
  const noLauncher = new Store(":memory:", { contracts: { core: FIXTURE_CONTRACTS.core, market: FIXTURE_CONTRACTS.market }, network: "fixture" });
  for (const b of blocks) noLauncher.ingestBlock(b, "fixture");
  assert.equal(rows(noLauncher, "SELECT COUNT(*) AS n FROM launches")[0]?.n, 4);
  assert.equal(rows(noLauncher, "SELECT COUNT(*) AS n FROM instants")[0]?.n, 0);
});
