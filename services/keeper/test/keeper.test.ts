import { describe, expect, it } from "vitest";
import { Alerter } from "../src/alerts.js";
import { isRateLimited, resilient } from "../src/backoff.js";
import { assertNetworkAllowed, loadConfig, MAINNET_CONFIRMATION, type KeeperConfig } from "../src/config.js";
import { dryRun } from "../src/dry-run.js";
import { newKeeper, runCycle, runLoop, type Keeper } from "../src/keeper.js";
import { LaunchLock } from "../src/lock.js";
import { StuckTracker } from "../src/monitor.js";
import type { Ctx } from "../src/launch.js";
import type { Chain } from "../src/types.js";
import { positions, StubCore } from "./stub-core.js";

const baseEnv = { KEEPER_CORE: "core.kruxa.testnet", KEEPER_ACCOUNT_ID: "keeper.kruxa.testnet" };
const cfgOf = (over: Partial<KeeperConfig> = {}): KeeperConfig => ({ ...loadConfig(baseEnv, ["--send"]), solvencyEveryMs: 0, ...over });

interface Rig { core: StubCore; keeper: Keeper; logs: Array<{ level: string; event: string; f?: Record<string, unknown> }>; posts: string[]; clock: { t: number } }

function rig(core: StubCore, over: Partial<KeeperConfig> = {}, chain?: Chain): Rig {
  const logs: Rig["logs"] = [];
  const posts: string[] = [];
  const clock = { t: 1_000_000 };
  const cfg = cfgOf(over);
  const log = (level: string, event: string, f?: Record<string, unknown>) => { logs.push({ level, event, f }); };
  const now = () => clock.t;
  const alerts = new Alerter(log as never, { webhookUrl: "https://hook.example/x", repeatMs: 3_600_000, now, post: async (_u, b) => { posts.push(b); } });
  const ctx: Ctx = { chain: chain ?? core, cfg, log: log as never, alerts, now, quiet: new Set(), finished: new Set() };
  return { core, keeper: newKeeper(ctx, new LaunchLock({ staleMs: 1000, now }), new StuckTracker(now, cfg.stuckAfterMs)), logs, posts, clock };
}

describe("ordering and idempotency", () => {
  it("drives settle, pages, sweep, consolidate (250 Tgas), fee, relay fees in the only order that works", async () => {
    const core = new StubCore();
    core.positions = positions(60);
    const r = rig(core);
    await runCycle(r.keeper);
    expect(core.names().filter((n) => n !== "check_solvency")).toEqual([
      "settle", "settle_positions_page", "settle_positions_page", "settle_positions_page", "sweep_residue", "consolidate", "pay_launch_fee", "pay_relay_fees",
    ]);
    expect(core.calls.find((c) => c.method === "consolidate")!.gas).toBe(250);
  });

  it("is idempotent: a finished launch costs zero calls on later cycles", async () => {
    const core = new StubCore();
    const r = rig(core);
    for (let i = 0; i < 4; i++) await runCycle(r.keeper);
    const before = core.calls.length;
    await runCycle(r.keeper);
    await runCycle(r.keeper);
    expect(core.calls.slice(before).filter((c) => c.method !== "check_solvency")).toEqual([]);
  });

  it("treats R_NOTHING_FREE as success, with no step_failed alert", async () => {
    const core = new StubCore();
    core.status = "Passed"; core.residueSwept = true;
    core.nothingFree = new Set(["consolidate", "pay_launch_fee", "pay_relay_fees"]);
    const r = rig(core);
    const rep = await runCycle(r.keeper);
    expect(rep.launches["1"]).toBe("waiting");
    expect(r.logs.filter((l) => l.event === "alert")).toEqual([]);
    expect(core.names().filter((n) => n.startsWith("pay") || n === "consolidate")).toHaveLength(3);
  });

  it("raises step_failed for any other refusal and keeps going next cycle", async () => {
    const core = new StubCore();
    core.refuse.set("settle", "R_WRONG_PHASE");
    const r = rig(core);
    expect((await runCycle(r.keeper)).launches["1"]).toBe("error");
    expect(r.logs.some((l) => l.event === "alert" && l.f?.kind === "step_failed")).toBe(true);
  });

  it("waits while the walk tail runs", async () => {
    const core = new StubCore();
    core.phase = "WalkTail";
    const r = rig(core);
    expect((await runCycle(r.keeper)).launches["1"]).toBe("waiting");
    expect(core.names()).not.toContain("settle");
  });
});

describe("resume from chain state alone", () => {
  it("restarts paging at the first unsettled seq, not at zero", async () => {
    const core = new StubCore();
    core.status = "Passed";
    core.positions = positions(80);
    for (const p of core.positions.slice(0, 50)) p.settled = true;
    const r = rig(core);
    await runCycle(r.keeper);
    const pages = core.calls.filter((c) => c.method === "settle_positions_page");
    expect(pages[0]!.args.from_seq).toBe(50);
    expect(core.names()).not.toContain("settle");
  });

  it("a fresh keeper (restart) picks up a half-done launch and finishes it", async () => {
    const core = new StubCore();
    core.status = "Passed"; core.residueSwept = true; core.feePaid = 100n;
    const r = rig(core);
    await runCycle(r.keeper);
    expect(core.names()).toContain("pay_relay_fees");
  });
});

