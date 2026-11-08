import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage, type TransactionInstruction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { createAssociatedTokenAccountIdempotent, getAccount, getAssociatedTokenAddressSync, transfer, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { CpAmm, derivePositionNftAccount } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { buildPoolPlan, planToInstructions } from "../../../services/venue/src/plan.js";
import type { PoolProposalParams } from "../../../services/venue/src/params.js";
import { pk, send, sol, type State } from "./lib.js";

const TIME_LOCK_SEC = 20;

export interface Ctx {
  connection: Connection;
  payer: Keypair;
  state: State;
  row: (id: string, ok: boolean, sigs: string[], detail: string) => void;
  cpAmm: CpAmm;
  newBaseMint: (tag: string) => Promise<PublicKey>;
  params: (base: PublicKey, owner: PublicKey, nft: PublicKey, seedBase?: BN) => PoolProposalParams;
  swapQuoteIn: (pool: PublicKey, amountIn: BN) => Promise<string>;
}

async function createMultisig(ctx: Ctx): Promise<PublicKey> {
  const { connection, payer } = ctx;
  const createKey = Keypair.generate();
  const [msPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const cfg = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, multisig.getProgramConfigPda({})[0]);
  const ix = multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey, creator: payer.publicKey, multisigPda: msPda, configAuthority: null, threshold: 1,
    members: [{ key: payer.publicKey, permissions: multisig.types.Permissions.all() }], timeLock: TIME_LOCK_SEC,
    treasury: cfg.treasury, rentCollector: null,
  });
  const sig = await send(connection, new Transaction().add(ix), [payer, createKey]);
  ctx.state.vars.multisig = msPda.toBase58();
  ctx.row("c0-squads-multisig", true, [sig], `1-of-1 multisig ${msPda.toBase58()} timeLock ${TIME_LOCK_SEC}s, vault ${multisig.getVaultPda({ multisigPda: msPda, index: 0 })[0].toBase58()}`);
  return msPda;
}

async function proposeAndApprove(ctx: Ctx, ms: PublicKey, idx: bigint, ixs: TransactionInstruction[], ephemeral: number): Promise<string[]> {
  const { connection, payer } = ctx;
  const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: ixs });
  const create = multisig.instructions.vaultTransactionCreate({
    multisigPda: ms, transactionIndex: idx, creator: payer.publicKey, vaultIndex: 0, ephemeralSigners: ephemeral, transactionMessage: message,
  });
  const prop = multisig.instructions.proposalCreate({ multisigPda: ms, transactionIndex: idx, creator: payer.publicKey });
  const s1 = await send(connection, new Transaction().add(create, prop), [payer]);
  const s2 = await send(connection, new Transaction().add(multisig.instructions.proposalApprove({ multisigPda: ms, transactionIndex: idx, member: payer.publicKey })), [payer]);
  return [s1, s2];
}

async function execute(ctx: Ctx, ms: PublicKey, idx: bigint): Promise<string> {
  const { connection, payer } = ctx;
  const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
    connection, multisigPda: ms, transactionIndex: idx, member: payer.publicKey,
  });
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), instruction] }).compileToV0Message(lookupTableAccounts);
  const { VersionedTransaction } = await import("@solana/web3.js");
  const vtx = new VersionedTransaction(msg);
  vtx.sign([payer]);
  const sig = await connection.sendTransaction(vtx);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function fundVault(ctx: Ctx, vault: PublicKey): Promise<void> {
  const { connection, payer, state } = ctx;
  await send(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: Number(process.env.VAULT_FUND_SOL ?? "0.25") * LAMPORTS_PER_SOL })), [payer]);
  for (const mint of [pk(state.vars.base2), pk(state.vars.quote)]) {
    const to = await createAssociatedTokenAccountIdempotent(connection, payer, mint, vault, undefined, TOKEN_PROGRAM_ID, undefined, true);
    const from = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const amount = mint.equals(pk(state.vars.quote)) ? 10_000_000_000n : 10_000_000_000_000n;
    await transfer(connection, payer, from, to, payer, amount);
  }
}

export async function squadsVaultFlow(ctx: Ctx): Promise<void> {
  const { connection, state, row, cpAmm } = ctx;
  if (state.rows.some((r) => r.id === "c-vault-claims-fees")) return;
  const ms = await createMultisig(ctx);
  const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
  await fundVault(ctx, vault);
  const idx = 1n;
  const [txPda] = multisig.getTransactionPda({ multisigPda: ms, index: idx });
  const [ephemeral] = multisig.getEphemeralSignerPda({ transactionPda: txPda, ephemeralSignerIndex: 0 });
  const before = await connection.getBalance(vault);
  const plan = await buildPoolPlan(connection, ctx.params(pk(state.vars.base2), vault, ephemeral));
  const sigs = await proposeAndApprove(ctx, ms, idx, planToInstructions(plan), 1);
  const early = await execute(ctx, ms, idx).then(() => "executed early", (e: Error) => `rejected${/TimeLock/i.test(e.message) ? " (TimeLockNotReleased)" : ": " + e.message.slice(0, 120)}`);
  await new Promise((r) => setTimeout(r, (TIME_LOCK_SEC + 4) * 1000));
  const execSig = await execute(ctx, ms, idx);
  const cost = before - (await connection.getBalance(vault));
  const pos = await cpAmm.fetchPositionState(pk(plan.position));
  const nftAcct = await getAccount(connection, derivePositionNftAccount(pos.nftMint), "confirmed", TOKEN_2022_PROGRAM_ID);
  Object.assign(state.vars, { pool2: plan.pool, pos2: plan.position });
  row("c-vault-creates-and-locks", nftAcct.owner.equals(vault) && !pos.permanentLockedLiquidity.isZero(), [...sigs, execSig],
    `kruxa-venue plan executed as Squads vault tx (ephemeral signer for NFT); NFT owner=${nftAcct.owner.toBase58()} (vault); locked=${pos.permanentLockedLiquidity}; early execute: ${early}; pool cost from vault ${sol(cost)} SOL`);
  await vaultClaim(ctx, ms, vault, plan.pool, plan.position, pos.nftMint);
}

async function vaultClaim(ctx: Ctx, ms: PublicKey, vault: PublicKey, pool: string, position: string, nftMint: PublicKey): Promise<void> {
  const { connection, state, row, cpAmm } = ctx;
  const swapSig = await ctx.swapQuoteIn(pk(pool), new BN(1_000_000));
  const ps = await cpAmm.fetchPoolState(pk(pool));
  const claimTx = await cpAmm.claimPositionFee({
    owner: vault, position: pk(position), pool: pk(pool), positionNftAccount: derivePositionNftAccount(nftMint),
    tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
    tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, receiver: vault, feePayer: vault,
  });
  const vq = getAssociatedTokenAddressSync(pk(state.vars.quote), vault, true);
  const before = (await getAccount(connection, vq)).amount;
  const idx = 2n;
  const sigs = await proposeAndApprove(ctx, ms, idx, claimTx.instructions, 0);
  await new Promise((r) => setTimeout(r, (TIME_LOCK_SEC + 4) * 1000));
  const execSig = await execute(ctx, ms, idx);
  const gained = (await getAccount(connection, vq)).amount - before;
  row("c-vault-claims-fees", gained > 0n, [swapSig, ...sigs, execSig], `Squads-vault-owned permanently locked position claimed ${gained} raw quote to the vault ATA via a vault transaction`);
}
