import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { attemptRefused, runCeremony } from "./ceremony.js";
import { assertCluster, rpcFor, type Cluster } from "./cluster.js";
import { type CoreClient, StandaloneCore } from "./core.js";
import { RealCore } from "./realcore.js";
import { testnetAccount } from "./near.js";
import type { Leaf } from "./merkle.js";
import { F0Signer } from "./f0.js";
import { claimOnce } from "./claim.js";
import { holderLeaves, VERDICTS } from "./launches.js";
import { writeRecord } from "./record.js";
import { F1Signer, type GenesisSigner } from "./signer.js";
import { JITO_MAINNET } from "./solana-bytes.js";
import { mainnetGenesis } from "./genesis-mainnet.js";
import { type CeremonyGate, makeGate, readSettings } from "./mainnet-guard.js";
import { createVault, readOnChain } from "../../tools/squads/vault.js";

interface Args {
  launch: bigint; mode: "F1" | "F0"; cluster: Cluster; core?: string; record?: string; squadsMultisig?: string; squadsTimeLock?: number; holders: number; priorTx1?: string; holdersFile?: string;
}

const USAGE = "usage: genesis --launch N --mode F1|F0 [--cluster devnet|local|mainnet-beta] [--core ACCOUNT | (standalone)] [--squads-multisig PUBKEY | --squads-time-lock S] [--record FILE]";

function parseArgs(argv: string[]): Args {
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const known = new Set(["--launch", "--mode", "--cluster", "--core", "--record", "--squads-multisig", "--squads-time-lock", "--holders", "--prior-tx1", "--holders-file", "--expect-refused", "--rehearse-gate"]);
  const bad = argv.filter((a) => a.startsWith("--") && !known.has(a));
  const launch = get("--launch"), mode = get("--mode") ?? "F1", cluster = get("--cluster") ?? "devnet";
  if (!launch || !/^\d+$/.test(launch) || !["F1", "F0"].includes(mode) || !["devnet", "local", "mainnet-beta"].includes(cluster) || bad.length) {
    console.error(USAGE);
    process.exit(64);
  }
  const tl = get("--squads-time-lock");
  return { launch: BigInt(launch), mode: mode as Args["mode"], cluster: cluster as Cluster, core: get("--core"), record: get("--record"), squadsMultisig: get("--squads-multisig"), squadsTimeLock: tl ? Number(tl) : undefined, holders: Number(get("--holders") ?? 0), priorTx1: get("--prior-tx1"), holdersFile: get("--holders-file") };
}

