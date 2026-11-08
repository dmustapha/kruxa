import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { assertCluster, type Cluster } from "./cluster.js";
import { compileGenesis, MAX_TX, type GenesisCompiled, type GenesisSpec } from "./compile.js";
import { GenesisRefused, type CoreClient } from "./core.js";
import { assertSealed, readMint, type MintView } from "./mintcheck.js";
import type { GenesisSigner } from "./signer.js";

/** Exact lamports G consumes for one genesis (rent for mint, metadata, 3 bucket ATAs, vault ATA, distributor; the Metaplex
 *  creation fee; transaction fees). Measured on a local validator with the real programs (27,306,000 at price 1000); G is funded
 *  with exactly this so it ends at 0 (verify C16). A shortfall fails the tx loudly. Recalibrate if the Metaplex fee changes. */
export const GENESIS_NON_FEE_LAMPORTS = 27_295_600;
export const genesisCostLamports = (priceMicroLamports: number): number =>
  GENESIS_NON_FEE_LAMPORTS + 2 * 5000 + Math.ceil((priceMicroLamports * 150_000) / 1e6) + Math.ceil((priceMicroLamports * 250_000) / 1e6);

export interface CeremonyInput {
  conn: Connection; cluster: Cluster; core: CoreClient; signer: GenesisSigner;
  funder: Keypair; buildSpec: (gPub: Uint8Array) => GenesisSpec; priceMicroLamports: number;
  log: (line: string) => void;
}

export interface CeremonyResult { spec: GenesisSpec; blockhash: string; price: number; mint: string; sigs: [string, string]; slot: number; ceremonyHash: string; view: MintView; compiled: GenesisCompiled }

/** Wire form of a one-signer legacy transaction: compact-u16(1) | signature | message. */
export function wireTx(message: Uint8Array, signature: Uint8Array): Buffer {
  const wire = Buffer.concat([Buffer.from([1]), Buffer.from(signature), Buffer.from(message)]);
  if (wire.length > MAX_TX) throw new Error(`tx is ${wire.length} bytes, over ${MAX_TX}`);
  return wire;
}

async function fund(conn: Connection, funder: Keypair, to: PublicKey, lamports: number): Promise<void> {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports }));
  tx.feePayer = funder.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(funder);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}

async function sendSigned(conn: Connection, message: Uint8Array, signer: GenesisSigner, blockhash: string, height: number): Promise<string> {
  const wire = wireTx(message, await signer.sign(message));
  const sig = await conn.sendRawTransaction(wire, { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: height }, "confirmed");
  return sig;
}

export async function runCeremony(i: CeremonyInput): Promise<CeremonyResult> {
  const { conn, signer, log } = i;
  await assertCluster(conn, i.cluster);
  const spec = i.buildSpec(signer.pub());
  await i.core.commitGenesis(spec.launchId, signer.pub());
  log(`commit_genesis ok (${i.core.label})`);
  await fund(conn, i.funder, new PublicKey(signer.pub()), genesisCostLamports(i.priceMicroLamports));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const compiled = compileGenesis(spec, blockhash, i.priceMicroLamports);
  signer.expect?.([compiled.tx1, compiled.tx2]);
  await assertCluster(conn, i.cluster);
  const s1 = await sendSigned(conn, compiled.tx1, signer, blockhash, lastValidBlockHeight);
  log(`tx1 create: ${s1}`);
  const s2 = await sendSigned(conn, compiled.tx2, signer, blockhash, lastValidBlockHeight);
  log(`tx2 seal: ${s2}`);
  signer.destroy();
  const mint = new PublicKey(compiled.mint);
  const view = (await readMint(conn, mint))!;
  assertSealed(view);
  const slot = await conn.getSlot("confirmed");
  const ceremonyHash = createHash("sha256").update(compiled.specHash).update(bs58.decode(s1)).update(bs58.decode(s2)).digest("hex");
  await i.core.confirmGenesis(spec.launchId, mint.toBase58(), [s1, s2], slot, ceremonyHash);
  return { spec, blockhash, price: i.priceMicroLamports, mint: mint.toBase58(), sigs: [s1, s2], slot, ceremonyHash, view, compiled };
}

export async function attemptRefused(core: CoreClient, launchId: bigint, conn: Connection, wouldBeMint: PublicKey | null): Promise<string> {
  try {
    await core.commitGenesis(launchId, null);
  } catch (e) {
    if (!(e instanceof GenesisRefused)) throw e;
    const acct = wouldBeMint ? await conn.getAccountInfo(wouldBeMint) : null;
    return `refused: ${e.code}\nmint account: ${acct ? acct.owner.toBase58() : "null"}`;
  }
  throw new Error("commit_genesis was NOT refused for a FAIL launch");
}
