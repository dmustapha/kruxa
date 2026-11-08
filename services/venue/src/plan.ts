import { BorshInstructionCoder } from "@coral-xyz/anchor";
import {
  CP_AMM_PROGRAM_ID,
  CpAmm,
  CpAmmIdl,
  ActivationType,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  getBaseFeeParams,
  deriveCustomizablePoolAddress,
  derivePositionAddress,
  derivePositionNftAccount,
} from "@meteora-ag/cp-amm-sdk";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import BN from "bn.js";
import { COLLECT_FEE_MODE, type PoolProposalParams } from "./params.js";

export interface PlanInstruction {
  label: string;
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  dataBase64: string;
}

export interface PoolPlan {
  schema: "kruxa-venue/pool-plan/1";
  network: string;
  programId: string;
  pool: string;
  position: string;
  positionNftMint: string;
  positionNftAccount: string;
  tokenAMint: string;
  tokenBMint: string;
  baseMint: string;
  quoteMint: string;
  amounts: { tokenA: string; tokenB: string };
  feeMode: "OnlyB";
  baseFee: { startBps: number; endBps: number; periods: number; durationSec: number; mode: string };
  lockLiquidity: boolean;
  owner: string;
  payer: string;
  requiredSigners: { pubkey: string; role: string }[];
  instructions: PlanInstruction[];
  unsignedTransactionBase64: string;
  notes: string[];
}

const coder = new BorshInstructionCoder(CpAmmIdl as never);

function labelFor(ix: TransactionInstruction): string {
  if (ix.programId.equals(CP_AMM_PROGRAM_ID)) return coder.decode(ix.data)?.name ?? "cp_amm:unknown";
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return "create_associated_token_account";
  return ix.programId.toBase58();
}

function toPlanInstruction(ix: TransactionInstruction): PlanInstruction {
  return {
    label: labelFor(ix),
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    dataBase64: ix.data.toString("base64"),
  };
}

/** Plain SPL only: classic token program, and the base mint must have no mint or freeze authority. */
export async function assertMintsAcceptable(c: Connection, p: PoolProposalParams): Promise<void> {
  const base = await getMint(c, p.baseMint, "confirmed", TOKEN_PROGRAM_ID);
  if (base.mintAuthority !== null || base.freezeAuthority !== null) {
    throw new Error("refused: base mint must have null mint and freeze authority");
  }
  await getMint(c, p.quoteMint, "confirmed", TOKEN_PROGRAM_ID);
}

function feeParams(p: PoolProposalParams) {
  const f = p.fee;
  return getBaseFeeParams({
    baseFeeMode: f.mode,
    feeTimeSchedulerParam: {
      startingFeeBps: f.startBps,
      endingFeeBps: f.endBps,
      numberOfPeriod: f.periods,
      totalDuration: f.durationSec,
    },
  });
}

export async function buildPoolPlan(connection: Connection, p: PoolProposalParams): Promise<PoolPlan> {
  await assertMintsAcceptable(connection, p);
  // OnlyB collects fees in token B. The pool PDA seeds are order-independent, so quote is always B.
  const [tokenAMint, tokenBMint] = [p.baseMint, p.quoteMint];
  const [tokenAAmount, tokenBAmount] = [p.seedBase, p.seedQuote];
  const cpAmm = new CpAmm(connection);
  const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
    tokenAAmount,
    tokenBAmount,
    minSqrtPrice: MIN_SQRT_PRICE,
    maxSqrtPrice: MAX_SQRT_PRICE,
    collectFeeMode: COLLECT_FEE_MODE,
  });
  const { tx, pool, position } = await cpAmm.createCustomPool({
    payer: p.payer,
    creator: p.owner,
    positionNft: p.positionNft,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta,
    initSqrtPrice,
    poolFees: { baseFee: feeParams(p), compoundingFeeBps: 0, padding: 0, dynamicFee: null },
    hasAlphaVault: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: COLLECT_FEE_MODE,
    activationPoint: p.activationTimestamp === null ? null : new BN(p.activationTimestamp),
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: p.lockLiquidity,
  });
  return finalize(connection, p, { tx, pool, position, tokenAMint, tokenBMint, tokenAAmount, tokenBAmount });
}

interface Built {
  tx: Transaction;
  pool: PublicKey;
  position: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAAmount: BN;
  tokenBAmount: BN;
}

async function finalize(connection: Connection, p: PoolProposalParams, b: Built): Promise<PoolPlan> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  b.tx.feePayer = p.payer;
  b.tx.recentBlockhash = blockhash;
  const signers = [{ pubkey: p.payer.toBase58(), role: "payer and creator (vault in production)" }];
  if (!p.owner.equals(p.payer)) signers.push({ pubkey: p.owner.toBase58(), role: "creator and position owner" });
  signers.push({ pubkey: p.positionNft.toBase58(), role: "position NFT mint (keypair or Squads ephemeral signer)" });
  return {
    schema: "kruxa-venue/pool-plan/1",
    network: p.network,
    programId: CP_AMM_PROGRAM_ID.toBase58(),
    pool: b.pool.toBase58(),
    position: b.position.toBase58(),
    positionNftMint: p.positionNft.toBase58(),
    positionNftAccount: derivePositionNftAccount(p.positionNft).toBase58(),
    tokenAMint: b.tokenAMint.toBase58(),
    tokenBMint: b.tokenBMint.toBase58(),
    baseMint: p.baseMint.toBase58(),
    quoteMint: p.quoteMint.toBase58(),
    amounts: { tokenA: b.tokenAAmount.toString(), tokenB: b.tokenBAmount.toString() },
    feeMode: "OnlyB",
    baseFee: { ...p.fee, mode: String(p.fee.mode) },
    lockLiquidity: p.lockLiquidity,
    owner: p.owner.toBase58(),
    payer: p.payer.toBase58(),
    requiredSigners: signers,
    instructions: b.tx.instructions.map(toPlanInstruction),
    unsignedTransactionBase64: b.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    notes: [
      "Unsigned plan. This tool never signs or sends.",
      "Fee mode OnlyB: trading fees accrue in the quote token (token B).",
      "The blockhash in unsignedTransactionBase64 is informational; a Squads proposal uses the instruction list.",
    ],
  };
}

export { deriveCustomizablePoolAddress, derivePositionAddress };

/** Rehydrates the JSON plan into web3.js instructions (for a Squads vault message or a test run). */
export function planToInstructions(plan: PoolPlan): TransactionInstruction[] {
  return plan.instructions.map(
    (i) =>
      new TransactionInstruction({
        programId: new PublicKey(i.programId),
        keys: i.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(i.dataBase64, "base64"),
      }),
  );
}