function loadFunder(): Keypair {
  const p = process.env.KRUXA_RELAYER_KEY ?? `${homedir()}/.kruxa-secrets/genesis/relayer-devnet.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function makeFunder(conn: Connection, cluster: Cluster): Promise<Keypair> {
  if (cluster === "devnet") return loadFunder();
  if (cluster === "mainnet-beta") throw new Error("refusing: no airdrop funder on mainnet-beta");
  const kp = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 20_000_000_000), "confirmed");
  return kp;
}

const makeSigner = (mode: Args["mode"], launch: bigint, core?: string): Promise<GenesisSigner> | GenesisSigner => (mode === "F1" ? new F1Signer() : F0Signer.fromEnv(launch, core));

/** Local/devnet rehearsal of the mainnet confirmation gate: same plan, cap and typed-code flow, answered from the prompt. Never used on mainnet-beta. */
function rehearsalGate(): CeremonyGate {
  const env = { KRUXA_SOLANA_MAINNET_CONFIRMED: "I_CONFIRM_DAMI_RUNS_THIS", KRUXA_SOLANA_DRY_RUN: "0", KRUXA_SOLANA_SPEND_CAP_SOL: "0.05" };
  return makeGate(readSettings(env), env, async (q) => { console.log(q); return `MINT ${/MINT ([0-9A-F]{8})/.exec(q)?.[1] ?? ""}`; }, console.log);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.cluster === "mainnet-beta") return mainnetGenesis({ ...a, expectRefused: process.argv.includes("--expect-refused") });
  const conn = new Connection(rpcFor(a.cluster), "confirmed");
  await assertCluster(conn, a.cluster);
  console.log(`cluster: ${a.cluster} (${a.cluster === "local" ? "LOCAL validator, labelled rehearsal" : "devnet"}) mode: ${a.mode} launch: ${a.launch}`);
  const funder = await makeFunder(conn, a.cluster);
  const squads = a.squadsTimeLock === undefined ? undefined : await createVault(conn, funder, a.squadsTimeLock);
  const multisig = squads?.multisig.toBase58() ?? a.squadsMultisig;
  if (!multisig) { console.error("need --squads-multisig or --squads-time-lock\n" + USAGE); process.exit(64); }
  const metadataUri = `https://kruxa.example/rehearsal/${a.launch}.json`;
  const holders = Array.from({ length: a.holders }, (_, n) => ({ key: Keypair.generate(), amount: BigInt(n + 1) * 1_000_000n }));
  const leaves = holderLeaves(holders);
  const real = a.core ? new RealCore(await testnetAccount(), a.core) : undefined;
  const core: CoreClient = real ?? new StandaloneCore({ verdicts: VERDICTS, mode: a.mode, multisig: new PublicKey(multisig).toBytes(), reserveAmount: 50_000_000_000n, metadataUri, leaves });
  if (VERDICTS[a.launch.toString()] !== "PASS" && !real) { console.log(await attemptRefused(core, a.launch, conn, null)); return; }
  if (real && process.argv.includes("--expect-refused")) { console.log(await attemptRefused(core, a.launch, conn, null)); return; }
  const signer = await makeSigner(a.mode, a.launch, real ? a.core : undefined);
  const gPub = new PublicKey(signer.pub()).toBase58();
  const t0 = Date.now();
  const r = await runCeremony({ conn, cluster: a.cluster, core, signer, launchId: a.launch, funder, priceMicroLamports: 1000, jitoProgram: process.env.JITO_PROGRAM ?? JITO_MAINNET, metadataUri, priorTx1: a.priorTx1, log: console.log, gate: process.argv.includes("--rehearse-gate") ? rehearsalGate() : undefined });
  const v = r.view;
  console.log(`mint: ${r.mint}\nmint_authority: ${v.mintAuthority}\nfreeze_authority: ${v.freezeAuthority}\nextensions: ${v.space === 82 ? "none" : "PRESENT"}`);
  console.log(`g_lamports_after: ${await conn.getBalance(new PublicKey(gPub))}\nspace: ${v.space}\nowner: ${v.owner}\nsupply: ${v.supply} (sum of buckets: ${r.compiled.supply})`);
  console.log(`latency_ms: ${Date.now() - t0}\nsign_ms: ${r.timing.signMs.join(",")}`);
  console.log(`signed by ${a.mode === "F0" ? "derived key" : "per-launch key (destroyed)"} ${gPub}`);
  if (a.mode === "F0") for (const e of (signer as F0Signer).backend.signLog ?? []) console.log(`F0_SIGN ${JSON.stringify(e)}`);
  if (a.mode === "F0") console.log("signature verified against the derived key (offline, before broadcast)");
  console.log("confirm_genesis ok");
  const recLeaves: Leaf[] = real ? (await real.allocations(a.launch)).map(([k, amt]) => ({ claimant: Uint8Array.from(Buffer.from(k, "hex")), unlocked: BigInt(amt), locked: 0n })) : leaves;
  const claimers = a.holdersFile ? (JSON.parse(readFileSync(a.holdersFile, "utf8")) as number[][]).map((s) => Keypair.fromSecretKey(Uint8Array.from(s))) : holders.map((h) => h.key);
  if (claimers.length) await claimTest(conn, funder, claimers, recLeaves, r, a.launch);
  if (a.record) {
    const sq = await readOnChain(conn, new PublicKey(multisig));
    const f0 = signer.mode === "F0" ? (signer as F0Signer).backend.derivation : undefined;
    writeRecord(a.record, r, { cluster: a.cluster, mode: a.mode, launchId: a.launch, leaves: recLeaves, core: core.label, squads: { multisig, members: sq.members, threshold: sq.threshold, time_lock: sq.timeLock }, f0: f0 && { ...f0, sign_log: (signer as F0Signer).backend.signLog }, sources: core.label });
    console.log(`record: ${a.record}`);
  }
}

async function claimTest(conn: Connection, funder: Keypair, claimers: Keypair[], leaves: Leaf[], r: Awaited<ReturnType<typeof runCeremony>>, launch: bigint): Promise<void> {
  const [start] = r.compiled.timestamps;
  const waitMs = Number(start) * 1000 + 3000 - Date.now();
  if (waitMs > 0) await new Promise((res) => setTimeout(res, waitMs));
  const got = await claimOnce(conn, funder, claimers[0]!, leaves, new PublicKey(r.params.jitoProgram).toBase58(), new PublicKey(r.mint), new PublicKey(r.compiled.accounts.distributor), new PublicKey(r.compiled.accounts.vault), launch);
  console.log(`merkle root matches core\nclaim ok: ${got}\ndistributor admin: NULL`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
