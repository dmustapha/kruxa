import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { BaseFeeMode, CollectFeeMode } from "@meteora-ag/cp-amm-sdk";
import type { Network } from "./network.js";

export interface PoolProposalParams {
  network: Network;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  seedBase: BN;
  seedQuote: BN;
  /** Owner of the position NFT (Squads vault PDA in production). Also pays and signs as creator. */
  owner: PublicKey;
  payer: PublicKey;
  /** Mint of the position NFT. Its signer is supplied by the executor (keypair or Squads ephemeral signer). */
  positionNft: PublicKey;
  fee: SchedulerParams;
  /** Unix seconds; null means active at creation. */
  activationTimestamp: number | null;
  lockLiquidity: boolean;
}

export interface SchedulerParams {
  startBps: number;
  endBps: number;
  periods: number;
  durationSec: number;
  mode: BaseFeeMode.FeeTimeSchedulerLinear | BaseFeeMode.FeeTimeSchedulerExponential;
}

/** Quote-side fees only (fee mode OnlyB), so the token pays the creator in USDC and never dumps base. */
export const COLLECT_FEE_MODE = CollectFeeMode.OnlyB;

export const DEFAULT_SCHEDULER: SchedulerParams = {
  startBps: 1500,
  endBps: 100,
  periods: 15,
  durationSec: 900,
  mode: BaseFeeMode.FeeTimeSchedulerLinear,
};
