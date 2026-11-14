import { describe, expect, it } from "vitest";
import type { CoreClient } from "./core.js";
import { newWatcher, phaseOf, ResumingCore, watchOnce, type GenesisView, type WatcherOptions, type WatcherPorts } from "./watcher.js";

interface Launch { status: string; unsettled: number; swept: boolean; holders: number; sol: number; g: GenesisView }
const genesis = (over: Partial<GenesisView> = {}): GenesisView => ({ status: "None", mode: "F1", g_pub: null, root_ready: false, plan: { lp_mirror_to_solana: false }, ...over });
const launch = (over: Partial<Launch> = {}): Launch => ({ status: "Passed", unsettled: 0, swept: true, holders: 2, sol: 1, g: genesis(), ...over });

function rig(launches: Launch[], o: Partial<WatcherOptions> = {}) {
  const events: string[] = [];
  const alerts: string[] = [];
  const ran: string[] = [];
  const aborted: string[] = [];
  let fail: Error | null = null;
  const ports: WatcherPorts = {
    view: (async (m: string, a: Record<string, unknown>) => {
      const l = launches[Number(a.launch_id) - 1];
      if (m === "get_state") return l ? { status: l.status, positions_unsettled: l.unsettled, residue_swept: l.swept, holder_count: l.holders } : null;
      if (m === "get_genesis") return l?.g ?? null;
      if (m === "solana_allocations_page") return Array.from({ length: Number(a.from_seq) === 0 ? l!.sol : 0 });
      throw new Error(`unexpected view ${m}`);
    }) as WatcherPorts["view"],
    runCeremony: async (id) => { ran.push(id.toString()); if (fail) throw fail; launches[Number(id) - 1]!.g = genesis({ status: "Confirmed" }); return { mint: "M", adopted: false, resumed: false }; },
    abortGenesis: async (id) => { aborted.push(id.toString()); },
    recordExists: () => true,
    alert: async (_k, kind) => { alerts.push(kind); },
    log: (_l, e) => { events.push(e); },
  };
  const w = newWatcher(ports, { dryRun: false, all: false, only: new Set(), maxAttempts: 2, autoAbortF1: false, ...o });
  return { w, events, alerts, ran, aborted, setFail: (e: Error | null) => { fail = e; } };
}

describe("watcher phases", () => {
  it("skips launches that are not Passed", async () => {
    const r = rig([launch({ status: "Open" }), launch({ status: "Failed(1)" }), launch({ status: "Dissolved" })]);
    expect(await watchOnce(r.w)).toEqual({ 1: "SKIPPED", 2: "SKIPPED", 3: "SKIPPED" });
    expect(r.ran).toEqual([]);
  });

  it("waits in PASS_SEEN while positions are unsettled or residue is not swept", async () => {
    const r = rig([launch({ unsettled: 3 }), launch({ swept: false })]);
    expect(await watchOnce(r.w)).toEqual({ 1: "PASS_SEEN", 2: "PASS_SEEN" });
    expect(r.ran).toEqual([]);
  });

  it("runs the ceremony once for a ready launch and reaches DONE", async () => {
    const r = rig([launch()]);
    expect(await watchOnce(r.w)).toEqual({ 1: "READY" });
    expect(r.ran).toEqual(["1"]);
    expect(await watchOnce(r.w)).toEqual({ 1: "DONE" });
    expect(r.ran).toEqual(["1"]);
  });

  it("ignores a Passed launch with no Solana plan unless named or --all", async () => {
    const plain = launch({ sol: 0 });
    expect((await phaseOf(rig([plain]).w, "1")).phase).toBe("SKIPPED");
    expect((await phaseOf(rig([plain], { only: new Set(["1"]) }).w, "1")).phase).toBe("READY");
    expect((await phaseOf(rig([plain], { all: true }).w, "1")).phase).toBe("READY");
    expect((await phaseOf(rig([launch({ sol: 0, g: genesis({ mode: "F0" }) })]).w, "1")).phase).toBe("READY");
  });

  it("dry-run never runs, signs or aborts anything", async () => {
    const r = rig([launch(), launch({ g: genesis({ status: "Committed", mode: "F1" }) })], { dryRun: true, autoAbortF1: true });
    await watchOnce(r.w);
    expect(r.ran).toEqual([]);
    expect(r.aborted).toEqual([]);
    expect(r.events).toContain("dry_run_would_run_ceremony");
  });
});

