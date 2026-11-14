import { describe, expect, it } from "vitest";
import { MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE } from "./cluster.js";
import { genesisCostLamports } from "./ceremony.js";
import {
  assertCanSend, assertWithinCap, DryRunStop, FUND_TX_FEE_LAMPORTS, makeGate, MainnetRefusal, MAX_SPEND_CAP_LAMPORTS, planCode, readSettings, renderPlan,
  solToLamports, totalSpend, type MainnetPlan,
} from "./mainnet-guard.js";

const CONFIRMED = { [MAINNET_CONFIRM_ENV]: MAINNET_CONFIRM_VALUE };
const LIVE = { ...CONFIRMED, KRUXA_SOLANA_DRY_RUN: "0", KRUXA_SOLANA_SPEND_CAP_SOL: "0.03" };
const plan = (over: Partial<MainnetPlan> = {}): MainnetPlan => ({
  stage: "pre-send", cluster: "mainnet-beta", launchId: "1", core: "core.kruxa.near", signerMode: "F0", gPub: "G", mint: "MINT", funder: "FUNDER", funderBalance: 100_000_000,
  fundLamports: 20_943_000, priceMicroLamports: 1000, jitoProgram: "mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv", metadataUri: "https://kruxa.xyz/m.json", capLamports: null, ...over,
});
const gateFor = (env: Record<string, string>, answer: string) => {
  const out: string[] = [];
  return { out, gate: makeGate(readSettings(env), env, async () => answer, (l) => out.push(l)) };
};

describe("readSettings", () => {
  it("defaults to dry run with no cap", () => {
    expect(readSettings({})).toEqual({ dryRun: true, capLamports: null });
  });
  it("dry run is off only for exactly 0", () => {
    expect(readSettings({ KRUXA_SOLANA_DRY_RUN: "0" }).dryRun).toBe(false);
    expect(readSettings({ KRUXA_SOLANA_DRY_RUN: "1" }).dryRun).toBe(true);
    for (const v of ["false", "no", "off", "", "00", "true"]) expect(() => readSettings({ KRUXA_SOLANA_DRY_RUN: v })).toThrow(MainnetRefusal);
  });
  it("parses the cap in SOL to lamports without float error", () => {
    expect(readSettings({ KRUXA_SOLANA_SPEND_CAP_SOL: "0.03" }).capLamports).toBe(30_000_000);
    expect(readSettings({ KRUXA_SOLANA_SPEND_CAP_SOL: "0.021" }).capLamports).toBe(21_000_000);
    expect(solToLamports("0.000000001")).toBe(1);
  });
  it("refuses a malformed, zero, negative or typo-sized cap", () => {
    for (const v of ["abc", "-1", "0", "0.0", "1e-2", "0.0000000001", "0.51", "100"]) expect(() => readSettings({ KRUXA_SOLANA_SPEND_CAP_SOL: v })).toThrow(MainnetRefusal);
    expect(readSettings({ KRUXA_SOLANA_SPEND_CAP_SOL: "0.5" }).capLamports).toBe(MAX_SPEND_CAP_LAMPORTS);
  });
});

describe("assertCanSend and cap", () => {
  it("refuses without the confirm env, in dry run, and without a cap", () => {
    expect(() => assertCanSend(readSettings(LIVE), {})).toThrow(/KRUXA_SOLANA_MAINNET_CONFIRMED/);
    expect(() => assertCanSend(readSettings({ ...CONFIRMED, KRUXA_SOLANA_SPEND_CAP_SOL: "0.03" }), CONFIRMED)).toThrow(/dry run is ON/);
    expect(() => assertCanSend(readSettings({ ...CONFIRMED, KRUXA_SOLANA_DRY_RUN: "0" }), CONFIRMED)).toThrow(/no spend cap/);
    expect(assertCanSend(readSettings(LIVE), LIVE)).toBe(30_000_000);
  });
  it("refuses a spend over the cap and accepts one equal to it", () => {
    expect(() => assertWithinCap(30_000_001, 30_000_000)).toThrow(/over the cap/);
    expect(() => assertWithinCap(30_000_000, 30_000_000)).not.toThrow();
  });
});

