import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PRODUCTION_TIME_LOCK, readOnChain } from "../../tools/squads/vault.js";
import { runCeremony } from "./ceremony.js";
import { assertCluster, rpcFor } from "./cluster.js";
import { decodeSpec } from "./compile.js";
import { F0Signer } from "./f0.js";
import { DryRunStop, makeGate, readSettings, type CeremonyGate, type MainnetPlan } from "./mainnet-guard.js";
import { mainnetAccount } from "./near.js";
import { RealCore } from "./realcore.js";
import { writeRecord } from "./record.js";
import { JITO_MAINNET } from "./solana-bytes.js";
import { ResumingCore, type GenesisView } from "./watcher.js";
import type { Cluster } from "./cluster.js";

type Env = Record<string, string | undefined>;
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface MainnetArgs {
  launch: bigint; mode: "F1" | "F0"; core?: string; record?: string; squadsTimeLock?: number; holders: number; priorTx1?: string; holdersFile?: string; expectRefused: boolean;
}
export interface MainnetConfig { core: string; record: string; metadataUri: string; priceMicroLamports: number }

/** Every refusal that does not need a network. The mainnet path is F0 only, through the core's gate, against the real Jito program, writing a record. */
export function validateMainnetArgs(a: MainnetArgs, env: Env): MainnetConfig {
  const no = (why: string): never => { throw new Error(`refusing: ${why}`); };
  if (a.mode !== "F0") no("mainnet-beta genesis is F0 only (F1 on mainnet needs a separate owner ruling and code change)");
  if (!a.core || a.core.endsWith(".testnet")) no("--core must name the NEAR MAINNET core account");
  if (!a.record) no("--record FILE is required on mainnet (the verifier needs it and a mint cannot be redone)");
  if (a.squadsTimeLock !== undefined) no("--squads-time-lock creates a vault: on mainnet the vault is made by scripts/mainnet/create-squads-vault.mjs");
  if (a.holders > 0 || a.holdersFile || a.expectRefused) no("--holders, --holders-file and --expect-refused are rehearsal flags");
  if (env.JITO_PROGRAM !== undefined && env.JITO_PROGRAM !== JITO_MAINNET) no(`JITO_PROGRAM is ${env.JITO_PROGRAM}; mainnet uses ${JITO_MAINNET} only (unset it)`);
  if (env.F0_BACKEND !== undefined) no("F0_BACKEND is set; mainnet uses the core's gate only (unset it)");
  const uri = env.KRUXA_METADATA_URI ?? "";
  if (!/^https:\/\/[^\s]+$/.test(uri) || /\.example\b|localhost|127\.0\.0\.1/.test(uri) || new TextEncoder().encode(uri).length > 200) no("KRUXA_METADATA_URI must be the real https metadata URL the core committed to (at most 200 bytes)");
  const price = Number(env.KRUXA_SOLANA_PRIORITY_MICROLAMPORTS ?? "1000");
  if (!Number.isInteger(price) || price < 0 || price > 200_000) no("KRUXA_SOLANA_PRIORITY_MICROLAMPORTS must be an integer from 0 to 200000");
  return { core: a.core!, record: a.record!, metadataUri: uri, priceMicroLamports: price };
}

/** The Solana funder key: JSON byte array in a file named by KRUXA_SOLANA_FUNDER_KEY, outside the repo, mode 600. Never printed. */
export function loadSolanaFunder(env: Env): Keypair {
  const named = env.KRUXA_SOLANA_FUNDER_KEY;
  if (!named) throw new Error("refusing: KRUXA_SOLANA_FUNDER_KEY is not set");
  const abs = resolve(named.replace(/^~/, homedir()));
  if (abs.startsWith(REPO + sep)) throw new Error("refusing: KRUXA_SOLANA_FUNDER_KEY must live outside the repo");
  if ((statSync(abs).mode & 0o077) !== 0) throw new Error(`refusing: KRUXA_SOLANA_FUNDER_KEY ${abs} must be mode 600`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(abs, "utf8")) as number[]));
}

/** The reserve is owned by a Squads vault that must be a real 2-of-N multisig with no config authority and the 48 h production time lock. */
export async function assertReserveVault(conn: Connection, multisig: PublicKey): Promise<void> {
  const sq = await readOnChain(conn, multisig);
  if (sq.threshold < 2) throw new Error(`refusing: reserve multisig threshold ${sq.threshold} is below 2`);
  if (sq.timeLock < PRODUCTION_TIME_LOCK) throw new Error(`refusing: reserve multisig time lock ${sq.timeLock} s is below the production ${PRODUCTION_TIME_LOCK} s (48 h)`);
}

async function ttyAsk(q: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("refusing: the typed confirmation needs an interactive terminal (stdin is not a TTY)");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(q); } finally { rl.close(); }
}

/** The pre-send stage also checks the reserve vault before the plan is shown. */
function withVaultCheck(conn: Connection, base: CeremonyGate): CeremonyGate {
  return async (plan: MainnetPlan) => {
    if (plan.stage === "pre-send" && plan.exact) await assertReserveVault(conn, new PublicKey(plan.exact.reserveMultisig));
    await base(plan);
  };
}

export async function mainnetGenesis(a: MainnetArgs, env: Env = process.env): Promise<void> {
  const cfg = validateMainnetArgs(a, env);
  const settings = readSettings(env);
  const cluster: Cluster = "mainnet-beta";
  const conn = new Connection(rpcFor(cluster, env), "confirmed");
  await assertCluster(conn, cluster, env);
  console.log(`cluster: mainnet-beta (REAL MONEY, IRREVERSIBLE) mode: F0 launch: ${a.launch} dry_run: ${settings.dryRun}`);
  const funder = loadSolanaFunder(env);
  const real = new RealCore(await mainnetAccount(env), cfg.core, "mainnet");
  const view = (id: bigint) => real.view<GenesisView>("get_genesis", { launch_id: id.toString() });
  const core = new ResumingCore(real, view);
  const signer = await F0Signer.fromEnv(a.launch, cfg.core, "mainnet");
  const gate = withVaultCheck(conn, makeGate(settings, env, ttyAsk, console.log));
  try {
    const r = await runCeremony({ conn, cluster, core, signer, launchId: a.launch, funder, priceMicroLamports: cfg.priceMicroLamports, jitoProgram: JITO_MAINNET, metadataUri: cfg.metadataUri, priorTx1: a.priorTx1, log: console.log, gate });
    const multisig = new PublicKey(decodeSpec(r.specBytes).squadsMultisig);
    const sq = await readOnChain(conn, multisig);
    const leaves = (await real.allocations(a.launch)).map(([k, amt]) => ({ claimant: Uint8Array.from(Buffer.from(k, "hex")), unlocked: BigInt(amt), locked: 0n }));
    const f0 = signer.backend.derivation;
    writeRecord(cfg.record, r, { cluster, mode: "F0", launchId: a.launch, leaves, core: core.label, squads: { multisig: multisig.toBase58(), members: sq.members, threshold: sq.threshold, time_lock: sq.timeLock }, f0: { ...f0!, sign_log: signer.backend.signLog }, sources: core.label });
    console.log(`mint: ${r.mint}\nrecord: ${cfg.record}\nconfirm_genesis ok`);
  } catch (e) {
    if (!(e instanceof DryRunStop)) throw e;
    console.log(e.message);
  }
}