describe("FAIL launches", () => {
  it("refunds in batches then dissolves once clear", async () => {
    const core = new StubCore();
    core.status = "Failed(1)";
    core.positions = positions(5, "10").map((p) => ({ ...p, settled: true }));
    const r = rig(core, { refundBatch: 2 });
    await runCycle(r.keeper);
    const batches = core.calls.filter((c) => c.method === "claim_refund_batch");
    expect(batches.map((b) => (b.args.holders as string[]).length)).toEqual([2, 2, 1]);
    expect(batches[0]!.gas).toBe(300);
    expect(core.names().filter((n) => n !== "check_solvency").at(-1)).toBe("dissolve");
  });

  it("does not dissolve while a refund is still inflight", async () => {
    const core = new StubCore();
    core.status = "Failed(1)"; core.inflight = "5";
    const r = rig(core);
    await runCycle(r.keeper);
    expect(core.names()).not.toContain("dissolve");
  });
});

describe("alerts", () => {
  it("alerts on a false invariant (log line plus webhook) and dedupes repeats", async () => {
    const core = new StubCore();
    core.phase = "WalkTail";
    core.invariants = { all_ok: false, intents_alert: false, l1_ok: false, l1_err: "L1 broken", i5_ok: true };
    const r = rig(core);
    await runCycle(r.keeper);
    await runCycle(r.keeper);
    const alerts = r.logs.filter((l) => l.event === "alert" && l.f?.kind === "invariant_false");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.f).toMatchObject({ launch: "1", failed: ["l1"], l1_err: "L1 broken" });
    expect(r.posts).toHaveLength(1);
    expect(JSON.parse(r.posts[0]!)).toMatchObject({ service: "kruxa-keeper", kind: "invariant_false" });
    r.clock.t += 3_700_000;
    await runCycle(r.keeper);
    expect(r.logs.filter((l) => l.event === "alert" && l.f?.kind === "invariant_false")).toHaveLength(2);
  });

  it("alerts on intents_alert from get_invariants and from solvency_report", async () => {
    const core = new StubCore();
    core.status = "Dissolved";
    core.invariants = { all_ok: true, intents_alert: true };
    core.solvency = { counters_ok: true, intents_alert: true, last_check: { ok: false } };
    const r = rig(core);
    await runCycle(r.keeper);
    const kinds = r.logs.filter((l) => l.event === "alert").map((l) => l.f?.kind);
    expect(kinds).toEqual(expect.arrayContaining(["intents_alert", "solvency_false"]));
  });

  it("calls check_solvency at most once per interval", async () => {
    const core = new StubCore();
    core.status = "Dissolved";
    const r = rig(core, { solvencyEveryMs: 600_000 });
    await runCycle(r.keeper);
    await runCycle(r.keeper);
    expect(core.names().filter((n) => n === "check_solvency")).toHaveLength(1);
    r.clock.t += 600_001;
    await runCycle(r.keeper);
    expect(core.names().filter((n) => n === "check_solvency")).toHaveLength(2);
  });

  it("alerts when a leg stays inflight past the threshold, not before", async () => {
    const core = new StubCore();
    core.status = "Failed(1)"; core.inflight = "7";
    const r = rig(core, { stuckAfterMs: 60_000 });
    await runCycle(r.keeper);
    expect(r.logs.some((l) => l.f?.kind === "leg_stuck")).toBe(false);
    r.clock.t += 61_000;
    await runCycle(r.keeper);
    expect(r.logs.find((l) => l.f?.kind === "leg_stuck")!.f).toMatchObject({ leg: "inflight_native", value: "7" });
  });

  it("a failing launch is reported and does not stop the cycle", async () => {
    const core = new StubCore();
    core.launches = 2;
    const real = core.view.bind(core);
    core.view = (async (m: string, a: Record<string, unknown>) => { if (m === "get_invariants" && a.launch_id === "1") throw new Error("boom"); return real(m, a); }) as typeof core.view;
    const r = rig(core);
    const rep = await runCycle(r.keeper);
    expect(rep.launches["1"]).toBe("error");
    expect(rep.launches["2"]).toBeDefined();
  });
});

