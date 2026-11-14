import { Keypair, type Connection } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSpecCluster, fundingAmount, runCeremony } from "./ceremony.js";
import type { Spec } from "./compile.js";
import { b58d } from "./solana-bytes.js";
import { DEVNET_GENESIS_HASH, MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE, MAINNET_GENESIS_HASH } from "./cluster.js";
import type { CoreClient } from "./core.js";
import { assertCoreNetwork, F0Signer } from "./f0.js";
import { DryRunStop, type MainnetPlan } from "./mainnet-guard.js";
import type { GenesisSigner } from "./signer.js";
import { JITO_MAINNET } from "./solana-bytes.js";

vi.mock("./mainnet-programs.js", () => ({ assertMainnetPrograms: vi.fn(async () => undefined) }));

const g = Keypair.generate();
const funder = Keypair.generate();
const signer: GenesisSigner = { mode: "F0", pub: () => g.publicKey.toBytes(), sign: async () => new Uint8Array(64), destroy: () => {} };

/** A stubbed connection: no mint exists, the funder holds 1 SOL. Every call is recorded so a test can prove nothing else was touched. */
function rig(hash = MAINNET_GENESIS_HASH) {
  const calls: string[] = [];
  const conn = {
    rpcEndpoint: "https://rpc.example",
    getGenesisHash: async () => hash,
    getAccountInfo: async () => { calls.push("getAccountInfo"); return null; },
    getBalance: async () => 1_000_000_000,
    sendRawTransaction: async () => { calls.push("sendRawTransaction"); return "sig"; },
  } as unknown as Connection;
  const core = {
    label: "stub core", commitGenesis: vi.fn(async () => { calls.push("commitGenesis"); }), specBytes: vi.fn(), specHashOnChain: vi.fn(),
    confirmGenesis: vi.fn(), abortGenesis: vi.fn(),
  } as unknown as CoreClient;
  return { conn, core, calls };
}
const input = (r: ReturnType<typeof rig>, over: object = {}) => ({
  conn: r.conn, cluster: "mainnet-beta" as const, core: r.core, signer, launchId: 1n, funder, priceMicroLamports: 1000, jitoProgram: JITO_MAINNET,
  metadataUri: "https://kruxa.xyz/m.json", log: () => {}, ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("runCeremony on mainnet-beta", () => {
  it("refuses without the confirm env before any other call", async () => {
    const r = rig();
    await expect(runCeremony(input(r, { gate: async () => {} }))).rejects.toThrow(/KRUXA_SOLANA_MAINNET_CONFIRMED/);
    expect(r.calls).toEqual([]);
  });
  it("refuses without a gate, even with the confirm env", async () => {
    vi.stubEnv(MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE);
    const r = rig();
    await expect(runCeremony(input(r))).rejects.toThrow(/confirmation gate/);
    expect(r.core.commitGenesis).not.toHaveBeenCalled();
  });
  it("refuses an RPC that is not mainnet-beta", async () => {
    vi.stubEnv(MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE);
    const r = rig(DEVNET_GENESIS_HASH);
    await expect(runCeremony(input(r, { gate: async () => {} }))).rejects.toThrow(/not Solana mainnet-beta/);
  });
  it("shows the derived mint in the pre-commit plan and, when the gate stops it (dry run), commits and sends nothing", async () => {
    vi.stubEnv(MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE);
    const r = rig();
    const plans: MainnetPlan[] = [];
    const gate = async (p: MainnetPlan) => { plans.push(p); throw new DryRunStop("dry run"); };
    await expect(runCeremony(input(r, { gate }))).rejects.toBeInstanceOf(DryRunStop);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ stage: "pre-commit", gPub: g.publicKey.toBase58(), funder: funder.publicKey.toBase58(), fundLamports: 20_943_000, funderBalance: 1_000_000_000 });
    expect(plans[0]!.mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(r.core.commitGenesis).not.toHaveBeenCalled();
    expect(r.calls).not.toContain("sendRawTransaction");
  });
  it("a refusing gate (cap, typed answer) also stops before commit_genesis", async () => {
    vi.stubEnv(MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE);
    const r = rig();
    await expect(runCeremony(input(r, { gate: async () => { throw new Error("typed confirmation did not match"); } }))).rejects.toThrow(/typed confirmation/);
    expect(r.core.commitGenesis).not.toHaveBeenCalled();
  });
});

describe("F0 on mainnet", () => {
  it("pairs the core account with the NEAR network", () => {
    expect(() => assertCoreNetwork("core.kruxa.near", "mainnet")).not.toThrow();
    expect(() => assertCoreNetwork("core7.kxi-root-1108.testnet", "mainnet")).toThrow(/testnet core on the mainnet path/);
    expect(() => assertCoreNetwork("core.kruxa.near", "testnet")).toThrow(/not a \.testnet/);
    expect(() => assertCoreNetwork("core7.kxi-root-1108.testnet", "testnet")).not.toThrow();
  });
  it("refuses the sandbox and direct backends and a missing core on mainnet", async () => {
    for (const backend of ["sandbox", "direct"]) {
      vi.stubEnv("F0_BACKEND", backend);
      await expect(F0Signer.fromEnv(1n, "core.kruxa.near", "mainnet")).rejects.toThrow(/only the core's gate/);
    }
    vi.unstubAllEnvs();
    await expect(F0Signer.fromEnv(1n, undefined, "mainnet")).rejects.toThrow(/only the core's gate/);
  });
});

describe("assertSpecCluster", () => {
  const spec = (chain: string, hash: string) => ({ chain, clusterGenesisHash: b58d(hash) }) as unknown as Spec;
  it("mainnet-beta needs the solana-mainnet chain AND the mainnet hash (a core on the wrong profile is refused)", () => {
    expect(() => assertSpecCluster("mainnet-beta", spec("solana-mainnet", MAINNET_GENESIS_HASH))).not.toThrow();
    expect(() => assertSpecCluster("mainnet-beta", spec("solana-devnet", DEVNET_GENESIS_HASH))).toThrow(/not mainnet-beta/);
    expect(() => assertSpecCluster("mainnet-beta", spec("solana-mainnet", DEVNET_GENESIS_HASH))).toThrow(/not mainnet-beta/);
    expect(() => assertSpecCluster("mainnet-beta", spec("solana-devnet", MAINNET_GENESIS_HASH))).toThrow(/not mainnet-beta/);
  });
  it("devnet keeps its check and local checks nothing", () => {
    expect(() => assertSpecCluster("devnet", spec("solana-devnet", DEVNET_GENESIS_HASH))).not.toThrow();
    expect(() => assertSpecCluster("devnet", spec("solana-mainnet", MAINNET_GENESIS_HASH))).toThrow(/not devnet/);
    expect(() => assertSpecCluster("local", spec("solana-devnet", DEVNET_GENESIS_HASH))).not.toThrow();
  });
});

describe("fundingAmount (shared by the plan and the send)", () => {
  it("fresh run funds the shortfall; resume with a funded G funds nothing; resume with an empty G funds the full cost", () => {
    expect(fundingAmount(20_943_000, 0, false)).toBe(20_943_000);
    expect(fundingAmount(20_943_000, 1_000_000, false)).toBe(19_943_000);
    expect(fundingAmount(20_943_000, 5_000_000, true)).toBeNull();
    expect(fundingAmount(20_943_000, 10_000, true)).toBe(20_943_000);
  });
});
