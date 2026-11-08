import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { assertCluster, DEVNET_GENESIS_HASH, type Cluster } from "./cluster.js";
import { compileGenesis, decodeSpec, MAX_TX, specHash, type GenesisCompiled, type Params, type Spec } from "./compile.js";
import { b58d, b58e } from "./solana-bytes.js";
import { GenesisRefused, type CoreClient } from "./core.js";
import { assertSealed, readMint, type MintView } from "./mintcheck.js";
import type { GenesisSigner } from "./signer.js";

/** Exact lamports G consumes for one genesis (rent for mint, metadata, 3 bucket ATAs, vault ATA, distributor; the Metaplex
 *  creation fee; transaction fees). Measured on a local validator with the real programs (27,306,000 at price 1000); G is funded
 *  with exactly this so it ends at the rent-exempt dust (verify C16). A shortfall fails the tx loudly. Recalibrate if the Metaplex fee changes. */
export const GENESIS_NON_FEE_LAMPORTS = 27_295_600;
/** Exact lamports G consumes (rent for mint, metadata, the reserve/clawback ATA, and with a distributor its PDA and vault ATA; the
 *  Metaplex creation fee; tx fees). Calibrated against a local validator with the real programs; G is funded with exactly this so it
 *  ends at the rent-exempt dust (verify C16). A shortfall fails the tx loudly. Recalibrate if the Metaplex fee or account sizes change. */
/** Measured per cluster: the local validator runs the same Metaplex binary but without its on-chain fee configuration, so the
 *  Metaplex creation cost differs by 1,974,400 lamports between local and devnet. devnet with distributor is DERIVED, not yet measured. */
export const NON_FEE: Record<Cluster, { withDistributor: number; noDistributor: number }> = {
  local: { withDistributor: 23_217_040, noDistributor: 18_658_240 },
  devnet: { withDistributor: 21_242_640, noDistributor: 16_683_840 },
};
/** A system account may not end a transaction with 0 < lamports < rent-exempt minimum, so G keeps exactly this much (dust, disclosed). */
export const G_DUST_LAMPORTS = 890_880;
export const genesisCostLamports = (cluster: Cluster, hasDistributor: boolean, priceMicroLamports: number): number =>
  G_DUST_LAMPORTS + (hasDistributor ? NON_FEE[cluster].withDistributor : NON_FEE[cluster].noDistributor) + 2 * 5000 +
  Math.ceil((priceMicroLamports * 150_000) / 1e6) + Math.ceil((priceMicroLamports * 250_000) / 1e6);

export interface CeremonyInput {
  conn: Connection; cluster: Cluster; core: CoreClient; signer: GenesisSigner; launchId: bigint;
  funder: Keypair; priceMicroLamports: number; jitoProgram: string; metadataUri: string; priorTx1?: string; log: (line: string) => void;
}

export interface CeremonyResult {
  specBytes: Uint8Array; params: Params; blockhash: string; price: number; mint: string; sigs: [string, string]; slot: number;
  ceremonyHash: string; view: MintView; compiled: GenesisCompiled; timing: { signMs: number[] }; resumed: boolean;
}

/** Wire form of a one-signer legacy transaction: compact-u16(1) | signature | message. */
export function wireTx(message: Uint8Array, signature: Uint8Array): Buffer {
  const wire = Buffer.concat([Buffer.from([1]), Buffer.from(signature), Buffer.from(message)]);
  if (wire.length > MAX_TX) throw new Error(`tx is ${wire.length} bytes, over ${MAX_TX}`);
  return wire;
}

async function fund(conn: Connection, funder: Keypair, to: PublicKey, lamports: number): Promise<string> {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports }));
  tx.feePayer = funder.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(funder);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function sendSigned(conn: Connection, message: Uint8Array, signer: GenesisSigner, blockhash: string, height: number, ms: number[]): Promise<string> {
  const t0 = Date.now();
  const wire = wireTx(message, await signer.sign(message));
  ms.push(Date.now() - t0);
  const sig = await conn.sendRawTransaction(wire, { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: height }, "confirmed");
  return sig;
}

export function costFor(cluster: Cluster, spec: Spec, price: number): number {
  return genesisCostLamports(cluster, spec.maxNumNodes > 0 || spec.maxTotalClaim > 0n, price);
}