describe("rate limit and 429 backoff", () => {
  const opts = (sleeps: number[], t = { n: 0 }) => ({ minIntervalMs: 100, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, sleep: async (ms: number) => { sleeps.push(ms); t.n += ms; }, now: () => t.n });

  it("retries a 429 with exponential delay and then succeeds", async () => {
    let n = 0;
    const flaky: Chain = { view: (async () => { if (++n <= 2) throw Object.assign(new Error("HTTP 429 Too Many Requests"), { status: 429 }); return "ok"; }) as Chain["view"], call: async () => ({ ok: true }) };
    const sleeps: number[] = [];
    expect(await resilient(flaky, opts(sleeps)).view("x", {})).toBe("ok");
    expect(sleeps.filter((s) => s >= 1000)).toEqual([1000, 2000]);
  });

  it("gives up after maxRetries and throws", async () => {
    const dead: Chain = { view: (async () => { throw new Error("429"); }) as Chain["view"], call: async () => ({ ok: true }) };
    await expect(resilient(dead, opts([])).view("x", {})).rejects.toThrow("429");
  });

  it("does not retry non-429 errors and spaces requests by the minimum interval", async () => {
    let n = 0;
    const bad: Chain = { view: (async () => { n++; throw new Error("boom"); }) as Chain["view"], call: async () => ({ ok: true }) };
    await expect(resilient(bad, opts([])).view("x", {})).rejects.toThrow("boom");
    expect(n).toBe(1);
    const sleeps: number[] = [];
    const ok: Chain = { view: (async () => 1) as Chain["view"], call: async () => ({ ok: true }) };
    const c = resilient(ok, opts(sleeps));
    await c.view("a", {}); await c.view("b", {});
    expect(sleeps).toEqual([100]);
  });

  it("recognises rate limiting wherever it hides", () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimited({ message: "x", cause: { statusCode: 429 } })).toBe(true);
    expect(isRateLimited(new Error("nope"))).toBe(false);
  });
});

describe("dry-run and network guards", () => {
  it("dry-run is the default and sends nothing", async () => {
    expect(loadConfig(baseEnv, []).dryRun).toBe(true);
    expect(loadConfig(baseEnv, ["--send", "--dry-run"]).dryRun).toBe(true);
    const core = new StubCore();
    core.positions = positions(3);
    const r = rig(core, { dryRun: true }, dryRun(core, () => undefined));
    const rep = await runCycle(r.keeper);
    expect(rep.launches["1"]).toBe("dry");
    expect(core.calls).toEqual([]);
    expect(r.logs.some((l) => l.event === "dry_run_would_send")).toBe(false);
  });

  it("dry-run prints what it would send", async () => {
    const logs: string[] = [];
    const core = new StubCore();
    const chain = dryRun(core, (_l, e) => { logs.push(e); });
    expect(await chain.call("settle", { launch_id: "1" }, 100)).toEqual({ ok: true, dry: true });
    expect(logs).toEqual(["dry_run_would_send"]);
    expect(core.calls).toEqual([]);
  });

  it("refuses mainnet accounts, cores and RPCs", () => {
    for (const over of [{ accountId: "keeper.near" }, { core: "core.near" }, { rpcUrl: "https://rpc.mainnet.near.org" }]) {
      expect(() => assertNetworkAllowed(cfgOf(over))).toThrow(/refusing/);
    }
    expect(() => assertNetworkAllowed(cfgOf())).not.toThrow();
  });

  it("mainnet needs the confirmation AND dry-run off", () => {
    const main = { accountId: "keeper.near", core: "core.near" };
    expect(() => assertNetworkAllowed(cfgOf({ ...main, mainnetConfirmation: MAINNET_CONFIRMATION, dryRun: true }))).toThrow(/refusing/);
    expect(() => assertNetworkAllowed(cfgOf({ ...main, mainnetConfirmation: "yes", dryRun: false }))).toThrow(/refusing/);
    expect(() => assertNetworkAllowed(cfgOf({ ...main, mainnetConfirmation: MAINNET_CONFIRMATION, dryRun: false }))).not.toThrow();
  });
});

describe("lock and loop", () => {
  it("one launch is served by one holder at a time", () => {
    const lock = new LaunchLock({ staleMs: 1000, now: () => 0 });
    const release = lock.tryAcquire("1")!;
    expect(lock.tryAcquire("1")).toBeNull();
    expect(lock.tryAcquire("2")).not.toBeNull();
    release();
    expect(lock.tryAcquire("1")).not.toBeNull();
  });

  it("--once runs exactly one cycle", async () => {
    const core = new StubCore();
    core.status = "Dissolved";
    const r = rig(core);
    await runLoop(r.keeper, { once: true, stop: () => false, sleep: async () => { throw new Error("must not sleep"); } });
    expect(r.logs.filter((l) => l.event === "cycle")).toHaveLength(1);
  });

  it("the loop sleeps the interval between cycles and stops on request", async () => {
    const core = new StubCore();
    core.status = "Dissolved";
    const r = rig(core);
    let slept = 0;
    await runLoop(r.keeper, { once: false, stop: () => slept >= 2, sleep: async () => { slept++; } });
    expect(r.logs.filter((l) => l.event === "cycle")).toHaveLength(2);
  });
});
