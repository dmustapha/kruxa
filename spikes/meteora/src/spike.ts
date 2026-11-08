import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AuthorityType, TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccountIdempotent, getAccount,
  getAssociatedTokenAddressSync, mintTo, setAuthority,
} from "@solana/spl-token";
import { CpAmm, SwapMode, derivePositionNftAccount } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { buildPoolPlan, planToInstructions } from "../../../services/venue/src/plan.js";
import { DEFAULT_SCHEDULER, type PoolProposalParams, type SchedulerParams } from "../../../services/venue/src/params.js";
import { BaseFeeMode } from "@meteora-ag/cp-amm-sdk";
import { RPC, loadKeypair, loadState, saveState, send, sol, pk, type Net, type State } from "./lib.js";
import { squadsVaultFlow } from "./squads.js";

const net = (process.argv[2] ?? "devnet") as Net;
const connection = new Connection(RPC[net], "confirmed");
const payer = loadKeypair("spike-devnet.json");
const state: State = loadState(net);
const cpAmm = new CpAmm(connection);
const SEED_BASE = new BN("1000000000000"); // 1,000,000 tokens at 6 decimals
const SEED_QUOTE = new BN("1000000000"); // 1,000 test USDC at 6 decimals
const FEE: SchedulerParams = { ...DEFAULT_SCHEDULER, startBps: 1500, endBps: 100, periods: 6, durationSec: 60, mode: BaseFeeMode.FeeTimeSchedulerLinear };

async function balance(): Promise<number> { return connection.getBalance(payer.publicKey); }

