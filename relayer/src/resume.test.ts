import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileGenesis, decodeSpec, type Params } from "./compile.js";
import type { MintView } from "./mintcheck.js";
import { checkAdoptable, matchCeremonyTxs, programDataDeclaresId, recoverClockTs, type ChainTx } from "./resume.js";
import { b58d, TOKENKEG } from "./solana-bytes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
interface Vector { spec_hex: string; params: { jito_program: string; metadata_uri: string; clock_ts: string }; blockhash: string; price: number }
const vec: Vector = JSON.parse(readFileSync(join(root, "fixtures", "vectors", "genesis-a.json"), "utf8"));
const specBytes = Uint8Array.from(Buffer.from(vec.spec_hex, "hex"));
const spec = decodeSpec(specBytes);
const base = { jitoProgram: b58d(vec.params.jito_program), metadataUri: vec.params.metadata_uri };
const clock = BigInt(vec.params.clock_ts);
const params: Params = { ...base, clockTs: clock };
const bh1 = vec.blockhash;
const bh2 = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const tx1 = compileGenesis(specBytes, params, bh1, vec.price).tx1;
const compiled2 = compileGenesis(specBytes, params, bh2, vec.price);
const fund: ChainTx = { sig: "fundSig", blockhash: bh1, message: new Uint8Array([1, 2, 3]) };
const chain: ChainTx[] = [{ sig: "sealSig", blockhash: bh2, message: compiled2.tx2 }, { sig: "createSig", blockhash: bh1, message: tx1 }, fund];

const goodMint: MintView = { owner: TOKENKEG, space: 82, mintAuthority: null, freezeAuthority: null, supply: spec.supplyTotal, decimals: 6, initialized: true };

describe("resume after reopen_genesis: finding the finished ceremony on chain", () => {
  it("reads the ceremony clock back from the distributor start in tx2", () => {
    expect(recoverClockTs(specBytes, compiled2.tx2)).toBe(clock);
    expect(recoverClockTs(specBytes, tx1)).toBeNull();
  });
  it("matches tx1 and tx2 byte for byte, each with its own blockhash, in any history order", () => {
    const r = matchCeremonyTxs(chain, specBytes, base, vec.price);
    expect(r.sigs).toEqual(["createSig", "sealSig"]);
    expect(r.blockhash).toBe(bh2);
    expect(r.params.clockTs).toBe(clock);
  });
  it("refuses with a clear message when the seal transaction is not in G's history", () => {
    expect(() => matchCeremonyTxs([chain[1]!, fund], specBytes, base, vec.price)).toThrow(/no transaction of G carries the committed distributor/);
  });
  it("refuses when a transaction differs from compile(spec, blockhash, price)", () => {
    const tampered = { ...chain[0]!, message: Uint8Array.from(chain[0]!.message, (b, n) => (n === 40 ? b ^ 1 : b)) };
    expect(() => matchCeremonyTxs([tampered, chain[1]!], specBytes, base, vec.price)).toThrow(/cannot be adopted|cannot adopt/);
  });
  it("refuses when the price differs (different compute budget bytes)", () => {
    expect(() => matchCeremonyTxs(chain, specBytes, base, vec.price + 1)).toThrow(/cannot be adopted/);
  });
});

describe("resume: the existing mint must match the committed spec", () => {
  const compiled = compileGenesis(specBytes, params, bh2, vec.price);
  it("accepts a sealed mint with the committed properties", () => expect(() => checkAdoptable(goodMint, specBytes, compiled)).not.toThrow());
  it("rejects a live mint authority, wrong supply, extensions and wrong owner, naming each", () => {
    const bad: MintView = { ...goodMint, mintAuthority: "someone", supply: 1n, space: 165, owner: "other" };
    expect(() => checkAdoptable(bad, specBytes, compiled)).toThrow(/owner other.*space 165.*mint authority not None.*supply 1/);
  });
});

describe("distributor declared-id preflight (launch 3 aborted with DeclaredProgramIdMismatch)", () => {
  const id = b58d(vec.params.jito_program);
  it("passes when the program data carries its own address", () => {
    expect(programDataDeclaresId(Uint8Array.from([0, 9, ...id, 7, 7]), id)).toBe(true);
  });
  it("fails for a copy deployed at another address with the old id inside", () => {
    expect(programDataDeclaresId(Uint8Array.from([0, 9, ...b58d(TOKENKEG), 7]), id)).toBe(false);
  });
});
