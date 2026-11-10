import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { assertCluster, DEVNET_GENESIS_HASH, type Cluster } from "./cluster.js";
import { compileGenesis, decodeSpec, MAX_TX, specHash, type GenesisCompiled, type Params, type Spec } from "./compile.js";
import { b58d, b58e, createWithSeed, TOKENKEG } from "./solana-bytes.js";
import { GenesisRefused, type CoreClient } from "./core.js";
import { assertSealed, readMint, type MintView } from "./mintcheck.js";
import { checkAdoptable, matchCeremonyTxs, programDataDeclaresId, type ChainTx } from "./resume.js";
import type { GenesisSigner } from "./signer.js";
import { buildSweepMessage, G_DUST_LAMPORTS, sweepAmount } from "./sweep.js";

/** Exact lamports G consumes for one genesis (rent for mint, metadata, 3 bucket ATAs, vault ATA, distributor; the Metaplex
 *  creation fee; transaction fees). Measured on a local validator with the real programs (27,306,000 at price 1000); G is funded
 *  with exactly this so it ends at the rent-exempt dust (verify C16). A shortfall fails the tx loudly. Recalibrate if the Metaplex fee changes. */
export const GENESIS_NON_FEE_LAMPORTS = 27_295_600;
/** Exact lamports G consumes (rent for mint, metadata, the reserve/clawback ATA, and with a distributor its PDA and vault ATA; the
 *  Metaplex creation fee; tx fees). Calibrated against a local validator with the real programs; G is funded with exactly this so it
 *  ends at the rent-exempt dust (verify C16). A shortfall fails the tx loudly. Recalibrate if the Metaplex fee or account sizes change. */
/** Measured per cluster: the local validator runs the same Metaplex binary but without its on-chain fee configuration, so the
 *  Metaplex creation cost differs by 1,974,400 lamports between local and devnet. devnet with distributor measured on core2 launch 4 (funded 21,242,640 + dust, 1,200,920 left over). */
export const NON_FEE: Record<Cluster, { withDistributor: number; noDistributor: number }> = {
  local: { withDistributor: 23_217_040, noDistributor: 18_658_240 },
  devnet: { withDistributor: 20_041_720, noDistributor: 16_683_840 },
};
export const genesisCostLamports = (cluster: Cluster, hasDistributor: boolean, priceMicroLamports: number): number =>
  G_DUST_LAMPORTS + (hasDistributor ? NON_FEE[cluster].withDistributor : NON_FEE[cluster].noDistributor) + 2 * 5000 +
  Math.ceil((priceMicroLamports * 150_000) / 1e6) + Math.ceil((priceMicroLamports * 250_000) / 1e6);

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export interface CeremonyInput {
  conn: Connection; cluster: Cluster; core: CoreClient; signer: GenesisSigner; launchId: bigint;
  funder: Keypair; priceMicroLamports: number; jitoProgram: string; metadataUri: string; priorTx1?: string; log: (line: string) => void;
}

export interface CeremonyResult {
  specBytes: Uint8Array; params: Params; blockhash: string; price: number; mint: string; sigs: [string, string]; slot: number;
  ceremonyHash: string; view: MintView; compiled: GenesisCompiled; timing: { signMs: number[] }; resumed: boolean;
  /** Set when a sealed mint from an earlier attempt (genesis reopened by the owner) was verified and adopted instead of recreated. */
  adopted?: boolean;
  /** Signature of the G-signed sweep of leftover lamports (F1 only), when G held more than the verify C16 bound. */
  sweepSig?: string;
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
  const predicted = new PublicKey(createWithSeed(signer.pub(), launchId.toString(), TOKENKEG));
  const pre = await readMint(conn, predicted);
  const adoptable = pre !== null && pre.mintAuthority === null && pre.owner === TOKENKEG && pre.space === 82;
  if (pre && !adoptable && pre.mintAuthority !== new PublicKey(signer.pub()).toBase58()) throw new Error(`preflight: mint ${predicted.toBase58()} already exists and is neither resumable nor a sealed mint to adopt (a previous ceremony used the same key and launch id); refusing BEFORE commit_genesis, which is one-shot`);
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
  if (existing && existing.mintAuthority === null) return adoptSealedMint(i, specBytes, existing, gKey);
  await assertDistributorProgram(conn, i.jitoProgram);
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
    await signer.expect?.([msg], which === "tx1" ? 0 : 1);
    const sig = await sendSigned(conn, msg, signer, f.blockhash, f.lastValidBlockHeight, signMs);
    log(`${which} ${which === "tx1" ? "create" : "seal"}: ${sig}`);
    sigs.push(sig);
    return f;
  };
  if (!resume) await stage("tx1");
  else if (i.priorTx1) sigs.push(i.priorTx1);
  const last = await stage("tx2");
  const sweepSig = await sweepLeftover(i, signer);
  signer.destroy();
  const done = await finish(i, { specBytes, params, blockhash: last.blockhash, compiled: last.compiled, sigs, signMs, resumed: resume });
  return { ...done, sweepSig };
}

