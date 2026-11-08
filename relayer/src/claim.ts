import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { ataOf, concat, TOKENKEG, ATA, SYSTEM, u64 } from "./solana-bytes.js";
import { buildMerkle, leafHash, verifyProof, type Leaf } from "./merkle.js";

const pid = (s: string): PublicKey => new PublicKey(s);
const anchorDisc = (n: string): Buffer => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);

/** One claim against the Jito distributor by the real throwaway holder; returns the claimed amount. */
export async function claimOnce(conn: Connection, funder: Keypair, holder: Keypair, leaves: Leaf[], jito: string, mint: PublicKey,
  distributor: PublicKey, vault: PublicKey, version: bigint): Promise<bigint> {
  const tree = buildMerkle(leaves);
  const idx = tree.sorted.findIndex((l) => Buffer.compare(l.claimant, holder.publicKey.toBytes()) === 0);
  if (idx < 0) throw new Error("holder not in tree");
  const leaf = tree.sorted[idx]!;
  if (!verifyProof(tree.proofs[idx]!, tree.root, leafHash(leaf))) throw new Error("local proof does not verify");
  const to = new PublicKey(ataOf(holder.publicKey.toBytes(), mint.toBytes()));
  const [status] = PublicKey.findProgramAddressSync([Buffer.from("ClaimStatus"), holder.publicKey.toBuffer(), distributor.toBuffer()], pid(jito));
  const proof = concat(...tree.proofs[idx]!.map((p) => p));
  const data = Buffer.concat([anchorDisc("new_claim"), u64(leaf.unlocked), u64(leaf.locked), Buffer.from(new Uint32Array([tree.proofs[idx]!.length]).buffer), proof]);
  const m = (k: PublicKey, s: boolean, w: boolean) => ({ pubkey: k, isSigner: s, isWritable: w });
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: holder.publicKey, lamports: 6_000_000 }),
    new TransactionInstruction({ programId: pid(ATA), keys: [m(funder.publicKey, true, true), m(to, false, true), m(holder.publicKey, false, false), m(mint, false, false), m(pid(SYSTEM), false, false), m(pid(TOKENKEG), false, false)], data: Buffer.from([1]) }),
    new TransactionInstruction({ programId: pid(jito), keys: [m(distributor, false, true), m(status, false, true), m(vault, false, true), m(to, false, true), m(holder.publicKey, true, true), m(pid(TOKENKEG), false, false), m(pid(SYSTEM), false, false)], data }),
  );
  tx.feePayer = funder.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(funder, holder);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  const bal = await conn.getTokenAccountBalance(to, "confirmed");
  return BigInt(bal.value.amount);
}

