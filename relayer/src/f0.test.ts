import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { derivedNearKey } from "./derive.js";
import { F0Signer, PolicyMismatch, type SignBackend } from "./f0.js";
import { sha256 } from "./solana-bytes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIGNER_ROOT = "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2"; // v1.signer-prod.testnet domain 1, read 2026-11-08

describe("F0 derivation", () => {
  it("TypeScript derivation equals the Python derivation byte for byte", () => {
    for (const [pred, path] of [["a.testnet", "kruxa:genesis:1"], ["core.kruxa.testnet", "kruxa:genesis:3"]] as const) {
      const py = execFileSync("python3", ["-I", join(root, "tools/genesis/f0_derive.py"), "--signer-pubkey", SIGNER_ROOT, "--predecessor", pred, "--path", path], { encoding: "utf8" }).trim();
      expect(derivedNearKey(SIGNER_ROOT, pred, path)).toBe(py);
    }
  });
  it("matches the value read from the live testnet signer view (2026-11-08)", () => {
    expect(derivedNearKey(SIGNER_ROOT, "kruxa-f0-rehearsal.testnet", "kruxa:genesis:3")).toBe("ed25519:wy5ydszWBk7N6MrVwaaqhbQsWW5M7piYWdvPMztg55R");
  });
});

describe("F0 policy gate (SANDBOX backend)", () => {
  const kp = nacl.sign.keyPair();
  const backend: SignBackend = { label: "SANDBOX", derivedPub: async () => kp.publicKey, sign: async (m) => nacl.sign.detached(m, kp.secretKey) };
  it("signs only a message whose sha256 was registered", async () => {
    const signer = await F0Signer.create(backend);
    const m = new TextEncoder().encode("tx1");
    await expect(signer.sign(m)).rejects.toBeInstanceOf(PolicyMismatch);
    signer.expect([m]);
    const sig = await signer.sign(m);
    expect(nacl.sign.detached.verify(m, sig, kp.publicKey)).toBe(true);
    await expect(signer.sign(new TextEncoder().encode("tx2"))).rejects.toBeInstanceOf(PolicyMismatch);
  });
  it("rejects a backend signature that does not verify against the derived key", async () => {
    const bad = await F0Signer.create({ ...backend, sign: async () => new Uint8Array(64) });
    const m = new TextEncoder().encode("x");
    bad.expect([m]);
    await expect(bad.sign(m)).rejects.toThrow(/does not verify/);
    expect(sha256(m).length).toBe(32);
  });
});
