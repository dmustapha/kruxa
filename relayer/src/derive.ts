import { ed25519 } from "@noble/curves/ed25519";
import { sha3_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";

const L = ed25519.CURVE.n;

const leToBigInt = (b: Uint8Array): bigint => b.reduceRight((n, x) => (n << 8n) | BigInt(x), 0n);

/** child = root + (sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<pred>,<path>") mod L) * G, as 32 raw bytes. */
export function derivedKeyBytes(rootPk: string, predecessor: string, path: string): Uint8Array {
  if (!rootPk.startsWith("ed25519:")) throw new Error(`not an ed25519 key: ${rootPk}`);
  const eps = sha3_256(new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`));
  const root = ed25519.ExtendedPoint.fromHex(bs58.decode(rootPk.slice(8)));
  return root.add(ed25519.ExtendedPoint.BASE.multiply(leToBigInt(eps) % L)).toRawBytes();
}

export const derivedNearKey = (rootPk: string, predecessor: string, path: string): string =>
  `ed25519:${bs58.encode(derivedKeyBytes(rootPk, predecessor, path))}`;