async function freshCompile(conn: Connection, specBytes: Uint8Array, params: Params, price: number) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  return { blockhash, lastValidBlockHeight, compiled: compileGenesis(specBytes, params, blockhash, price) };
}

/** Each transaction gets its own fresh blockhash (the MPC signer can take a minute); the compile parameters other than the blockhash
 *  are fixed for the ceremony, so the F0 policy gate is registered per message just before it is signed. */
export async function runCeremony(i: CeremonyInput): Promise<CeremonyResult> {
  const { conn, signer, log, core, launchId } = i;
  await assertCluster(conn, i.cluster);
  await core.commitGenesis(launchId, signer.pub());
  log(`commit_genesis ok (${core.label})`);
  const specBytes = await core.specBytes(launchId);
  if (Buffer.from(specHash(specBytes)).toString("hex") !== (await core.specHashOnChain(launchId))) throw new Error("spec bytes do not hash to the on-chain genesis_spec_hash");
  const spec = decodeSpec(specBytes);
  if (Buffer.compare(spec.gPub, signer.pub()) !== 0) throw new Error("spec g_pub is not the signer key");
  if (i.cluster === "devnet" && b58e(spec.clusterGenesisHash) !== DEVNET_GENESIS_HASH) throw new Error("spec cluster hash is not devnet");
  const params: Params = { jitoProgram: b58d(i.jitoProgram), metadataUri: i.metadataUri, clockTs: BigInt(Math.floor(Date.now() / 1000)) };
  const gKey = new PublicKey(signer.pub());
  const existing = await readMint(conn, new PublicKey(spec.mintAddress));
  const resume = existing !== null && existing.mintAuthority === gKey.toBase58();
  if (existing && !resume) throw new Error(`mint already exists and is not resumable (mint authority ${existing.mintAuthority})`);
  const need = costFor(i.cluster, spec, i.priceMicroLamports);
  const have = await conn.getBalance(gKey);
  if (!resume || have < 20_000) log(`fund G ${gKey.toBase58()}: ${await fund(conn, i.funder, gKey, need - (resume ? 0 : have))}`);
  else log(`RESUME: mint exists unsealed, G holds ${have} lamports; skipping tx1`);
  const signMs: number[] = [];
  const sigs: string[] = [];
  const stage = async (which: "tx1" | "tx2") => {
    await assertCluster(conn, i.cluster);
    const f = await freshCompile(conn, specBytes, params, i.priceMicroLamports);
    const msg = f.compiled[which];
    signer.expect?.([msg]);
    const sig = await sendSigned(conn, msg, signer, f.blockhash, f.lastValidBlockHeight, signMs);
    log(`${which} ${which === "tx1" ? "create" : "seal"}: ${sig}`);
    sigs.push(sig);
    return f;
  };
  if (!resume) await stage("tx1");
  else if (i.priorTx1) sigs.push(i.priorTx1);
  const last = await stage("tx2");
  signer.destroy();
  const compiled = last.compiled;
  const mint = new PublicKey(compiled.mint);
  const view = (await readMint(conn, mint))!;
  assertSealed(view);
  const slot = await conn.getSlot("confirmed");
  const ceremonyHash = createHash("sha256").update(compiled.specHash).update(bs58.decode(sigs[0]!)).update(bs58.decode(sigs[1] ?? sigs[0]!)).digest("hex");
  await core.confirmGenesis(launchId, compiled.mint, sigs, slot, ceremonyHash);
  return { specBytes, params, blockhash: last.blockhash, price: i.priceMicroLamports, mint: mint.toBase58(), sigs: [sigs[0]!, sigs[1] ?? sigs[0]!], slot, ceremonyHash, view, compiled, timing: { signMs }, resumed: resume };
}

export async function attemptRefused(core: CoreClient, launchId: bigint, conn: Connection, wouldBeMint: PublicKey | null): Promise<string> {
  try {
    await core.commitGenesis(launchId, new Uint8Array(32));
  } catch (e) {
    if (!(e instanceof GenesisRefused)) throw e;
    const acct = wouldBeMint ? await conn.getAccountInfo(wouldBeMint) : null;
    return `refused: ${e.code}\nmint account: ${acct ? acct.owner.toBase58() : "null"}`;
  }
  throw new Error("commit_genesis was NOT refused for a FAIL launch");
}