/** Distributor preflight: deployed, executable, and (upgradeable loader) its program data carries its own address as the declared id. */
async function assertDistributorProgram(conn: Connection, program: string): Promise<void> {
  const id = new PublicKey(program);
  const acct = await conn.getAccountInfo(id);
  if (!acct?.executable) throw new Error(`preflight: distributor program ${program} is not deployed on this cluster (refusing before tx1: an F1 key is memory-only, a stranded unsealed mint cannot be recovered)`);
  if (acct.owner.toBase58() !== UPGRADEABLE_LOADER) return;
  const data = await conn.getAccountInfo(new PublicKey(acct.data.subarray(4, 36)));
  if (data && !programDataDeclaresId(data.data, id.toBytes())) throw new Error(`preflight: distributor program ${program} does not declare its own address as program id (DeclaredProgramIdMismatch, error 4100); redeploy a copy with the declared id patched (scripts/genesis-devnet-setup.sh)`);
}

interface Done { specBytes: Uint8Array; params: Params; blockhash: string; compiled: GenesisCompiled; sigs: string[]; signMs: number[]; resumed: boolean }

/** Reads the sealed mint back, then confirms on the core. Shared by a fresh ceremony, a resumed one and an adopted one. */
async function finish(i: CeremonyInput, d: Done): Promise<CeremonyResult> {
  const mint = new PublicKey(d.compiled.mint);
  const view = (await readMint(i.conn, mint))!;
  assertSealed(view);
  const slot = await i.conn.getSlot("confirmed");
  const sigs = d.sigs;
  const ceremonyHash = createHash("sha256").update(d.compiled.specHash).update(bs58.decode(sigs[0]!)).update(bs58.decode(sigs[1] ?? sigs[0]!)).digest("hex");
  await i.core.confirmGenesis(i.launchId, d.compiled.mint, sigs, slot, ceremonyHash);
  return { specBytes: d.specBytes, params: d.params, blockhash: d.blockhash, price: i.priceMicroLamports, mint: mint.toBase58(), sigs: [sigs[0]!, sigs[1] ?? sigs[0]!], slot, ceremonyHash, view, compiled: d.compiled, timing: { signMs: d.signMs }, resumed: d.resumed };
}

/** Owner reopened an aborted genesis and the F0 key is unchanged, so the mint address is the same and the mint already exists sealed.
 *  Nothing is signed or created: the existing transactions must equal compile(spec, blockhash, price) and the mint must match the
 *  spec; then the genesis is confirmed. Any mismatch fails with a message and confirms nothing. */
async function adoptSealedMint(i: CeremonyInput, specBytes: Uint8Array, existing: MintView, gKey: PublicKey): Promise<CeremonyResult> {
  const found = matchCeremonyTxs(await fetchGTxs(i.conn, gKey), specBytes, { jitoProgram: b58d(i.jitoProgram), metadataUri: i.metadataUri }, i.priceMicroLamports);
  checkAdoptable(existing, specBytes, found.compiled);
  i.log(`ADOPT: sealed mint ${new PublicKey(found.compiled.mint).toBase58()} already exists and matches the committed spec; skipping tx1 and tx2, confirming`);
  i.signer.destroy();
  const done = await finish(i, { specBytes, params: found.params, blockhash: found.blockhash, compiled: found.compiled, sigs: found.sigs, signMs: [], resumed: true });
  return { ...done, adopted: true };
}

/** G's confirmed transactions, newest first, as the legacy messages G signed (the fund transaction is included and simply never matches). */
async function fetchGTxs(conn: Connection, g: PublicKey): Promise<ChainTx[]> {
  const out: ChainTx[] = [];
  for (const s of await conn.getSignaturesForAddress(g, { limit: 20 }, "confirmed")) {
    const t = s.err ? null : await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (t) out.push({ sig: s.signature, blockhash: t.transaction.message.recentBlockhash, message: t.transaction.message.serialize() });
  }
  return out;
}

/** F1 only: G keeps whatever the calibration over-estimated (verify C16 allows dust only), so before the key is destroyed G signs one
 *  plain transfer of the excess back to the funder. F0 is never swept: its policy gate signs only the committed transactions. */
async function sweepLeftover(i: CeremonyInput, signer: GenesisSigner): Promise<string | undefined> {
  const g = new PublicKey(signer.pub());
  const amount = sweepAmount(await i.conn.getBalance(g, "confirmed"));
  if (amount === null) return undefined;
  if (signer.mode === "F0") { i.log(`G holds ${amount + 5000} lamports above the C16 bound; F0 is not swept (policy gate signs only the committed transactions)`); return undefined; }
  try {
    const { blockhash, lastValidBlockHeight } = await i.conn.getLatestBlockhash("confirmed");
    const sig = await sendSigned(i.conn, buildSweepMessage(g, i.funder.publicKey, amount, blockhash), signer, blockhash, lastValidBlockHeight, []);
    i.log(`sweep G -> funder ${amount} lamports: ${sig}`);
    return sig;
  } catch (e) {
    i.log(`SWEEP FAILED (G keeps its lamports, verify C16 will flag it): ${String(e instanceof Error ? e.message : e)}`);
    return undefined;
  }
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
