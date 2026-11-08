// The wallet layer's ACTION_LABEL has no 'trade' entry yet (REQ-ui-market.md asks the wallet owner to add it). The chooser reads
// ACTION_LABEL[action] for its title, so register the label once here instead of letting it render "undefined".
import { ACTION_LABEL } from '@/lib/wallet/gating';
import type { WalletAction } from '@/lib/wallet/types';

export const TRADE_ACTION = 'trade' as WalletAction;
const labels = ACTION_LABEL as Record<string, string>;
if (!labels.trade) labels.trade = 'Trade';
