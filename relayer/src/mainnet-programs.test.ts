import { createHash } from "node:crypto";
import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SPACE, assertMainnetPrograms, assertRentCalibration, checkPinned, nonFeeFromRent, PINNED_PROGRAMS, programDataFacts } from "./mainnet-programs.js";
import { JITO_MAINNET, METAPLEX } from "./solana-bytes.js";

function programData(elf: Uint8Array, authority: Uint8Array | null): Uint8Array {
  const h = Buffer.alloc(45);
  h.writeUInt32LE(3, 0);
  h.writeBigUInt64LE(234_207_504n, 4);
  if (authority) { h[12] = 1; Buffer.from(authority).copy(h, 13); }
  return Buffer.concat([h, elf]);
}

describe("programDataFacts", () => {
  it("reads an immutable program: no authority, hash of the bytes after the 45 byte header", () => {
    const elf = Buffer.from("elf bytes");
    expect(programDataFacts(programData(elf, null))).toEqual({ authority: null, sha256: createHash("sha256").update(elf).digest("hex") });
  });
  it("reads an upgrade authority", () => {
    const auth = Keypair.generate().publicKey;
    expect(programDataFacts(programData(Buffer.from("x"), auth.toBytes())).authority).toBe(auth.toBase58());
  });
  it("refuses an account that is not a ProgramData", () => {
    expect(() => programDataFacts(new Uint8Array(100))).toThrow(/ProgramData/);
    expect(() => programDataFacts(new Uint8Array(10))).toThrow(/ProgramData/);
  });
});

describe("checkPinned", () => {
  const good = (id: string) => ({ authority: null, sha256: PINNED_PROGRAMS[id]!.sha256 });
  it("passes the pinned immutable binaries", () => {
    expect(checkPinned(JITO_MAINNET, good(JITO_MAINNET))).toEqual([]);
    expect(checkPinned(METAPLEX, good(METAPLEX))).toEqual([]);
  });
  it("refuses an upgradeable program and a different binary", () => {
    expect(checkPinned(JITO_MAINNET, { ...good(JITO_MAINNET), authority: "Someone" }).join()).toMatch(/upgradeable by Someone/);
    expect(checkPinned(METAPLEX, { authority: null, sha256: "00" }).join()).toMatch(/not the pinned/);
  });
  it("refuses a program that is not pinned", () => {
    expect(checkPinned(Keypair.generate().publicKey.toBase58(), good(JITO_MAINNET)).join()).toMatch(/not a pinned program/);
  });
});

describe("assertMainnetPrograms", () => {
  it("refuses a patched copy at our own program id (the devnet rehearsal setup) before any RPC call", async () => {
    const conn = { getAccountInfo: async () => { throw new Error("must not be called"); } } as unknown as Connection;
    await expect(assertMainnetPrograms(conn, Keypair.generate().publicKey.toBase58())).rejects.toThrow(/real Jito distributor/);
  });
  it("refuses when the program is missing on the cluster", async () => {
    const conn = { getAccountInfo: async () => null } as unknown as Connection;
    await expect(assertMainnetPrograms(conn, JITO_MAINNET)).rejects.toThrow(/not an executable upgradeable-loader program/);
  });
});

describe("rent calibration (mainnet-beta, 5,080 lamports per byte, measured 2026-11-14)", () => {
  const perByte = 5080;
  const live = { tokenAccount: (165 + 128) * perByte, metadata: (607 + 128) * perByte, distributor: (240 + 128) * perByte };
  const conn = (rate: number) => ({ getMinimumBalanceForRentExemption: async (n: number) => (n + 128) * rate }) as unknown as Connection;
  it("reproduces the simulated and devnet-measured figures", () => {
    expect(live).toEqual({ tokenAccount: 1_488_440, metadata: 3_733_800, distributor: 1_869_440 });
    expect(nonFeeFromRent(live, false)).toBe(16_683_840);
    expect(nonFeeFromRent(live, true)).toBe(20_041_720);
  });
  it("accepts the calibrated figure and refuses when rent moves either way", async () => {
    await expect(assertRentCalibration(conn(perByte), true, 20_041_720)).resolves.toBe(20_041_720);
    await expect(assertRentCalibration(conn(perByte), false, 16_683_840)).resolves.toBe(16_683_840);
    await expect(assertRentCalibration(conn(6960), true, 20_041_720)).rejects.toThrow(/live rent gives/);
    await expect(assertRentCalibration(conn(4000), true, 20_041_720)).rejects.toThrow(/re-measure/);
  });
  it("account sizes are the ones measured", () => {
    expect(ACCOUNT_SPACE).toEqual({ tokenAccount: 165, metadata: 607, distributor: 240 });
  });
});
