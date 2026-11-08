import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { PRODUCTION_TIME_LOCK, connect, createVault, funderFor, parseCluster, parseTimeLock, readOnChain } from "./vault.js";

/** npx tsx tools/squads/create-vault.ts --cluster devnet|local --time-lock SECONDS */
async function main(): Promise<void> {
  const cluster = parseCluster(process.argv), timeLock = parseTimeLock(process.argv);
  const conn = await connect(cluster);
  const v = await createVault(conn, await funderFor(conn, cluster), timeLock);
  const chain = await readOnChain(conn, v.multisig);
  console.log(`cluster: ${cluster}`);
  console.log(`multisig PDA: ${v.multisig.toBase58()}`);
  console.log(`vault PDA (index 0, reserve owner): ${v.vault.toBase58()}`);
  console.log(`members (software test keys, single-party demo): ${chain.members.join(",")}`);
  console.log(`threshold: ${chain.threshold} time_lock: ${chain.timeLock}`);
  if (timeLock === PRODUCTION_TIME_LOCK) console.log(`production time lock set: ${PRODUCTION_TIME_LOCK}`);
  else console.log(`REHEARSAL time lock ${timeLock}s (production is ${PRODUCTION_TIME_LOCK}s = 48 h, NOT shortened)`);
  if (cluster === "devnet") {
    const dir = `${homedir()}/.kruxa-secrets/genesis`;
    if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700, recursive: true });
    const f = `${dir}/squads-${v.multisig.toBase58()}.json`;
    writeFileSync(f, JSON.stringify(v.members.map((m) => Array.from(m.secretKey))), { mode: 0o600 });
    chmodSync(f, 0o600);
  }
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
