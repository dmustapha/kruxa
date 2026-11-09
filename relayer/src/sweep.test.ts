import { Keypair, Message, SystemInstruction, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { genesisCostLamports, wireTx } from "./ceremony.js";
import { buildSweepMessage, G_BOUND_LAMPORTS, G_DUST_LAMPORTS, SWEEP_FEE_LAMPORTS, sweepAmount } from "./sweep.js";

describe("F1 sweep amount (verify C16 bound = dust + 5,000)", () => {
  it("does nothing when G is already within the bound", () => {
    expect(sweepAmount(0)).toBeNull();
    expect(sweepAmount(G_DUST_LAMPORTS)).toBeNull();
    expect(sweepAmount(G_BOUND_LAMPORTS)).toBeNull();
  });
  it("sweeps everything but its own fee once G is above the bound", () => {
    expect(sweepAmount(G_BOUND_LAMPORTS + 1)).toBe(G_BOUND_LAMPORTS + 1 - SWEEP_FEE_LAMPORTS);
  });
  it("core-driven F1 launch 4 leftover (2,091,800 lamports) is swept to 0 and passes C16", () => {
    const left = 2_091_800;
    const out = sweepAmount(left)!;
    expect(out).toBe(2_086_800);
    expect(left - out - SWEEP_FEE_LAMPORTS).toBe(0);
    expect(left - out - SWEEP_FEE_LAMPORTS).toBeLessThanOrEqual(G_BOUND_LAMPORTS);
  });
  it("a calibrated run (G ends at the dust) needs no sweep", () => {
    expect(sweepAmount(G_DUST_LAMPORTS)).toBeNull();
    expect(genesisCostLamports("devnet", true, 1000)).toBeGreaterThan(G_DUST_LAMPORTS);
  });
});

describe("F1 sweep transaction", () => {
  const g = nacl.sign.keyPair();
  const gPk = Keypair.fromSecretKey(g.secretKey).publicKey;
  const funder = Keypair.generate().publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const msg = buildSweepMessage(gPk, funder, 2_086_800, blockhash);
  it("is one System transfer of the amount from G to the funder, G pays the fee", () => {
    const m = Message.from(msg);
    expect(m.accountKeys[0]!.equals(gPk)).toBe(true);
    expect(m.instructions).toHaveLength(1);
    const ix = m.instructions[0]!;
    const decoded = SystemInstruction.decodeTransfer({
      programId: SystemProgram.programId,
      keys: ix.accounts.map((a) => ({ pubkey: m.accountKeys[a]!, isSigner: false, isWritable: true })),
      data: Buffer.from(bs58.decode(ix.data)),
    });
    expect(decoded.lamports).toBe(2_086_800n);
    expect(decoded.toPubkey.equals(funder)).toBe(true);
    expect(m.recentBlockhash).toBe(blockhash);
  });
  it("is signable by G's key and fits one packet", () => {
    const sig = nacl.sign.detached(msg, g.secretKey);
    expect(nacl.sign.detached.verify(msg, sig, g.publicKey)).toBe(true);
    expect(wireTx(msg, sig).length).toBeLessThanOrEqual(1232);
  });
});
