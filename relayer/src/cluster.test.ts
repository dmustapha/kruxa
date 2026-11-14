import type { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { assertCluster, DEFAULT_MAINNET_RPC, DEVNET_GENESIS_HASH, expectedSpecCluster, MAINNET_CONFIRM_ENV, MAINNET_CONFIRM_VALUE, MAINNET_GENESIS_HASH, rpcFor } from "./cluster.js";

const stub = (hash: string, rpcEndpoint = "https://rpc.example"): Connection => ({ getGenesisHash: async () => hash, rpcEndpoint }) as unknown as Connection;
const CONFIRMED = { [MAINNET_CONFIRM_ENV]: MAINNET_CONFIRM_VALUE };
const LOCAL_HASH = "LocalHashLocalHashLocalHashLocalHashLocalHash11";

describe("assertCluster mainnet-beta", () => {
  it("accepts only with the confirm env AND the real mainnet-beta genesis hash", async () => {
    await expect(assertCluster(stub(MAINNET_GENESIS_HASH), "mainnet-beta", CONFIRMED)).resolves.toBeUndefined();
  });
  it("refuses without the confirm env, with a wrong value, and with a near-miss value", async () => {
    for (const env of [{}, { [MAINNET_CONFIRM_ENV]: "1" }, { [MAINNET_CONFIRM_ENV]: "i_confirm_dami_runs_this" }]) {
      await expect(assertCluster(stub(MAINNET_GENESIS_HASH), "mainnet-beta", env)).rejects.toThrow(/KRUXA_SOLANA_MAINNET_CONFIRMED/);
    }
  });
  it("refuses when the RPC reports devnet, a local validator, or anything else", async () => {
    for (const h of [DEVNET_GENESIS_HASH, LOCAL_HASH, ""]) {
      await expect(assertCluster(stub(h), "mainnet-beta", CONFIRMED)).rejects.toThrow(/not Solana mainnet-beta/);
    }
  });
  it("checks the genesis hash on every call (a failover to another cluster mid-run is caught)", async () => {
    let hash = MAINNET_GENESIS_HASH;
    const conn = { getGenesisHash: async () => hash, rpcEndpoint: "x" } as unknown as Connection;
    await assertCluster(conn, "mainnet-beta", CONFIRMED);
    hash = DEVNET_GENESIS_HASH;
    await expect(assertCluster(conn, "mainnet-beta", CONFIRMED)).rejects.toThrow(/not Solana mainnet-beta/);
  });
});

describe("devnet and local are unchanged and now also refuse a mainnet RPC", () => {
  it("devnet accepts the devnet hash and refuses others", async () => {
    await expect(assertCluster(stub(DEVNET_GENESIS_HASH), "devnet", {})).resolves.toBeUndefined();
    await expect(assertCluster(stub(LOCAL_HASH), "devnet", {})).rejects.toThrow(/not Solana devnet/);
  });
  it("devnet and local refuse an RPC that reports mainnet-beta, even with the confirm env set", async () => {
    await expect(assertCluster(stub(MAINNET_GENESIS_HASH), "devnet", CONFIRMED)).rejects.toThrow(/reports mainnet-beta/);
    await expect(assertCluster(stub(MAINNET_GENESIS_HASH, "http://127.0.0.1:28899"), "local", CONFIRMED)).rejects.toThrow(/reports mainnet-beta/);
  });
  it("local still needs a localhost RPC and refuses devnet", async () => {
    await expect(assertCluster(stub(LOCAL_HASH, "http://127.0.0.1:28899"), "local", {})).resolves.toBeUndefined();
    await expect(assertCluster(stub(LOCAL_HASH, "https://rpc.example"), "local", {})).rejects.toThrow(/localhost/);
    await expect(assertCluster(stub(DEVNET_GENESIS_HASH, "http://127.0.0.1:28899"), "local", {})).rejects.toThrow(/reports devnet/);
  });
});

describe("cluster constants", () => {
  it("pins the real mainnet-beta genesis hash", () => {
    expect(MAINNET_GENESIS_HASH).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
  });
  it("rpcFor never returns the mainnet URL for devnet or local, and honours SOL_MAINNET_RPC", () => {
    expect(rpcFor("mainnet-beta", {})).toBe(DEFAULT_MAINNET_RPC);
    expect(rpcFor("mainnet-beta", { SOL_MAINNET_RPC: "https://paid.example" })).toBe("https://paid.example");
    expect(rpcFor("devnet", { SOL_MAINNET_RPC: "https://paid.example" })).toBe("https://api.devnet.solana.com");
    expect(rpcFor("local", { SOL_MAINNET_RPC: "https://paid.example" })).toBe("http://127.0.0.1:28899");
  });
  it("expectedSpecCluster ties each cluster to its spec chain and hash", () => {
    expect(expectedSpecCluster("devnet")).toEqual({ chain: "solana-devnet", hash: DEVNET_GENESIS_HASH });
    expect(expectedSpecCluster("mainnet-beta")).toEqual({ chain: "solana-mainnet", hash: MAINNET_GENESIS_HASH });
    expect(expectedSpecCluster("local")).toBeNull();
  });
});
