import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { assertNetworkAllowed } from "../src/network.js";

const base = { network: "mainnet", mainnetIKnow: true, env: { DAMI_PER_ACTION_CONFIRMED: "1" } } as const;

describe("mainnet guard", () => {
  it("allows devnet and localnet without flags", () => {
    expect(() => assertNetworkAllowed({ network: "devnet", mainnetIKnow: false, env: {} })).not.toThrow();
    expect(() => assertNetworkAllowed({ network: "localnet", mainnetIKnow: false, env: {} })).not.toThrow();
  });
  it("refuses mainnet with only the flag", () => {
    expect(() => assertNetworkAllowed({ ...base, env: {} })).toThrow(/refused/);
  });
  it("refuses mainnet with only the env", () => {
    expect(() => assertNetworkAllowed({ ...base, mainnetIKnow: false })).toThrow(/refused/);
  });
  it("refuses empty, 0 and false env values", () => {
    for (const v of ["", "0", "false"]) {
      expect(() => assertNetworkAllowed({ ...base, env: { DAMI_PER_ACTION_CONFIRMED: v } })).toThrow(/refused/);
    }
  });
  it("accepts mainnet with both", () => {
    expect(() => assertNetworkAllowed(base)).not.toThrow();
  });
});

describe("cli mainnet refusal", () => {
  it("exits non-zero before any RPC call when mainnet lacks confirmation", () => {
    const r = spawnSync("node", ["bin/kruxa-venue.mjs", "build-pool-proposal", "--network", "mainnet", "--json"], {
      env: { ...process.env, DAMI_PER_ACTION_CONFIRMED: "" }, encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refused: mainnet/);
  });
});
