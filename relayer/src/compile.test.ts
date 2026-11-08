import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { compileGenesis, decodeSpec, encodeSpec, hex, type Params } from "./compile.js";
import { buildMerkle, leafHash, verifyProof } from "./merkle.js";
import { b58d } from "./solana-bytes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vecDir = join(root, "fixtures", "vectors");
const names = readdirSync(vecDir).filter((n) => n.startsWith("genesis-") && n.endsWith(".json"));

interface Vector { spec_hex: string; spec_hash: string; params: { jito_program: string; metadata_uri: string; clock_ts: string }; blockhash: string; price: number; expected: Record<string, unknown> }
const load = (n: string): Vector => JSON.parse(readFileSync(join(vecDir, n), "utf8"));
const paramsOf = (v: Vector): Params => ({ jitoProgram: b58d(v.params.jito_program), metadataUri: v.params.metadata_uri, clockTs: BigInt(v.params.clock_ts) });
const run = (v: Vector) => compileGenesis(Uint8Array.from(Buffer.from(v.spec_hex, "hex")), paramsOf(v), v.blockhash, v.price);

describe("TypeScript compiler vs Python reference", () => {
  it("finds the golden vectors", () => expect(names.length).toBeGreaterThanOrEqual(2));
  for (const n of names) {
    it(`${n}: byte-identical to the recorded Python output and the contract's spec hash`, () => {
      const v = load(n);
      const out = run(v);
      expect(hex(out.tx1)).toBe(v.expected["tx1_message"]);
      expect(hex(out.tx2)).toBe(v.expected["tx2_message"]);
      expect(new PublicKey(out.mint).toBase58()).toBe(v.expected["mint"]);
      expect(hex(out.specHash)).toBe(v.spec_hash); // computed by kruxa-logic in Rust
      expect(out.tx1.length + 65).toBeLessThanOrEqual(1232);
      expect(out.tx2.length + 65).toBeLessThanOrEqual(1232);
    });
    it(`${n}: byte-identical to a LIVE Python run`, () => {
      const v = load(n);
      const py = JSON.parse(execFileSync("python3", ["-I", join(root, "tools/genesis/ref/compile.py"), "--vector", join(vecDir, n)], { encoding: "utf8" }));
      const out = run(v);
      expect(hex(out.tx1)).toBe(py.tx1_message);
      expect(hex(out.tx2)).toBe(py.tx2_message);
    });
  }
  it("decodes the spec the contract hashes", () => {
    const s = decodeSpec(Uint8Array.from(Buffer.from(load("genesis-a.json").spec_hex, "hex")));
    expect(s.compilerVersion).toBe("gs-compiler/1.0.0");
    expect(s.buckets.length).toBeGreaterThan(0);
  });
  it("encodeSpec(decodeSpec(x)) round-trips the contract's bytes", () => {
    for (const n of names) {
      const raw = load(n).spec_hex;
      expect(hex(encodeSpec(decodeSpec(Uint8Array.from(Buffer.from(raw, "hex")))))).toBe(raw);
    }
  });
  it("refuses a tampered spec", () => {
    const v = load("genesis-a.json");
    const bad = Uint8Array.from(Buffer.from(v.spec_hex, "hex"));
    bad[bad.length - 1]! ^= 1; // clawback_days
    expect(() => compileGenesis(bad.slice(0, bad.length - 1), paramsOf(v), v.blockhash, v.price)).toThrow();
    expect(() => compileGenesis(Uint8Array.from(Buffer.from(v.spec_hex, "hex")), { ...paramsOf(v), metadataUri: "https://evil.example" }, v.blockhash, v.price)).toThrow(/hash/);
  });
});

describe("Merkle: TypeScript vs Python reference vector", () => {
  const v = JSON.parse(readFileSync(join(vecDir, "merkle-a.json"), "utf8"));
  const leaves = v.leaves.map((l: { claimant: string; unlocked: string; locked: string }) => ({
    claimant: Buffer.from(l.claimant, "hex"), unlocked: BigInt(l.unlocked), locked: BigInt(l.locked),
  }));
  it("root and proofs equal the vector", () => {
    const t = buildMerkle(leaves);
    expect(Buffer.from(t.root).toString("hex")).toBe(v.root);
    expect(t.proofs.map((p) => p.map((h) => Buffer.from(h).toString("hex")))).toEqual(v.proofs);
    t.sorted.forEach((l, i) => expect(verifyProof(t.proofs[i]!, t.root, leafHash(l))).toBe(true));
  });
});