describe("crash, abort and reopen", () => {
  it("resumes a committed F0 genesis through the ceremony", async () => {
    const r = rig([launch({ g: genesis({ status: "Committed", mode: "F0", root_ready: true }) })]);
    expect(await watchOnce(r.w)).toEqual({ 1: "COMMITTED" });
    expect(r.ran).toEqual(["1"]);
  });

  it("raises an alert for a stranded F1 genesis and aborts only when told to", async () => {
    const l = () => launch({ g: genesis({ status: "Committed", mode: "F1" }) });
    const off = rig([l()]);
    await watchOnce(off.w);
    expect(off.alerts).toEqual(["f1_genesis_stranded"]);
    expect(off.ran).toEqual([]);
    expect(off.aborted).toEqual([]);
    const on = rig([l()], { autoAbortF1: true });
    await watchOnce(on.w);
    expect(on.aborted).toEqual(["1"]);
  });

  it("waits on an aborted genesis, then runs again after the owner reopens it", async () => {
    const launches = [launch({ g: genesis({ status: "Aborted", abort_reason: "x" }) })];
    const r = rig(launches);
    expect(await watchOnce(r.w)).toEqual({ 1: "ABORTED" });
    expect(r.ran).toEqual([]);
    launches[0]!.g = genesis({ status: "None" });
    expect(await watchOnce(r.w)).toEqual({ 1: "READY" });
    expect(r.ran).toEqual(["1"]);
    expect(r.events).toContain("genesis_reopened_seen");
  });

  it("stops after maxAttempts and alerts, then gets a fresh budget after a reopen", async () => {
    const launches = [launch()];
    const r = rig(launches);
    r.setFail(new Error("devnet down"));
    await watchOnce(r.w);
    await watchOnce(r.w);
    await watchOnce(r.w);
    expect(r.ran).toEqual(["1", "1"]);
    expect(r.alerts).toEqual(["ceremony_gave_up"]);
    launches[0]!.g = genesis({ status: "Aborted" });
    await watchOnce(r.w);
    launches[0]!.g = genesis({ status: "None" });
    await watchOnce(r.w);
    expect(r.ran).toHaveLength(3);
  });

  it("one failing launch does not stop the others", async () => {
    const launches = [launch(), launch()];
    const r = rig(launches);
    const view = r.w.ports.view;
    r.w.ports.view = (async (m: string, a: Record<string, unknown>) => { if (m === "get_genesis" && a.launch_id === "1") throw new Error("rpc"); return view(m, a); }) as WatcherPorts["view"];
    expect(await watchOnce(r.w)).toEqual({ 1: "ERROR", 2: "READY" });
  });
});

describe("ResumingCore", () => {
  const key = new Uint8Array(32).fill(7);
  const keyHex = Buffer.from(key).toString("hex");
  const inner = () => { const calls: string[] = []; const c = { label: "x", commitGenesis: async () => { calls.push("commit"); }, specBytes: async () => new Uint8Array(), specHashOnChain: async () => "", confirmGenesis: async () => {}, abortGenesis: async () => {} } as CoreClient; return { c, calls }; };

  it("skips commit_genesis (one-shot) when the same key is already committed with a complete root", async () => {
    const { c, calls } = inner();
    await new ResumingCore(c, async () => ({ status: "Committed", g_pub: keyHex, root_ready: true })).commitGenesis(1n, key);
    expect(calls).toEqual([]);
  });

  it("refuses to resume a different key or an incomplete root", async () => {
    const { c } = inner();
    await expect(new ResumingCore(c, async () => ({ status: "Committed", g_pub: "00", root_ready: true })).commitGenesis(1n, key)).rejects.toThrow(/refusing to resume/);
    await expect(new ResumingCore(c, async () => ({ status: "Committed", g_pub: keyHex, root_ready: false })).commitGenesis(1n, key)).rejects.toThrow(/refusing to resume/);
  });

  it("commits normally when nothing is committed yet", async () => {
    const { c, calls } = inner();
    await new ResumingCore(c, async () => ({ status: "None", g_pub: null, root_ready: false })).commitGenesis(1n, key);
    expect(calls).toEqual(["commit"]);
  });
});
