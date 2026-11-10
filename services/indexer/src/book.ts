import { createHash } from "node:crypto";

export const ZERO_BOOK_HASH = "0".repeat(64);

function le(value: bigint, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Rolling book hash, byte for byte the contract's `book_next` (crates/kruxa-logic/src/verdict.rs):
 * sha256(prev || kind || len(holder) u16 LE || holder || amount u128 LE || total_after u128 LE || funders_after u32 LE).
 * kind: 1 = contributed, 2 = walked. `holder` is the text key (`near:<account>` or `sol:<base58>`).
 */
export function bookNext(prevHex: string, kind: 1 | 2, holder: string, amount: bigint, totalAfter: bigint, fundersAfter: number): string {
  const h = createHash("sha256");
  h.update(Buffer.from(prevHex, "hex"));
  h.update(Buffer.from([kind]));
  const who = Buffer.from(holder, "utf8");
  h.update(le(BigInt(who.length), 2));
  h.update(who);
  h.update(le(amount, 16));
  h.update(le(totalAfter, 16));
  h.update(le(BigInt(fundersAfter), 4));
  return h.digest("hex");
}
