import { INTERVAL_SECONDS } from "./types.ts";
import type { Interval } from "./types.ts";

/** Fixed-point scale of stored prices: 1e12 means one whole USDC per whole token. */
export const PRICE_SCALE = 10n ** 12n;
export const QUOTE_DECIMALS = 6;
export const DEFAULT_TOKEN_DECIMALS = 6;

/**
 * Execution price, quote per whole token, scaled by 1e12. Integer BigInt math so replays never drift.
 * `quote` and `token` are base units; returns null when `token` is zero.
 */
export function priceE12(quote: bigint, token: bigint, tokenDecimals: number): bigint | null {
  if (token <= 0n) return null;
  return (quote * 10n ** BigInt(tokenDecimals) * PRICE_SCALE) / (token * 10n ** BigInt(QUOTE_DECIMALS));
}

export function e12ToNumber(p: bigint): number {
  const whole = p / PRICE_SCALE;
  const frac = p % PRICE_SCALE;
  return Number(`${whole}.${frac.toString().padStart(12, "0")}`);
}

export function bucketStart(timeSec: number, interval: Interval): number {
  const s = INTERVAL_SECONDS[interval];
  return timeSec - (timeSec % s);
}

export function quoteToNumber(micro: bigint): number {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  return Number(`${whole}.${frac.toString().padStart(6, "0")}`);
}

/** Constant-product swap output with an input-side fee in bps. */
export function cpOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): bigint {
  const net = (amountIn * (10_000n - feeBps)) / 10_000n;
  return (net * reserveOut) / (reserveIn + net);
}
