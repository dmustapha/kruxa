import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { compileGenesis, specFromJson, type GenesisSpecJson } from "./compile.js";
import { buildMerkle, leafHash, verifyProof } from "./merkle.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vecDir = join(root, "fixtures", "vectors");
const names = readdirSync(vecDir).filter((n) => n.startsWith("genesis-") && n.endsWith(".json"));

interface Vector { spec: GenesisSpecJson; blockhash: string; price: number; expected: Record<string, unknown> }
const load = (n: string): Vector => JSON.parse(readFileSync(join(vecDir, n), "utf8"));

describe("TypeScript compiler vs Python reference", () => {
  it("finds the golden vectors", () => expect(names.length).toBeGreaterThanOrEqual(2));
  for (const n of names) {
    it(`${n}: byte-identical to the recorded Python output`, () => {
      const v = load(n);
      const out = compileGenesis(specFromJson(v.spec), v.blockhash, v.price);
      expect(Buffer.from(out.tx1).toString("hex")).toBe(v.expected["tx1_message"]);
      expect(Buffer.from(out.tx2).toString("hex")).toBe(v.expected["tx2_message"]);
      expect(new PublicKey(out.mint).toBase58()).toBe(v.expected["mint"]);
      expect(Buffer.from(out.specHash).toString("hex")).toBe(v.expected["spec_hash"]);
      expect(out.tx1.length + 65).toBeLessThanOrEqual(1232);
      expect(out.tx2.length + 65).toBeLessThanOrEqual(1232);
    });
    it(`${n}: byte-identical to a LIVE Python run`, () => {
      const v = load(n);
      const py = JSON.parse(execFileSync("python3", ["-I", join(root, "tools/genesis/ref/compile.py"), "--vector", join(vecDir, n)], { encoding: "utf8" }));
      const out = compileGenesis(specFromJson(v.spec), v.blockhash, v.price);
      expect(Buffer.from(out.tx1).toString("hex")).toBe(py.tx1_message);
      expect(Buffer.from(out.tx2).toString("hex")).toBe(py.tx2_message);
    });
  }
  it("derived accounts match web3.js PDA derivation", () => {
    const v = load("genesis-a.json");
    const out = compileGenesis(specFromJson(v.spec), v.blockhash, v.price);
    const exp = v.expected["accounts"] as Record<string, string>;
    expect(new PublicKey(out.accounts.vault).toBase58()).toBe(exp["vault"]);
    expect(new PublicKey(out.accounts.distributor).toBase58()).toBe(exp["distributor"]);
    expect(new PublicKey(out.accounts.metadata).toBase58()).toBe(exp["metadata"]);
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
