// The wallet layer knows the 'trade' action (IR-W1 done: WalletAction, ACTION_LABEL and the gating live in lib/wallet). This file keeps the
// constant the market components import.
import type { WalletAction } from '@/lib/wallet/types';

export const TRADE_ACTION: WalletAction = 'trade';
