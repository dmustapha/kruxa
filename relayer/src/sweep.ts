import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

/** A system account may not end a transaction with 0 < lamports < rent-exempt minimum, so a calibrated G keeps exactly this (disclosed dust). */
export const G_DUST_LAMPORTS = 890_880;
/** verify C16 accepts any G balance up to the dust plus one transaction fee. */
export const G_BOUND_LAMPORTS = G_DUST_LAMPORTS + 5_000;
export const SWEEP_FEE_LAMPORTS = 5_000;

/** Lamports the G-signed sweep must send out, or null when G is already within the C16 bound. The sweep empties G (it pays its own
 *  fee from the balance), so G ends at 0, which a system account may do. */
export function sweepAmount(balance: number): number | null {
  if (balance <= G_BOUND_LAMPORTS) return null;
  return balance - SWEEP_FEE_LAMPORTS;
}

/** Legacy message of the single System transfer G signs: G pays the fee, the funder receives everything. */
export function buildSweepMessage(g: PublicKey, to: PublicKey, lamports: number, blockhash: string): Uint8Array {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: g, toPubkey: to, lamports }));
  tx.feePayer = g;
  tx.recentBlockhash = blockhash;
  return tx.compileMessage().serialize();
}
