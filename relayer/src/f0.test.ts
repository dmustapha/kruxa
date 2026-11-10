import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { derivedKeyBytes, derivedNearKey } from "./derive.js";
import { contractBackendWith, F0Signer, parseSignature, PolicyMismatch, type SignBackend } from "./f0.js";
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

describe("F0 through the core's contract gate (register_f0_message, sign_genesis)", () => {
  const CORE = "core3.kxi-root-1108.testnet";
  const kp = nacl.sign.keyPair();
  const outcome = { outcome: { gas_burnt: 5_000_000_000_000, tokens_burnt: "500000000000000000000" } };
  /** Fake near-api-js account: records calls; sign_genesis answers like the MPC signer (signature of `kp`, key swapped in below). */
  function fakeAccount(sigShape: "plain" | "nested" | "none" = "plain") {
    const calls: Array<{ contractId: string; methodName: string; args: Record<string, unknown> }> = [];
    return {
      calls,
      async functionCall(a: { contractId: string; methodName: string; args: object; gas: bigint; attachedDeposit: bigint }) {
        calls.push({ contractId: a.contractId, methodName: a.methodName, args: a.args as Record<string, unknown> });
        let status: unknown = { SuccessValue: "" };
        if (a.methodName === "sign_genesis") {
          const msg = Uint8Array.from(Buffer.from((a.args as { message_hex: string }).message_hex, "hex"));
          const sig = Array.from(nacl.sign.detached(msg, kp.secretKey));
          const body = sigShape === "plain" ? { scheme: "Ed25519", signature: sig } : sigShape === "nested" ? { Ed25519: { signature: sig } } : null;
          status = body ? { SuccessValue: Buffer.from(JSON.stringify(body)).toString("base64") } : { Failure: "x" };
        }
        return { status, transaction: { hash: "TX" + calls.length }, transaction_outcome: outcome, receipts_outcome: [outcome] };
      },
    };
  }
  it("derives the key with the CORE as predecessor, not the relayer", async () => {
    const b = contractBackendWith(fakeAccount(), CORE, 7n, SIGNER_ROOT);
    expect(b.derivation).toEqual({ signer_root: SIGNER_ROOT, predecessor: CORE, path: "kruxa:genesis:7" });
    expect(Buffer.from(await b.derivedPub())).toEqual(Buffer.from(derivedKeyBytes(SIGNER_ROOT, CORE, "kruxa:genesis:7")));
    expect(Buffer.from(await b.derivedPub())).not.toEqual(Buffer.from(derivedKeyBytes(SIGNER_ROOT, "relayer.testnet", "kruxa:genesis:7")));
  });
  it("registers the hash for the slot, then signs through sign_genesis, and the signature verifies against the swapped-in key", async () => {
    const acct = fakeAccount();
    const real = contractBackendWith(acct, CORE, 7n, SIGNER_ROOT);
    const backend: SignBackend = { ...real, derivedPub: async () => kp.publicKey }; // the fake signer uses kp, so verify against kp
    const signer = await F0Signer.create(backend);
    const tx1 = new TextEncoder().encode("tx1 message"), tx2 = new TextEncoder().encode("tx2 message");
    await signer.expect([tx1], 0);
    const sig1 = await signer.sign(tx1);
    await signer.expect([tx2], 1);
    await signer.sign(tx2);
    expect(nacl.sign.detached.verify(tx1, sig1, kp.publicKey)).toBe(true);
    expect(acct.calls.map((c) => c.methodName)).toEqual(["register_f0_message", "sign_genesis", "register_f0_message", "sign_genesis"]);
    expect(acct.calls[0]).toEqual({ contractId: CORE, methodName: "register_f0_message", args: { launch_id: "7", tx_index: 0, message_sha256: Buffer.from(sha256(tx1)).toString("hex") } });
    expect(acct.calls[1]!.args).toEqual({ launch_id: "7", tx_index: 0, message_hex: Buffer.from(tx1).toString("hex") });
    expect(acct.calls[3]!.args).toMatchObject({ tx_index: 1 });
    expect(backend.signLog).toHaveLength(2);
  });
  it("never calls sign_genesis for a message that was not registered (local gate first, contract gate second)", async () => {
    const acct = fakeAccount();
    const backend = contractBackendWith(acct, CORE, 7n, SIGNER_ROOT);
    const signer = await F0Signer.create({ ...backend, derivedPub: async () => kp.publicKey });
    const other = new TextEncoder().encode("not registered");
    await expect(signer.sign(other)).rejects.toBeInstanceOf(PolicyMismatch);
    await expect(backend.sign(other)).rejects.toBeInstanceOf(PolicyMismatch);
    expect(acct.calls).toHaveLength(0);
  });
  it("accepts both signer response shapes and rejects a failed sign_genesis", () => {
    const sig = Array.from({ length: 64 }, (_, n) => n);
    expect(parseSignature(JSON.stringify({ signature: sig }))).toHaveLength(64);
    expect(parseSignature(JSON.stringify({ Ed25519: { signature: sig } }))).toHaveLength(64);
    expect(() => parseSignature(JSON.stringify({ signature: [1, 2] }))).toThrow(/unexpected signature shape/);
  });
  it("surfaces a sign_genesis that failed at the signer instead of inventing a signature", async () => {
    const backend = contractBackendWith(fakeAccount("none"), CORE, 7n, SIGNER_ROOT);
    const m = new TextEncoder().encode("m");
    await backend.register!(m, 0);
    await expect(backend.sign(m)).rejects.toThrow(/sign_genesis failed/);
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
