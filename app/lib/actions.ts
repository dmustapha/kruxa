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
