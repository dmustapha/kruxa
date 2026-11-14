import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { loadSolanaFunder, validateMainnetArgs, type MainnetArgs } from "./genesis-mainnet.js";
import { JITO_MAINNET } from "./solana-bytes.js";

const ARGS: MainnetArgs = { launch: 1n, mode: "F0", core: "core.kruxa.near", record: "genesis-1.json", holders: 0, expectRefused: false };
const ENV = { KRUXA_METADATA_URI: "https://kruxa.xyz/kruxa.json" };
const refuse = (a: Partial<MainnetArgs>, env: Record<string, string | undefined> = ENV) => () => validateMainnetArgs({ ...ARGS, ...a }, env);

describe("validateMainnetArgs", () => {
  it("accepts the one supported shape and defaults the priority fee to 1000", () => {
    expect(validateMainnetArgs(ARGS, ENV)).toEqual({ core: "core.kruxa.near", record: "genesis-1.json", metadataUri: ENV.KRUXA_METADATA_URI, priceMicroLamports: 1000 });
  });
  it("refuses F1, a testnet core, a missing core, a missing record", () => {
    expect(refuse({ mode: "F1" })).toThrow(/F0 only/);
    expect(refuse({ core: "core7.kxi-root-1108.testnet" })).toThrow(/MAINNET core/);
    expect(refuse({ core: undefined })).toThrow(/MAINNET core/);
    expect(refuse({ record: undefined })).toThrow(/--record/);
  });
  it("refuses every rehearsal flag", () => {
    expect(refuse({ squadsTimeLock: 60 })).toThrow(/create-squads-vault/);
    expect(refuse({ holders: 5 })).toThrow(/rehearsal flags/);
    expect(refuse({ holdersFile: "h.json" })).toThrow(/rehearsal flags/);
    expect(refuse({ expectRefused: true })).toThrow(/rehearsal flags/);
  });
  it("refuses a patched JITO_PROGRAM and any F0 backend override, accepts the real id", () => {
    expect(refuse({}, { ...ENV, JITO_PROGRAM: "SomePatchedCopy1111111111111111111111111111111" })).toThrow(/JITO_PROGRAM/);
    expect(refuse({}, { ...ENV, F0_BACKEND: "sandbox" })).toThrow(/F0_BACKEND/);
    expect(refuse({}, { ...ENV, JITO_PROGRAM: JITO_MAINNET })).not.toThrow();
  });
  it("refuses a missing, rehearsal, non-https or oversize metadata uri", () => {
    for (const uri of [undefined, "", "http://kruxa.xyz/a.json", "https://kruxa.example/rehearsal/1.json", "https://localhost/a.json", `https://k.xyz/${"a".repeat(200)}`]) {
      expect(refuse({}, { KRUXA_METADATA_URI: uri })).toThrow(/KRUXA_METADATA_URI/);
    }
  });
  it("bounds the priority fee", () => {
    for (const p of ["-1", "1.5", "abc", "200001"]) expect(refuse({}, { ...ENV, KRUXA_SOLANA_PRIORITY_MICROLAMPORTS: p })).toThrow(/PRIORITY/);
    expect(validateMainnetArgs(ARGS, { ...ENV, KRUXA_SOLANA_PRIORITY_MICROLAMPORTS: "50000" }).priceMicroLamports).toBe(50_000);
  });
});

describe("loadSolanaFunder", () => {
  const dir = mkdtempSync(join(tmpdir(), "kruxa-funder-"));
  const kp = Keypair.generate();
  const write = (mode: number): string => {
    const f = join(dir, `k${mode}.json`);
    writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)));
    chmodSync(f, mode);
    return f;
  };
  it("loads a mode 600 file outside the repo", () => {
    expect(loadSolanaFunder({ KRUXA_SOLANA_FUNDER_KEY: write(0o600) }).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });
  it("refuses an unset path, a group or world readable file, and a file inside the repo", () => {
    expect(() => loadSolanaFunder({})).toThrow(/not set/);
    expect(() => loadSolanaFunder({ KRUXA_SOLANA_FUNDER_KEY: write(0o644) })).toThrow(/mode 600/);
    expect(() => loadSolanaFunder({ KRUXA_SOLANA_FUNDER_KEY: join(process.cwd(), "package.json") })).toThrow(/outside the repo/);
  });
});
