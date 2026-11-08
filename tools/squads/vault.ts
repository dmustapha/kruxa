import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { assertCluster, rpcFor, type Cluster } from "../../relayer/src/cluster.js";

export const PRODUCTION_TIME_LOCK = 172_800; // 48 h, RULED R-GR-TIME; never shortened outside a labelled devnet/local rehearsal

export interface VaultInfo { multisig: PublicKey; vault: PublicKey; members: Keypair[]; timeLock: number }

export function parseCluster(argv: string[]): Cluster {
  const i = argv.indexOf("--cluster");
  const c = i >= 0 ? argv[i + 1] : "devnet";
  if (c !== "devnet" && c !== "local") { console.error("usage: --cluster devnet|local --time-lock SECONDS"); process.exit(64); }
  return c;
}

export function parseTimeLock(argv: string[]): number {
  const i = argv.indexOf("--time-lock");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  if (!Number.isInteger(n) || n < 0) { console.error("usage: --cluster devnet|local --time-lock SECONDS"); process.exit(64); }
  return n;
}

export async function connect(cluster: Cluster): Promise<Connection> {
  const conn = new Connection(rpcFor(cluster), "confirmed");
  await assertCluster(conn, cluster);
  return conn;
}

export async function funderFor(conn: Connection, cluster: Cluster): Promise<Keypair> {
  if (cluster === "local") {
    const kp = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL), "confirmed");
    return kp;
  }
  const p = process.env.KRUXA_RELAYER_KEY ?? `${homedir()}/.kruxa-secrets/genesis/relayer-devnet.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

/** 2-of-3 autonomous Squads v4 multisig (no config authority). Members are software TEST keys (single-party demo). */
export async function createVault(conn: Connection, funder: Keypair, timeLock: number): Promise<VaultInfo> {
  const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, multisig.getProgramConfigPda({})[0]);
  const ix = multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey, creator: funder.publicKey, multisigPda, configAuthority: null, threshold: 2,
    members: members.map((m) => ({ key: m.publicKey, permissions: multisig.types.Permissions.all() })),
    timeLock, treasury: cfg.treasury, rentCollector: null,
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [funder, createKey]);
  return { multisig: multisigPda, vault, members, timeLock };
}

export async function readOnChain(conn: Connection, multisigPda: PublicKey): Promise<{ threshold: number; timeLock: number; members: string[] }> {
  const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
  return { threshold: ms.threshold, timeLock: ms.timeLock, members: ms.members.map((m) => m.key.toBase58()).sort() };
}

export const lamportsTransfer = (from: PublicKey, to: PublicKey, lamports: number) => SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
