// The market's rules for instant pools (MARKET-ABI 1.1.0), as checks the order panel can run before signing and as words for
// refusals. A refused trade returns the full amount; these texts say why, using the logged rule codes.
import { fmtUnits } from './format';
import type { MarketConfigView } from './chain';

export const REFUSAL_TEXT: Record<string, string> = {
  R_SELF_BUY: 'R_SELF_BUY: the creator and payout recipient accounts cannot buy on an instant pool. Sells and claims are unaffected. A second wallet is not blocked.',
  R_MARKET_CAP: 'R_MARKET_CAP: instant pools together hit the market cap for instant launches, so buys are refused until the reserve falls. Sells always work.',
  R_NOT_YET_TRADING: 'R_NOT_YET_TRADING: this pool announced its open. Buys are refused until the time shown on the launch page; nothing was swapped. Sells are not affected.',
  R_MIN_OUT: 'R_MIN_OUT: the price moved past your minimum. Nothing was swapped.',
  R_MIN_TRADE: 'R_MIN_TRADE: the minimum trade is $1 of USDC.',
  R_PAUSED: 'R_PAUSED: buys are paused. Sells and claims stay open.',
};

/** Pre-sign check for the self-buy block. `declared` is [creator, payout recipient]. Only buys are blocked, only on instant pools. */
export function selfBuyBlock(instant: boolean, side: 'buy' | 'sell', declared: string[], account: string | null): string | null {
  if (!instant || side !== 'buy' || !account) return null;
  return declared.includes(account) ? REFUSAL_TEXT.R_SELF_BUY! : null;
}

export type CapCheck = { status: 'ok' | 'refused' | 'unknown'; message: string };

/** The instant sub-cap: a buy that would take the sum of instant reserves above `max_instant_reserve_q` is refused. */
export function instantCapCheck(cfg: MarketConfigView | null, reserveDelta: bigint | null): CapCheck {
  if (!cfg || cfg.max_instant_reserve_q === undefined || cfg.instant_q === undefined) {
    return { status: 'unknown', message: 'The market limits the total reserve of instant pools and refuses buys above it (R_MARKET_CAP). The current limit could not be read, so a buy cannot be pre-checked here.' };
  }
  const cap = BigInt(cfg.max_instant_reserve_q); const now = BigInt(cfg.instant_q);
  const line = `Instant pools hold $${fmtUnits(now, 6, 2)} of a $${fmtUnits(cap, 6, 2)} limit.`;
  if (reserveDelta !== null && now + reserveDelta > cap) return { status: 'refused', message: `${line} This buy would take them over the limit and be refused (R_MARKET_CAP). Try a smaller amount; sells always work.` };
  return { status: 'ok', message: `${line} Buys that would exceed it are refused (R_MARKET_CAP); sells always work.` };
}
