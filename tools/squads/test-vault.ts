import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionMessage, sendAndConfirmTransaction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { PRODUCTION_TIME_LOCK, connect, createVault, funderFor, lamportsTransfer, parseCluster, readOnChain } from "./vault.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Proposal path: create transfer, 2 approvals, execute early (must fail), wait out the delay, execute (must succeed). */
async function main(): Promise<void> {
  const cluster = parseCluster(process.argv);
  const i = process.argv.indexOf("--time-lock");
  const timeLock = i >= 0 ? Number(process.argv[i + 1]) : 60;
  if (timeLock >= PRODUCTION_TIME_LOCK) { console.error("test-vault waits out the delay; use a short rehearsal --time-lock"); process.exit(64); }
  const conn = await connect(cluster);
  const funder = await funderFor(conn, cluster);
  const v = await createVault(conn, funder, timeLock);
  const chain = await readOnChain(conn, v.multisig);
  console.log(`multisig PDA: ${v.multisig.toBase58()} threshold ${chain.threshold} time_lock ${chain.timeLock} (REHEARSAL, production ${PRODUCTION_TIME_LOCK})`);
  await sendAndConfirmTransaction(conn, new Transaction().add(lamportsTransfer(funder.publicKey, v.vault, 0.05 * LAMPORTS_PER_SOL)), [funder]);
  const [m0, m1] = [v.members[0]!, v.members[1]!];
  await sendAndConfirmTransaction(conn, new Transaction().add(lamportsTransfer(funder.publicKey, m0.publicKey, 10_000_000), lamportsTransfer(funder.publicKey, m1.publicKey, 3_000_000)), [funder]);
  const dest = Keypair.generate().publicKey;
  const txIndex = 1n;
  const msg = new TransactionMessage({ payerKey: v.vault, recentBlockhash: (await conn.getLatestBlockhash()).blockhash, instructions: [lamportsTransfer(v.vault, dest, 1_000_000)] });
  const send = (ixs: Parameters<Transaction["add"]>, signers: Keypair[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers);
  await send([multisig.instructions.vaultTransactionCreate({ multisigPda: v.multisig, transactionIndex: txIndex, creator: m0.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage: msg })], [funder, m0].filter((k, n, a) => a.indexOf(k) === n));
  await send([multisig.instructions.proposalCreate({ multisigPda: v.multisig, transactionIndex: txIndex, creator: m0.publicKey })], [funder, m0]);
  await send([multisig.instructions.proposalApprove({ multisigPda: v.multisig, transactionIndex: txIndex, member: m0.publicKey })], [funder, m0]);
  await send([multisig.instructions.proposalApprove({ multisigPda: v.multisig, transactionIndex: txIndex, member: m1.publicKey })], [funder, m1]);
  const exec = async () => multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: v.multisig, transactionIndex: txIndex, member: m0.publicKey });
  const t0 = Date.now();
  try {
    await send([(await exec()).instruction], [funder, m0]);
    throw new Error("EARLY EXECUTION SUCCEEDED (time lock not enforced)");
  } catch (e) {
    const text = String(e instanceof Error ? e.message + (e as { logs?: string[] }).logs?.join(" ") : e);
    if (text.includes("EARLY EXECUTION")) throw e;
    console.log(`early execute refused after approval (t+${Math.round((Date.now() - t0) / 1000)}s): ${/TimeLock/i.test(text) ? "TimeLockNotReleased" : text.slice(0, 120)}`);
  }
  const waitMs = timeLock * 1000 + 4000 - (Date.now() - t0);
  if (waitMs > 0) await sleep(waitMs);
  await send([(await exec()).instruction], [funder, m0]);
  const got = await conn.getBalance(new PublicKey(dest));
  console.log(`execute after delay ok: destination received ${got} lamports`);
  if (got !== 1_000_000) throw new Error("transfer amount mismatch");
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
