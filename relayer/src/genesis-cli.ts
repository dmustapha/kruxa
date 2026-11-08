import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimOnce } from "./claim.js";
import { assertCluster, rpcFor, type Cluster } from "./cluster.js";
import { attemptRefused, runCeremony } from "./ceremony.js";
import { MockCore } from "./core.js";
import { buildLaunchSpec, makeHolders, START_DELAY_SEC, VERDICTS } from "./launches.js";
import { F1Signer, type GenesisSigner } from "./signer.js";
import { JITO_MAINNET } from "./solana-bytes.js";

interface Args { launch: bigint; mode: "F1" | "F0"; cluster: Cluster; claimTest: boolean; reserveOwner?: string }

function parseArgs(argv: string[]): Args {
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const launch = get("--launch"), mode = get("--mode") ?? "F1", cluster = get("--cluster") ?? "devnet";
  const known = new Set(["--launch", "--mode", "--cluster", "--claim-test", "--reserve-owner"]);
  const bad = argv.filter((a) => a.startsWith("--") && !known.has(a));
  if (!launch || !/^\d+$/.test(launch) || !["F1", "F0"].includes(mode) || !["devnet", "local"].includes(cluster) || bad.length) {
    console.error("usage: genesis --launch N --mode F1|F0 [--cluster devnet|local] [--claim-test] [--reserve-owner PUBKEY]");
    process.exit(64);
  }
  return { launch: BigInt(launch), mode: mode as Args["mode"], cluster: cluster as Cluster, claimTest: argv.includes("--claim-test"), reserveOwner: get("--reserve-owner") };
}

function loadFunder(): Keypair {
  const p = process.env.KRUXA_RELAYER_KEY ?? `${homedir()}/.kruxa-secrets/genesis/relayer-devnet.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function makeFunder(conn: Connection, cluster: Cluster): Promise<Keypair> {
  if (cluster === "devnet") return loadFunder();
  const kp = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 20_000_000_000), "confirmed");
  return kp;
}

async function makeSigner(mode: Args["mode"], launch: bigint): Promise<GenesisSigner> {
  if (mode === "F1") return new F1Signer();
  const { F0Signer } = await import("./f0.js");
  return F0Signer.fromEnv(launch);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const conn = new Connection(rpcFor(a.cluster), "confirmed");
  await assertCluster(conn, a.cluster);
  console.log(`cluster: ${a.cluster} (${a.cluster === "local" ? "LOCAL validator, labelled rehearsal" : "devnet"}) mode: ${a.mode} launch: ${a.launch}`);
  const core = new MockCore(VERDICTS);
  if (VERDICTS[a.launch.toString()] !== "PASS") {
    console.log(await attemptRefused(core, a.launch, conn, null));
    return;
  }
  const jito = process.env.JITO_PROGRAM ?? JITO_MAINNET;
  const holders = makeHolders();
  const funder = await makeFunder(conn, a.cluster);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const t0 = Date.now();
  const specTimeMs = Number(nowSec) * 1000;
  const signer = await makeSigner(a.mode, a.launch);
  const gPub = new PublicKey(signer.pub()).toBase58();
  const r = await runCeremony({
    conn, cluster: a.cluster, core, signer, funder, priceMicroLamports: 1000, fundLamports: 40_000_000, log: console.log,
    buildSpec: (g) => buildLaunchSpec(a.launch, g, holders, { jitoProgram: jito, reserveOwner: a.reserveOwner, nowSec }),
  });
  const v = r.view;
  console.log(`mint: ${r.mint}\nmint_authority: ${v.mintAuthority}\nfreeze_authority: ${v.freezeAuthority}\nextensions: ${v.space === 82 ? "none" : "PRESENT"}`);
  console.log(`space: ${v.space}\nowner: ${v.owner}\nsupply: ${v.supply} (sum of buckets: ${r.compiled.supply})\nlatency_ms: ${Date.now() - t0}`);
  console.log(`signed by ${a.mode === "F0" ? "derived key" : "per-launch key (destroyed)"} ${gPub}`);
  console.log("confirm_genesis ok");
  if (a.claimTest) await claimTest(conn, funder, holders, jito, r.compiled, r.mint, a.launch, specTimeMs);
}

async function claimTest(conn: Connection, funder: Keypair, h: ReturnType<typeof makeHolders>, jito: string,
  c: Awaited<ReturnType<typeof runCeremony>>["compiled"], mint: string, launch: bigint, startedAt: number): Promise<void> {
  console.log("merkle root matches core");
  const waitMs = Number(START_DELAY_SEC + 3n) * 1000 - (Date.now() - startedAt);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const got = await claimOnce(conn, funder, h.test, h.leaves, jito, new PublicKey(mint), new PublicKey(c.accounts.distributor), new PublicKey(c.accounts.vault), launch);
  console.log(`claim ok: ${got}`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
