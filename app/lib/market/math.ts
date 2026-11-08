// Bigint port of crates/kruxa-market (amm.rs, fees.rs) with the same integer rounding, so the quote preview matches the contract.
// Constant product; the fee is always paid in USDC (on the input for a buy, on the gross output for a sell).
// M-A routing: the holders and referral slices are redirected to LP (Routing::M_A).
import { MIN_TRADE_QUOTE } from './config';
import type { FeeTerms } from './types';

const U128_MAX = (1n << 128n) - 1n;
const FEE_DENOM_PPM = 1_000_000n;
const BPS = 10_000n;
const RESERVE_BOUND_Q = 1_000_000_000_000_000_000n;
const NS_PER_MIN = 60n * 1_000_000_000n;

export type MarketErrorCode = 'R_MIN_OUT' | 'R_MIN_TRADE' | 'R_MATH';
export class MarketMathError extends Error {
  constructor(readonly code: MarketErrorCode) { super(code); this.name = 'MarketMathError'; }
}

export interface Reserves { q: bigint; t: bigint }
export interface FeeCut { total: bigint; creator: bigint; platform: bigint; holders: bigint; lp: bigint; referral: bigint; surcharge: bigint; redHolders: bigint; redReferral: bigint }
export interface SwapQuote { amountIn: bigint; amountOut: bigint; fee: FeeCut; after: Reserves; qLeg: bigint; feeBps: number; priceImpactBps: number }

function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new MarketMathError('R_MATH');
  const r = (a * b) / d;
  if (r > U128_MAX) throw new MarketMathError('R_MATH');
  return r;
}
function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new MarketMathError('R_MATH');
  const n = a * b;
  const r = n / d + (n % d === 0n ? 0n : 1n);
  if (r > U128_MAX) throw new MarketMathError('R_MATH');
  return r;
}

export const baseRatePpm = (t: FeeTerms): bigint => BigInt(t.total_fee_bps) * 100n;

/** Applied rate in ppm `elapsedNs` after the pool opened: the opening rate decays linearly to the base. */
export function appliedRatePpm(t: FeeTerms, elapsedNs: bigint): bigint {
  const base = baseRatePpm(t);
  const start = BigInt(t.opening_fee_start_bps) * 100n;
  const dur = BigInt(t.opening_decay_minutes) * NS_PER_MIN;
  if (start <= base || dur === 0n || elapsedNs >= dur) return base;
  return base + ((start - base) * (dur - elapsedNs)) / dur;
}

export function routeFee(qLeg: bigint, t: FeeTerms, elapsedNs: bigint): FeeCut {
  const total = mulDivCeil(qLeg, appliedRatePpm(t, elapsedNs), FEE_DENOM_PPM);
  if (total >= qLeg) throw new MarketMathError('R_MATH');
  let baseFee = mulDivCeil(qLeg, baseRatePpm(t), FEE_DENOM_PPM);
  if (baseFee > total) baseFee = total;
  const part = (bps: number): bigint => mulDivFloor(baseFee, BigInt(bps), BPS);
  const creator = part(t.creator_bps);
  const platform = part(t.platform_bps);
  const holders = part(t.holders_bps);
  const referral = part(t.referral_bps);
  const surcharge = total - baseFee;
  const lpBase = baseFee - creator - platform - holders - referral;
  // Routing::M_A: both slices have no live destination and go to LP.
  return { total, creator, platform, holders: 0n, lp: lpBase + surcharge + holders + referral, referral: 0n, surcharge, redHolders: holders, redReferral: referral };
}

export function cpOut(reserveIn: bigint, reserveOut: bigint, amountIn: bigint): bigint {
  return mulDivFloor(reserveOut, amountIn, reserveIn + amountIn);
}

function checkReserves(r: Reserves): void {
  if (r.q <= 0n || r.t <= 0n || r.q > RESERVE_BOUND_Q) throw new MarketMathError('R_MATH');
}

