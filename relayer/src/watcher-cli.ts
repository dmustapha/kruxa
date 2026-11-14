import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { providers } from "near-api-js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { runCeremony } from "./ceremony.js";
import { assertCluster, rpcFor } from "./cluster.js";
import { decodeSpec } from "./compile.js";
import { F0Signer } from "./f0.js";
import { testnetAccount } from "./near.js";
import { RealCore } from "./realcore.js";
import { writeRecord } from "./record.js";
import { F1Signer, type GenesisSigner } from "./signer.js";
import { JITO_MAINNET } from "./solana-bytes.js";
import { watcherSetup } from "./watcher-guard.js";
import { newWatcher, ResumingCore, watchOnce, type GenesisView, type WatcherPorts } from "./watcher.js";
import { readOnChain } from "../../tools/squads/vault.js";

const env = process.env;
const argv = process.argv.slice(2);
const SETUP = watcherSetup(env, argv);
const SEND = SETUP.send;
const ONCE = argv.includes("--once");
const CORE = SETUP.core;
const CLUSTER = SETUP.cluster;
const RPC = SETUP.nearRpc;
const RECORD_DIR = env.WATCHER_RECORD_DIR ?? "genesis-records";
const INTERVAL = Number(env.WATCHER_INTERVAL_MS ?? 30_000);

const log: WatcherPorts["log"] = (level, event, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
const recordFile = (id: bigint): string => join(RECORD_DIR, `genesis-${id}.json`);

function loadFunder(): Keypair {
  const p = env.KRUXA_RELAYER_KEY ?? `${homedir()}/.kruxa-secrets/genesis/relayer-devnet.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

const provider = new providers.JsonRpcProvider({ url: RPC });
const view = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
  const res = await provider.query({ request_type: "call_function", account_id: CORE, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
  return JSON.parse(Buffer.from((res as unknown as { result: number[] }).result).toString("utf8")) as T;
};

/** Built only when a ceremony really runs (never in dry-run): this is where the NEAR relayer key and the Solana funder are loaded. */
async function ceremonyFor(launch: bigint, g: GenesisView): Promise<{ mint: string; adopted: boolean; resumed: boolean }> {
  if (CLUSTER === "mainnet-beta") throw new Error("refusing: the watcher never runs a mainnet ceremony");
  const conn = new Connection(rpcFor(CLUSTER), "confirmed");
  await assertCluster(conn, CLUSTER);
  const real = new RealCore(await testnetAccount(), CORE);
  const core = new ResumingCore(real, () => view<GenesisView>("get_genesis", { launch_id: launch.toString() }));
  const signer: GenesisSigner = g.mode === "F1" ? new F1Signer() : await F0Signer.fromEnv(launch, CORE);
  const metadataUri = (env.WATCHER_METADATA_URI_TEMPLATE ?? "https://kruxa.example/rehearsal/{id}.json").replace("{id}", launch.toString());
  const funder = loadFunder();
  const r = await runCeremony({ conn, cluster: CLUSTER, core, signer, launchId: launch, funder, priceMicroLamports: 1000, jitoProgram: env.JITO_PROGRAM ?? JITO_MAINNET, metadataUri, log: (l) => log("info", "ceremony", { launch: launch.toString(), line: l }) });
  const leaves = (await real.allocations(launch)).map(([k, amt]) => ({ claimant: Uint8Array.from(Buffer.from(k, "hex")), unlocked: BigInt(amt), locked: 0n }));
  const multisig = new PublicKey(decodeSpec(r.specBytes).squadsMultisig);
  const sq = await readOnChain(conn, multisig);
  const f0 = signer.mode === "F0" ? (signer as F0Signer).backend.derivation : undefined;
  mkdirSync(RECORD_DIR, { recursive: true });
  writeRecord(recordFile(launch), r, { cluster: CLUSTER, mode: g.mode, launchId: launch, leaves, core: core.label, squads: { multisig: multisig.toBase58(), members: sq.members, threshold: sq.threshold, time_lock: sq.timeLock }, f0: f0 && { ...f0, sign_log: (signer as F0Signer).backend.signLog }, sources: core.label });
  return { mint: r.mint, adopted: r.adopted ?? false, resumed: r.resumed };
}

async function webhook(body: Record<string, unknown>): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try { await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: "kruxa-watcher", ...body }), signal: AbortSignal.timeout(10_000) }); }
  catch (e) { log("warn", "webhook_failed", { error: String(e instanceof Error ? e.message : e) }); }
}

async function main(): Promise<void> {
  const raised = new Set<string>();
  const ports: WatcherPorts = {
    view, log,
    runCeremony: ceremonyFor,
    abortGenesis: async (id, reason) => { await new RealCore(await testnetAccount(), CORE).abortGenesis(id, reason); },
    recordExists: (id) => existsSync(recordFile(id)),
    alert: async (key, kind, detail) => { if (raised.has(key)) return; raised.add(key); log("error", "alert", { kind, key, ...detail }); await webhook({ kind, key, ...detail }); },
  };
  const w = newWatcher(ports, { dryRun: !SEND, all: env.WATCHER_ALL === "1", only: new Set((env.WATCHER_ONLY_LAUNCHES ?? "").split(",").filter(Boolean)), maxAttempts: Number(env.WATCHER_MAX_ATTEMPTS ?? 3), autoAbortF1: env.WATCHER_AUTO_ABORT_F1 === "1" });
  log("info", "start", { core: CORE, cluster: CLUSTER, dry_run: !SEND, once: ONCE });
  let stopping = false;
  for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stopping = true; });
  do {
    await watchOnce(w).catch((e) => log("error", "cycle_failed", { error: String(e instanceof Error ? e.message : e) }));
    if (!ONCE && !stopping) await new Promise((r) => setTimeout(r, INTERVAL));
  } while (!ONCE && !stopping);
}

main().catch((e) => { log("error", "fatal", { error: String(e instanceof Error ? e.message : e) }); process.exit(1); });
