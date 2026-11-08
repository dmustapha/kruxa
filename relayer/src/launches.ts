import { Keypair } from "@solana/web3.js";
import type { Leaf } from "./merkle.js";

/** Rehearsal verdict table for the standalone core. 1 and 3..6 are PASS launches, 2 is FAIL. */
export const VERDICTS: Record<string, "PASS" | "FAIL"> = { "1": "PASS", "2": "FAIL", "3": "PASS", "4": "PASS", "5": "PASS", "6": "PASS" };

export interface Holder { key: Keypair; amount: bigint }
export const holderLeaves = (hs: Holder[]): Leaf[] => hs.map((h) => ({ claimant: h.key.publicKey.toBytes(), unlocked: h.amount, locked: 0n }));