/** Spot price impact of the trade in bps, from the execution price against the pre-trade reserve ratio. */
function impactBps(r: Reserves, qIn: bigint, tOut: bigint): number {
  if (qIn <= 0n || tOut <= 0n) return 0;
  // exec = qIn / tOut ; spot = q / t ; impact = exec / spot - 1 (buys), mirrored for sells by the caller's choice of args.
  const num = qIn * r.t;
  const den = tOut * r.q;
  const bps = ((num - den) * BPS) / den;
  return Number(bps < 0n ? -bps : bps);
}

export function quoteBuy(r: Reserves, amountIn: bigint, minOut: bigint, t: FeeTerms, elapsedNs: bigint): SwapQuote {
  checkReserves(r);
  if (minOut === 0n) throw new MarketMathError('R_MIN_OUT');
  if (amountIn < MIN_TRADE_QUOTE) throw new MarketMathError('R_MIN_TRADE');
  const fee = routeFee(amountIn, t, elapsedNs);
  const net = amountIn - fee.total;
  const out = cpOut(r.q, r.t, net);
  if (out === 0n || out < minOut) throw new MarketMathError('R_MIN_OUT');
  const after: Reserves = { q: r.q + net + fee.lp, t: r.t - out };
  checkReserves(after);
  return { amountIn, amountOut: out, fee, after, qLeg: amountIn, feeBps: Number((fee.total * BPS) / amountIn), priceImpactBps: impactBps(r, amountIn, out) };
}

export function quoteSell(r: Reserves, amountIn: bigint, minOut: bigint, t: FeeTerms, elapsedNs: bigint): SwapQuote {
  checkReserves(r);
  if (minOut === 0n) throw new MarketMathError('R_MIN_OUT');
  const gross = cpOut(r.t, r.q, amountIn);
  if (gross < MIN_TRADE_QUOTE) throw new MarketMathError('R_MIN_TRADE');
  const fee = routeFee(gross, t, elapsedNs);
  const out = gross - fee.total;
  if (out < minOut) throw new MarketMathError('R_MIN_OUT');
  const after: Reserves = { q: r.q - gross + fee.lp, t: r.t + amountIn };
  checkReserves(after);
  return { amountIn, amountOut: out, fee, after, qLeg: gross, feeBps: Number((fee.total * BPS) / gross), priceImpactBps: impactBps(r, gross, amountIn) };
}

/**
 * The preview first runs the swap with the weakest legal min_out (1) to learn the expected output, then the caller derives the
 * real min_out from slippage. This keeps the preview total (it never throws R_MIN_OUT merely because min_out was unset).
 */
export function previewSwap(side: 'buy' | 'sell', r: Reserves, amountIn: bigint, t: FeeTerms, elapsedNs: bigint): SwapQuote {
  return side === 'buy' ? quoteBuy(r, amountIn, 1n, t, elapsedNs) : quoteSell(r, amountIn, 1n, t, elapsedNs);
}

/** min_out = floor(expected * (10000 - slippageBps) / 10000), never below 1 (the contract refuses 0). */
export function minOutFor(expectedOut: bigint, slippageBps: number): bigint {
  const s = BigInt(Math.min(Math.max(Math.round(slippageBps), 0), 5000));
  const v = (expectedOut * (BPS - s)) / BPS;
  return v < 1n ? 1n : v;
}

/** Opening-window state: current applied rate in bps (2 decimals of ppm kept) and seconds left, or null once decayed. */
export function openingWindow(t: FeeTerms, openedAtSec: number, nowSec: number): { secondsLeft: number; appliedBps: number; startBps: number; baseBps: number } | null {
  const durSec = t.opening_decay_minutes * 60;
  const elapsed = nowSec - openedAtSec;
  if (t.opening_fee_start_bps <= t.total_fee_bps || durSec === 0 || elapsed >= durSec) return null;
  const rate = appliedRatePpm(t, BigInt(Math.max(0, elapsed)) * 1_000_000_000n);
  return { secondsLeft: durSec - Math.max(0, elapsed), appliedBps: Number(rate) / 100, startBps: t.opening_fee_start_bps, baseBps: t.total_fee_bps };
}
