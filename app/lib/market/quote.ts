// Turns what the user typed plus indexed reserves and logged fee terms into the numbers the trade panel shows.
// Same integer math as kruxa-market (math.ts). Nothing here is a guarantee: the contract's min_out is the protection.
import { MIN_TRADE_QUOTE } from './config';
import { fmtUnits, parseUnits } from './format';
import { MarketMathError, minOutFor, previewSwap, type SwapQuote } from './math';
import type { FeeTerms } from './types';

export type Side = 'buy' | 'sell';
export interface QuoteInput {
  side: Side;
  amountText: string;
  reserves: { q: bigint; t: bigint } | null;
  terms: FeeTerms | null;
  openedAtSec: number | null;
  nowSec: number;
  slippageBps: number;
}
export type QuoteView =
  | { status: 'empty' }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'ok'; amountIn: bigint; quote: SwapQuote; minOut: bigint; expectedOut: bigint; highImpact: boolean };

export const HIGH_IMPACT_BPS = 500;
export const SLIPPAGE_MIN_BPS = 10;
export const SLIPPAGE_MAX_BPS = 5000;

export function parseReserves(q: string | null | undefined, t: string | null | undefined): { q: bigint; t: bigint } | null {
  if (!q || !t) return null;
  try { const r = { q: BigInt(q), t: BigInt(t) }; return r.q > 0n && r.t > 0n ? r : null; } catch { return null; }
}

const REASONS: Record<string, string> = {
  R_MIN_TRADE: 'The market refuses trades under $1 of USDC.',
  R_MATH: 'This size is outside what the pool can price.',
  R_MIN_OUT: 'This trade would return nothing at the current price.',
};

export function computeQuote(i: QuoteInput): QuoteView {
  if (i.amountText.trim() === '') return { status: 'empty' };
  const amountIn = parseUnits(i.amountText, 6);
  if (amountIn === null) return { status: 'invalid', reason: 'Enter a number with at most 6 decimals.' };
  if (amountIn === 0n) return { status: 'invalid', reason: 'Enter an amount above zero.' };
  if (i.side === 'buy' && amountIn < MIN_TRADE_QUOTE) return { status: 'invalid', reason: 'The market refuses trades under $1 of USDC.' };
  if (!i.reserves) return { status: 'unavailable', reason: 'Pool reserves are not indexed yet, so no quote can be computed.' };
  if (!i.terms) return { status: 'unavailable', reason: 'The logged fee terms are unknown, so no quote can be computed. Nothing is guessed.' };
  const elapsed = i.openedAtSec === null ? 0n : BigInt(Math.max(0, i.nowSec - i.openedAtSec)) * 1_000_000_000n;
  try {
    const quote = previewSwap(i.side, i.reserves, amountIn, i.terms, elapsed);
    const minOut = minOutFor(quote.amountOut, i.slippageBps);
    return { status: 'ok', amountIn, quote, minOut, expectedOut: quote.amountOut, highImpact: quote.priceImpactBps >= HIGH_IMPACT_BPS };
  } catch (e) {
    if (e instanceof MarketMathError) return { status: 'invalid', reason: REASONS[e.code] ?? e.code };
    return { status: 'unavailable', reason: 'The quote could not be computed.' };
  }
}

/** Slippage text (percent) to bps. Returns null when malformed or outside 0.1 to 50 percent. */
export function parseSlippagePct(text: string): number | null {
  const u = parseUnits(text, 2);
  if (u === null) return null;
  const bps = Number(u);
  return bps >= SLIPPAGE_MIN_BPS && bps <= SLIPPAGE_MAX_BPS ? bps : null;
}

export const fmtOut = (side: Side, raw: bigint): string => (side === 'buy' ? `${fmtUnits(raw, 6, 2)} tokens` : `$${fmtUnits(raw, 6, 4)}`);