function row(id: string, ok: boolean, sigs: string[], detail: string): void {
  state.rows = state.rows.filter((r) => r.id !== id).concat({ id, ok, sigs, detail });
  saveState(net, state);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${sigs.join(",")} ${detail}`);
}

export async function newBaseMint(tag: string): Promise<PublicKey> {
  const mint = await createMint(connection, payer, payer.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);
  const ata = await createAssociatedTokenAccountIdempotent(connection, payer, mint, payer.publicKey);
  await mintTo(connection, payer, mint, ata, payer, BigInt("1000000000000000"));
  await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null);
  state.vars[tag] = mint.toBase58();
  saveState(net, state);
  return mint;
}

async function setup(): Promise<void> {
  if (state.vars.quote) return;
  const quote = await createMint(connection, payer, payer.publicKey, null, 6);
  const ata = await createAssociatedTokenAccountIdempotent(connection, payer, quote, payer.publicKey);
  await mintTo(connection, payer, quote, ata, payer, BigInt("100000000000"));
  state.vars.quote = quote.toBase58();
  await newBaseMint("base1");
  await newBaseMint("base2");
  saveState(net, state);
}

export function params(base: PublicKey, owner: PublicKey, nft: PublicKey, seedBase = SEED_BASE): PoolProposalParams {
  return { network: net === "devnet" ? "devnet" : "localnet", baseMint: base, quoteMint: pk(state.vars.quote), seedBase,
    seedQuote: SEED_QUOTE, owner, payer: owner, positionNft: nft, fee: FEE, activationTimestamp: null, lockLiquidity: true };
}

async function createPool1(): Promise<void> {
  if (state.vars.pool1) return;
  const nft = Keypair.generate();
  const before = await balance();
  const plan = await buildPoolPlan(connection, params(pk(state.vars.base1), payer.publicKey, nft.publicKey));
  const tx = new Transaction().add(...planToInstructions(plan));
  const sig = await send(connection, tx, [payer, nft]);
  const cost = before - (await balance());
  Object.assign(state.vars, { pool1: plan.pool, pos1: plan.position, nft1: nft.publicKey.toBase58() });
  const ps = await cpAmm.fetchPoolState(pk(plan.pool));
  const pos = await cpAmm.fetchPositionState(pk(plan.position));
  const locked = !pos.permanentLockedLiquidity.isZero();
  row("a-create-pool-external-mint", true, [sig], `plain SPL base ${state.vars.base1} (mint+freeze auth null), test USDC; collectFeeMode=${ps.collectFeeMode}`);
  row("b-permanent-lock", locked, [sig], `permanentLockedLiquidity=${pos.permanentLockedLiquidity.toString()} in same tx as create`);
  const pf = ps.poolFees as unknown as Record<string, unknown>;
  row("dm4-protocol-fee", Number(pf.protocolFeePercent) === 20, [sig], `pool.poolFees.protocolFeePercent=${String(pf.protocolFeePercent)} (read from created pool; fixed by program, not set by creator)`);
  row("f-cost-pool1", true, [sig], `payer balance delta ${sol(cost)} SOL (tx fee, pool, position, vaults, NFT rent; ATAs pre-existed)`);
}

async function swapQuoteIn(pool: PublicKey, amountIn: BN): Promise<string> {
  const ps = await cpAmm.fetchPoolState(pool);
  const tx = await cpAmm.swap2({
    payer: payer.publicKey, pool, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0),
    inputTokenMint: ps.tokenBMint, outputTokenMint: ps.tokenAMint, tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint,
    tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
    referralTokenAccount: null,
  });
  return send(connection, tx, [payer]);
}

async function quoteBalance(owner: PublicKey): Promise<bigint> {
  return (await getAccount(connection, getAssociatedTokenAddressSync(pk(state.vars.quote), owner, true))).amount;
}

async function claim(pool: PublicKey, position: PublicKey, signer: Keypair): Promise<{ sig: string; gained: bigint }> {
  const ps = await cpAmm.fetchPoolState(pool);
  const nftMint = (await cpAmm.fetchPositionState(position)).nftMint;
  const before = await quoteBalance(signer.publicKey).catch(() => 0n);
  const tx = await cpAmm.claimPositionFee({
    owner: signer.publicKey, position, pool, positionNftAccount: derivePositionNftAccount(nftMint),
    tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
    tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, receiver: signer.publicKey, feePayer: signer.publicKey,
  });
  const sig = await send(connection, tx, [signer]);
  return { sig, gained: (await quoteBalance(signer.publicKey)) - before };
}

async function feesAndScheduler(): Promise<void> {
  if (state.rows.some((r) => r.id === "e-fee-scheduler")) return;
  const pool = pk(state.vars.pool1), position = pk(state.vars.pos1);
  const amt = new BN(1_000_000);
  const s1 = await swapQuoteIn(pool, amt);
  const c1 = await claim(pool, position, payer);
  row("b-fee-claim-locked-position", c1.gained > 0n, [s1, c1.sig], `keypair owner claimed ${c1.gained} raw quote after 1 swap on a permanently locked position`);
  await new Promise((r) => setTimeout(r, (FEE.durationSec + 8) * 1000));
  const s2 = await swapQuoteIn(pool, amt);
  const c2 = await claim(pool, position, payer);
  const ratio = Number(c1.gained) / Math.max(1, Number(c2.gained));
  row("e-fee-scheduler", c2.gained > 0n && c1.gained > c2.gained, [s1, c1.sig, s2, c2.sig],
    `1 USDC swap at t0 yielded ${c1.gained} LP fee, same swap after ${FEE.durationSec}s yielded ${c2.gained}; ratio ${ratio.toFixed(1)} (schedule ${FEE.startBps} to ${FEE.endBps} bps over ${FEE.periods} periods, linear)`);
}

async function splitFlow(): Promise<void> {
  if (state.rows.some((r) => r.id === "d-two-owner-split")) return;
  const owner2 = Keypair.generate();
  await send(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner2.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })), [payer]);
  const nft2 = Keypair.generate();
  const pool = pk(state.vars.pool1), pos1 = pk(state.vars.pos1);
  const mk = await cpAmm.createPosition({ owner: owner2.publicKey, payer: payer.publicKey, pool, positionNft: nft2.publicKey });
  const sig1 = await send(connection, mk, [payer, nft2]);
  const pos2 = (await import("@meteora-ag/cp-amm-sdk")).derivePositionAddress(nft2.publicKey);
  const sp = await cpAmm.splitPosition2({
    firstPositionOwner: payer.publicKey, secondPositionOwner: owner2.publicKey, pool,
    firstPosition: pos1, firstPositionNftAccount: derivePositionNftAccount(pk(state.vars.nft1)),
    secondPosition: pos2, secondPositionNftAccount: derivePositionNftAccount(nft2.publicKey), numerator: 500_000_000,
  });
  const sig2 = await send(connection, sp, [payer, owner2]);
  const p2 = await cpAmm.fetchPositionState(pos2);
  await swapQuoteIn(pool, new BN(1_000_000));
  await createAssociatedTokenAccountIdempotent(connection, payer, pk(state.vars.quote), owner2.publicKey);
  const c = await claim(pool, pos2, owner2).catch((e: Error) => ({ sig: "", gained: -1n, err: e.message }));
  state.vars.owner2 = owner2.publicKey.toBase58();
  row("d-two-owner-split", !p2.permanentLockedLiquidity.isZero() && c.gained > 0n, [sig1, sig2, c.sig],
    `split_position2 numerator 50% of a permanently LOCKED position to a second owner ${owner2.publicKey.toBase58()}: second position lockedLiquidity=${p2.permanentLockedLiquidity}; second owner claim gained ${c.gained}`);
}

async function main(): Promise<void> {
  const start = await balance();
  console.log(`net=${net} payer=${payer.publicKey.toBase58()} balance=${sol(start)} SOL`);
  await setup();
  await createPool1();
  await feesAndScheduler();
  await splitFlow();
  await squadsVaultFlow({ connection, payer, state, row, cpAmm, newBaseMint, params, swapQuoteIn });
  console.log(`spent ${sol(start - (await balance()))} SOL total`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; });
