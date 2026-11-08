// Transaction builders for the core contract and USDC. Pure: they return the string-only `SignAndSendInput` the wallet barrel
// signs. Nothing here signs, sends or reads a wallet. Gas and deposits follow USER-ONBOARDING (commit: 1 yocto, at least 50 Tgas).
import { CONFIG } from './config';
import type { SignAndSendInput } from './wallet/index';

const tgas = (t: number): string => (BigInt(t) * 10n ** 12n).toString();
const fc = (receiverId: string, methodName: string, args: Record<string, unknown>, gasT: number, deposit: string): SignAndSendInput => ({
  receiverId,
  actions: [{ type: 'FunctionCall', params: { methodName, args, gas: tgas(gasT), deposit } }],
});

/** Storage registration of an account on the launch token (NEP-145). Claiming tokens needs it first. */
export const STORAGE_DEPOSIT_YOCTO = '1250000000000000000000'; // 0.00125 NEAR

export const commitNear = (launchId: string, amountMicro: bigint): SignAndSendInput =>
  fc(CONFIG.usdc, 'ft_transfer_call', {
    receiver_id: CONFIG.core, amount: amountMicro.toString(), msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: launchId }),
  }, 100, '1');

export const walkNear = (launchId: string): SignAndSendInput => fc(CONFIG.core, 'walk', { launch_id: launchId }, 100, '1');
export const settleNear = (launchId: string): SignAndSendInput => fc(CONFIG.core, 'settle', { launch_id: launchId }, 150, '0');
export const claimRefundNear = (launchId: string): SignAndSendInput => fc(CONFIG.core, 'claim_refund', { launch_id: launchId, holder: null }, 100, '0');
export const claimTokensNear = (launchId: string): SignAndSendInput => fc(CONFIG.core, 'claim_tokens', { launch_id: launchId }, 100, '1');
export const registerOnToken = (tokenAccount: string, accountId: string): SignAndSendInput =>
  fc(tokenAccount, 'storage_deposit', { account_id: accountId, registration_only: true }, 30, STORAGE_DEPOSIT_YOCTO);
/** Draw from the stream. `amount` null asks for everything drawable; anything above the cap reverts with STREAM_CAP. */
export const drawStream = (launchId: string, amountMicro: bigint | null): SignAndSendInput =>
  fc(CONFIG.core, 'draw', { launch_id: launchId, amount: amountMicro === null ? null : amountMicro.toString() }, 100, '0');

export interface CreateArgs { params: Record<string, unknown>; streamRecipient: string | null; depositYocto: string }
export const createTrialNear = (a: CreateArgs): SignAndSendInput =>
  fc(CONFIG.core, 'create_trial', { params: a.params, stream_recipient: a.streamRecipient }, 300, a.depositYocto);

export const nearCliCommand = (receiver: string, method: string, args: Record<string, unknown>): string =>
  `near call ${receiver} ${method} '${JSON.stringify(args)}' --accountId <your-account> --networkId ${CONFIG.network}`;

/** Creator trading-fee claim on the market contract (payout recipient only; pull based; minimum 1 USDC). */
export const claimMarketFees = (launchId: string): SignAndSendInput => fc(CONFIG.market, 'claim', { launch_id: launchId }, 100, '0');

// ---- instant launcher (docs/interfaces/INSTANT-ABI.md) ----
export const createInstantNear = (params: Record<string, unknown>, payoutRecipient: string | null, depositYocto: string): SignAndSendInput =>
  fc(CONFIG.instant, 'create_instant', { params, payout_recipient: payoutRecipient }, 300, depositYocto);
/** Step 2: the creator's exact USDC seed, sent to the launcher with the seed_instant message. */
export const seedInstantNear = (launchId: string, seedMicro: bigint): SignAndSendInput =>
  fc(CONFIG.usdc, 'ft_transfer_call', { receiver_id: CONFIG.instant, amount: seedMicro.toString(), msg: JSON.stringify({ v: 1, op: 'seed_instant', launch_id: launchId }) }, 100, '1');
/** Step 3 (any caller): hands the seed, then the pool bucket, to the market. A retry sends only what is missing. */
/** Gas attached to open_instant, in Tgas. The launcher's measured minimum is being set; the app attaches this and shows it. */
export const OPEN_INSTANT_GAS_TGAS = 300;
export const openInstantNear = (launchId: string): SignAndSendInput => fc(CONFIG.instant, 'open_instant', { launch_id: launchId }, OPEN_INSTANT_GAS_TGAS, '0');
/** Ends an unseeded launch: the creator at any time, anyone else after one unit. (The contract has no `cancel_instant`.) */
export const abandonInstantNear = (launchId: string): SignAndSendInput => fc(CONFIG.instant, 'abandon_instant', { launch_id: launchId }, 100, '0');
export const abortInstantNear = (launchId: string): SignAndSendInput => fc(CONFIG.instant, 'abort_instant', { launch_id: launchId }, 100, '0');
export const reclaimDepositNear = (launchId: string): SignAndSendInput => fc(CONFIG.instant, 'reclaim_deposit', { launch_id: launchId }, 100, '0');
/** Allocation claim. `amount` null asks for everything claimable; above the cap the launcher panics with STREAM_CAP. */
export const claimVestedNear = (launchId: string, amount: bigint | null): SignAndSendInput =>
  fc(CONFIG.instant, 'claim_vested', { launch_id: launchId, amount: amount === null ? null : amount.toString() }, 100, '0');
