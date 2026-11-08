import { sha256, u64 } from "./solana-bytes.js";

export interface Leaf { claimant: Uint8Array; unlocked: bigint; locked: bigint }

const cmp = (a: Uint8Array, b: Uint8Array): number => Buffer.compare(a, b);

export const leafHash = (l: Leaf): Uint8Array => sha256(Uint8Array.of(0), sha256(l.claimant, u64(l.unlocked), u64(l.locked)));
const nodeHash = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  cmp(a, b) <= 0 ? sha256(Uint8Array.of(1), a, b) : sha256(Uint8Array.of(1), b, a);

/** Mirrors tools/genesis/ref/merkle.py: sorted by claimant, odd node promoted unchanged. */
export function buildMerkle(leaves: Leaf[]): { root: Uint8Array; proofs: Uint8Array[][]; sorted: Leaf[] } {
  const sorted = [...leaves].sort((a, b) => cmp(a.claimant, b.claimant));
  for (let i = 1; i < sorted.length; i++) {
    if (cmp(sorted[i - 1]!.claimant, sorted[i]!.claimant) === 0) throw new Error("duplicate claimant");
  }
  let level = sorted.map(leafHash);
  const pos = sorted.map((_, i) => i);
  const proofs: Uint8Array[][] = sorted.map(() => []);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? nodeHash(level[i]!, level[i + 1]!) : level[i]!);
    pos.forEach((p, k) => {
      const sib = p ^ 1;
      if (sib < level.length) proofs[k]!.push(level[sib]!);
      pos[k] = p >> 1;
    });
    level = next;
  }
  return { root: level[0]!, proofs, sorted };
}

export function verifyProof(proof: Uint8Array[], root: Uint8Array, leaf: Uint8Array): boolean {
  const h = proof.reduce((acc, p) => nodeHash(acc, p), leaf);
  return Buffer.compare(h, root) === 0;
}

