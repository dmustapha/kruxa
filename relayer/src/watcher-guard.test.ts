import { describe, expect, it } from "vitest";
import { watcherSetup, WATCHER_MAINNET_ENV, WATCHER_MAINNET_VALUE } from "./watcher-guard.js";

const MAIN = { WATCHER_CLUSTER: "mainnet-beta", WATCHER_CORE: "core.kruxa.near", [WATCHER_MAINNET_ENV]: WATCHER_MAINNET_VALUE };

describe("watcherSetup, testnet and devnet unchanged", () => {
  it("devnet with a .testnet core is accepted and send follows the flag", () => {
    const env = { WATCHER_CORE: "core7.kxi-root-1108.testnet" };
    expect(watcherSetup(env, [])).toMatchObject({ cluster: "devnet", send: false });
    expect(watcherSetup(env, ["--send"]).send).toBe(true);
    expect(watcherSetup({ ...env, WATCHER_SEND: "1" }, []).send).toBe(true);
    expect(watcherSetup({ ...env, WATCHER_SEND: "1" }, ["--dry-run"]).send).toBe(false);
  });
  it("refuses a non-testnet core, a mainnet RPC and an unknown cluster on the testnet path", () => {
    expect(() => watcherSetup({ WATCHER_CORE: "core.kruxa.near" }, [])).toThrow(/\.testnet/);
    expect(() => watcherSetup({ WATCHER_CORE: "a.testnet", NEAR_TESTNET_RPC: "https://rpc.mainnet.near.org" }, [])).toThrow(/mainnet/);
    expect(() => watcherSetup({ WATCHER_CORE: "a.testnet", WATCHER_CLUSTER: "mainnet" }, [])).toThrow(/WATCHER_CLUSTER/);
  });
});

describe("watcherSetup on mainnet-beta: observe only", () => {
  it("needs its own explicit env", () => {
    expect(() => watcherSetup({ ...MAIN, [WATCHER_MAINNET_ENV]: undefined }, [])).toThrow(WATCHER_MAINNET_ENV);
    expect(() => watcherSetup({ ...MAIN, [WATCHER_MAINNET_ENV]: "1" }, [])).toThrow(WATCHER_MAINNET_ENV);
    expect(() => watcherSetup({ ...MAIN, KRUXA_SOLANA_MAINNET_CONFIRMED: "I_CONFIRM_DAMI_RUNS_THIS", [WATCHER_MAINNET_ENV]: undefined }, [])).toThrow(WATCHER_MAINNET_ENV);
  });
  it("never sends: --send and WATCHER_SEND=1 are refused, even with every other env set", () => {
    expect(() => watcherSetup(MAIN, ["--send"])).toThrow(/never sends on mainnet/);
    expect(() => watcherSetup({ ...MAIN, WATCHER_SEND: "1" }, [])).toThrow(/never sends on mainnet/);
    expect(() => watcherSetup({ ...MAIN, KRUXA_SOLANA_MAINNET_CONFIRMED: "I_CONFIRM_DAMI_RUNS_THIS", KRUXA_SOLANA_DRY_RUN: "0" }, ["--send"])).toThrow(/never sends/);
  });
  it("observes with a mainnet core and a mainnet NEAR RPC, and refuses a testnet core or RPC", () => {
    expect(watcherSetup(MAIN, [])).toEqual({ cluster: "mainnet-beta", core: "core.kruxa.near", nearRpc: "https://rpc.mainnet.near.org", send: false });
    expect(() => watcherSetup({ ...MAIN, WATCHER_CORE: "c.testnet" }, [])).toThrow(/non-\.testnet/);
    expect(() => watcherSetup({ ...MAIN, WATCHER_CORE: "" }, [])).toThrow(/non-\.testnet/);
    expect(() => watcherSetup({ ...MAIN, KRUXA_NEAR_RPC: "https://rpc.testnet.near.org" }, [])).toThrow(/mainnet KRUXA_NEAR_RPC/);
  });
});
