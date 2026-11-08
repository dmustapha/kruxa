import { Connection, PublicKey } from "@solana/web3.js";
import { TOKENKEG } from "./solana-bytes.js";

export interface MintView {
  owner: string; space: number; mintAuthority: string | null; freezeAuthority: string | null;
  supply: bigint; decimals: number; initialized: boolean;
}

const coption = (d: Buffer, off: number): string | null =>
  d.readUInt32LE(off) === 1 ? new PublicKey(d.subarray(off + 4, off + 36)).toBase58() : null;

/** Reads an SPL mint account: layout is 82 bytes, COption authorities, no extensions. */
export async function readMint(conn: Connection, mint: PublicKey): Promise<MintView | null> {
  const a = await conn.getAccountInfo(mint, "confirmed");
  if (!a) return null;
  const d = Buffer.from(a.data);
  return {
    owner: a.owner.toBase58(), space: d.length, mintAuthority: d.length >= 82 ? coption(d, 0) : null,
    supply: d.readBigUInt64LE(36), decimals: d[44]!, initialized: d[45] === 1, freezeAuthority: coption(d, 46),
  };
}

export function assertSealed(v: MintView): void {
  const bad: string[] = [];
  if (v.owner !== TOKENKEG) bad.push(`owner ${v.owner}`);
  if (v.space !== 82) bad.push(`space ${v.space} (extensions?)`);
  if (v.mintAuthority !== null) bad.push("mint authority not None");
  if (v.freezeAuthority !== null) bad.push("freeze authority not None");
  if (bad.length) throw new Error(`mint not sealed: ${bad.join("; ")}`);
}
