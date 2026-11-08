// Wallet adapter. The ONLY file that talks to a wallet, so a different wallet library is a one-file change.
// Types compile against @near-wallet-selector 10.1.4 (its Action is @near-js/transactions's Action; near-api-js 7.4.0 bundles an incompatible copy, so actions come from @near-js/transactions).
// [UNVERIFIED] runtime behaviour of the wallet popups must be exercised on testnet.
import { setupWalletSelector, type WalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { actionCreators } from '@near-js/transactions';
import { CONFIG } from './config';

const GAS = 300n * 10n ** 12n;
let selectorPromise: Promise<WalletSelector> | null = null;

export function selector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({ network: CONFIG.network as 'testnet' | 'mainnet', modules: [setupMyNearWallet()] });
  return selectorPromise;
}

export async function connect(): Promise<void> {
  const modal = setupModal(await selector(), { contractId: CONFIG.core });
  modal.show();
}

export async function accountId(): Promise<string | null> {
  const s = await selector();
  return s.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
}

async function call(receiverId: string, methodName: string, args: Record<string, unknown>, deposit: string) {
  const wallet = await (await selector()).wallet();
  return wallet.signAndSendTransaction({ receiverId, actions: [actionCreators.functionCall(methodName, args, GAS, BigInt(deposit))] });
}

export const createTrial = (params: Record<string, unknown>, depositYocto: string) => call(CONFIG.core, 'create_trial', { params, stream_recipient: null }, depositYocto);
export const walk = (launchId: string) => call(CONFIG.core, 'walk', { launch_id: launchId }, '1');
export const claimRefund = (launchId: string) => call(CONFIG.core, 'claim_refund', { launch_id: launchId, holder: null }, '0');
export const claimTokens = (launchId: string) => call(CONFIG.core, 'claim_tokens', { launch_id: launchId }, '1');
export const settle = (launchId: string) => call(CONFIG.core, 'settle', { launch_id: launchId }, '0');

/** Native path: USDC.ft_transfer_call(core, amount, msg). The message is the same JSON the contract parses. */
export const commit = (launchId: string, amountMicro: string) =>
  call(CONFIG.usdc, 'ft_transfer_call', { receiver_id: CONFIG.core, amount: amountMicro, msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: launchId }) }, '1');