describe("the gate", () => {
  it("dry run prints the plan and stops with DryRunStop, never asking", async () => {
    let asked = false;
    const out: string[] = [];
    const gate = makeGate(readSettings(CONFIRMED), CONFIRMED, async () => { asked = true; return ""; }, (l) => out.push(l));
    await expect(gate(plan())).rejects.toBeInstanceOf(DryRunStop);
    expect(asked).toBe(false);
    expect(out.join("\n")).toContain("MINT");
    expect(out.join("\n")).toContain("0.020943000 SOL");
  });
  it("a live run with the right typed code passes; the code is bound to the plan", async () => {
    const p = plan();
    const code = planCode({ ...p, capLamports: 30_000_000 });
    await expect(gateFor(LIVE, `MINT ${code}`).gate(p)).resolves.toBeUndefined();
    expect(planCode({ ...p, capLamports: 30_000_000, mint: "OTHER" })).not.toBe(code);
    expect(planCode({ ...p, capLamports: 30_000_000, stage: "pre-commit" })).not.toBe(code);
  });
  it("refuses a wrong, empty, lowercase or yes answer", async () => {
    const code = planCode({ ...plan(), capLamports: 30_000_000 });
    for (const a of ["", "yes", "y", "MINT", `mint ${code.toLowerCase()}`, `MINT ${code}X`, "MINT 00000000"]) {
      await expect(gateFor(LIVE, a).gate(plan())).rejects.toThrow(/typed confirmation did not match/);
    }
  });
  it("refuses over the cap, an underfunded funder, a missing cap, and a missing confirm env, all before asking", async () => {
    let asked = 0;
    const ask = async () => { asked++; return ""; };
    const run = (env: Record<string, string>, p: MainnetPlan) => makeGate(readSettings(env), env, ask, () => {})(p);
    await expect(run(LIVE, plan({ fundLamports: 30_000_000 }))).rejects.toThrow(/over the cap/);
    await expect(run(LIVE, plan({ funderBalance: 1_000 }))).rejects.toThrow(/funder holds/);
    await expect(run({ ...CONFIRMED, KRUXA_SOLANA_DRY_RUN: "0" }, plan())).rejects.toThrow(/no spend cap/);
    await expect(run({ KRUXA_SOLANA_DRY_RUN: "0", KRUXA_SOLANA_SPEND_CAP_SOL: "0.03" }, plan())).rejects.toThrow(/KRUXA_SOLANA_MAINNET_CONFIRMED/);
    expect(asked).toBe(0);
  });
  it("names the cluster in the plan header", () => {
    expect(renderPlan(plan({ cluster: "local" }))[0]).toContain("SOLANA LOCAL GENESIS PLAN");
    expect(renderPlan(plan())[0]).toContain("SOLANA MAINNET-BETA GENESIS PLAN (pre-send)");
  });
  it("prints the cap and the derived mint in the plan", () => {
    const text = renderPlan({ ...plan(), capLamports: 30_000_000 }).join("\n");
    expect(text).toContain("mint (derived, createWithSeed): MINT");
    expect(text).toContain("0.030000000 SOL");
  });
});

describe("cost computation", () => {
  it("mainnet-beta: dust + measured rent + two base fees + priority fees", () => {
    expect(genesisCostLamports("mainnet-beta", true, 1000)).toBe(890_880 + 20_041_720 + 10_000 + 150 + 250);
    expect(genesisCostLamports("mainnet-beta", false, 1000)).toBe(890_880 + 16_683_840 + 10_000 + 150 + 250);
  });
  it("mainnet-beta equals the devnet figures it was measured against, and devnet is unchanged", () => {
    expect(genesisCostLamports("mainnet-beta", true, 1000)).toBe(genesisCostLamports("devnet", true, 1000));
    expect(genesisCostLamports("devnet", true, 1000)).toBe(20_943_000);
    expect(genesisCostLamports("local", true, 1000)).toBe(890_880 + 23_217_040 + 10_000 + 400);
  });
  it("priority fee scales with price at 150k + 250k compute units, and one genesis stays far under the largest allowed cap", () => {
    expect(genesisCostLamports("mainnet-beta", true, 200_000) - genesisCostLamports("mainnet-beta", true, 0)).toBe(80_000);
    expect(genesisCostLamports("mainnet-beta", true, 200_000) + FUND_TX_FEE_LAMPORTS).toBeLessThan(MAX_SPEND_CAP_LAMPORTS);
    expect(totalSpend({ fundLamports: 1 })).toBe(1 + FUND_TX_FEE_LAMPORTS);
  });
});
