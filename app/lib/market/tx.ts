// Transaction builders for the market (MARKET-ABI.md). Pure: they return the SignAndSendInput the WalletAdapter signs.
// Buy: USDC ft_transfer_call with a buy message. Sell: launch-token ft_transfer_call with a sell message. Claim: market.claim.
import { GAS_CLAIM, GAS_TRADE, ONE_YOCTO } from './config';
import { WalletError, type SignAndSendInput } from '@/lib/wallet/types';

export interface TradeParams {
  side: 'buy' | 'sell';
  launchId: string;
  amountIn: bigint;
  minOut: bigint;
  receiver: string;
  market: string;
  /** Token contract that is the predecessor: USDC for a buy, the launch token for a sell. */
  tokenContract: string;
  referrer?: string;
}

/** The ft_on_transfer message. min_out is mandatory and must be positive; this refuses to build otherwise. */
export function tradeMessage(p: Pick<TradeParams, 'side' | 'launchId' | 'minOut' | 'receiver' | 'referrer'>): string {
  if (p.minOut <= 0n) throw new Error('min_out must be greater than zero');
  const msg: Record<string, string> = { op: p.side, launch_id: p.launchId, min_out: p.minOut.toString(), receiver: p.receiver };
  if (p.side === 'buy' && p.referrer) msg.referrer = p.referrer;
  return JSON.stringify({ v: 1, ...msg });
}

export function buildTradeTx(p: TradeParams): SignAndSendInput {
  if (p.amountIn <= 0n) throw new Error('amount must be greater than zero');
  return {
    receiverId: p.tokenContract,
    actions: [{
      type: 'FunctionCall',
      params: {
        methodName: 'ft_transfer_call',
        args: { receiver_id: p.market, amount: p.amountIn.toString(), msg: tradeMessage(p) },
        gas: GAS_TRADE,
        deposit: ONE_YOCTO,
      },
    }],
  };
}

/** Launcher `claim_vested(launch_id, amount?)`: payout recipient only. Omit `amount` to claim everything unlocked. */
export function buildClaimVestedTx(launcher: string, launchId: string, amount?: bigint): SignAndSendInput {
  const args: Record<string, unknown> = { launch_id: launchId };
  if (amount !== undefined) {
    if (amount <= 0n) throw new Error('amount must be greater than zero');
    args.amount = amount.toString();
  }
  return { receiverId: launcher, actions: [{ type: 'FunctionCall', params: { methodName: 'claim_vested', args, gas: GAS_CLAIM, deposit: '0' } }] };
}

export function buildClaimTx(market: string, launchId: string): SignAndSendInput {
  return { receiverId: market, actions: [{ type: 'FunctionCall', params: { methodName: 'claim', args: { launch_id: launchId }, gas: GAS_CLAIM, deposit: '0' } }] };
}

/** Plain-language text for a failed signing attempt. */
export function describeSignError(e: unknown): string {
  if (e instanceof WalletError) {
    switch (e.code) {
      case 'USER_REJECTED': return 'You closed the wallet without approving. Nothing was sent.';
      case 'MAINNET_LOCKED': return 'Signing is locked on this network. Nothing was sent.';
      case 'NOT_CONNECTED': return 'No NEAR wallet is connected. Nothing was sent.';
      case 'NETWORK_UNAVAILABLE': return 'The wallet could not reach the network. Nothing was sent.';
      default: return `${e.message} Nothing was confirmed.`;
    }
  }
  return e instanceof Error ? `${e.message} Nothing was confirmed.` : 'The wallet returned an error. Nothing was confirmed.';
}
