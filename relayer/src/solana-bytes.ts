import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const SYSTEM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const JITO_MAINNET = "mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv";

export const b58d = (s: string): Uint8Array => new PublicKey(s).toBytes();
export const b58e = (b: Uint8Array): string => new PublicKey(b).toBase58();

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const u8 = (n: number): Uint8Array => Uint8Array.of(n);
export const u16 = (n: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
export const u32 = (n: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
export const u64 = (n: bigint): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
export const i64 = (n: bigint): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, n, true); return b; };
export const str = (s: string): Uint8Array => { const e = new TextEncoder().encode(s); return concat(u32(e.length), e); };

export function createWithSeed(base: Uint8Array, seed: string, owner: string): Uint8Array {
  return sha256(base, new TextEncoder().encode(seed), b58d(owner));
}

export function findPda(seeds: Uint8Array[], program: Uint8Array): Uint8Array {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBytes();
}

export const ataOf = (owner: Uint8Array, mint: Uint8Array): Uint8Array => findPda([owner, b58d(TOKENKEG), mint], b58d(ATA));

export interface Meta { key: Uint8Array; signer: boolean; writable: boolean }
export interface Ix { program: Uint8Array; accounts: Meta[]; data: Uint8Array }
export const meta = (key: Uint8Array, signer: boolean, writable: boolean): Meta => ({ key, signer, writable });

const cu16 = (n: number): Uint8Array => {
  const out: number[] = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if (n) out.push(b | 0x80); else { out.push(b); return Uint8Array.from(out); }
  }
};

/** Legacy message. Same ordering rule as the Python reference: payer first, then signer+w, signer+ro, nonsigner+w, nonsigner+ro, first appearance within a class. */
export function compileMessage(payer: Uint8Array, ixs: Ix[], blockhash: string): Uint8Array {
  const hex = (k: Uint8Array) => Buffer.from(k).toString("hex");
  const flags = new Map<string, { key: Uint8Array; s: boolean; w: boolean }>();
  const touch = (key: Uint8Array, s: boolean, w: boolean) => {
    const e = flags.get(hex(key)) ?? { key, s: false, w: false };
    e.s ||= s; e.w ||= w;
    flags.set(hex(key), e);
  };
  touch(payer, true, true);
  for (const i of ixs) { i.accounts.forEach((a) => touch(a.key, a.signer, a.writable)); touch(i.program, false, false); }
  const cat = (e: { s: boolean; w: boolean }) => (e.s && e.w ? 0 : e.s ? 1 : e.w ? 2 : 3);
  const entries = [...flags.values()];
  const keys = entries.map((e, order) => ({ e, order })).sort((a, b) => cat(a.e) - cat(b.e) || a.order - b.order).map((x) => x.e);
  const index = (k: Uint8Array) => keys.findIndex((x) => hex(x.key) === hex(k));
  const header = Uint8Array.of(keys.filter((e) => e.s).length, keys.filter((e) => e.s && !e.w).length, keys.filter((e) => !e.s && !e.w).length);
  const parts: Uint8Array[] = [header, cu16(keys.length), ...keys.map((e) => e.key), b58d(blockhash), cu16(ixs.length)];
  for (const i of ixs) {
    const idx = Uint8Array.from(i.accounts.map((a) => index(a.key)));
    parts.push(u8(index(i.program)), cu16(idx.length), idx, cu16(i.data.length), i.data);
  }
  return concat(...parts);
}
