import { describe, expect, it } from 'vitest';
import { appliedRatePpm, minOutFor, MarketMathError, openingWindow, quoteBuy, quoteSell, routeFee, previewSwap } from './math';
import type { FeeTerms } from './types';

// FeeTerms::standard() from crates/kruxa-logic and the ARCHITECTURE sample: 1% total, 50/15/15/10/10, no opening surcharge.
const standard: FeeTerms = { total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000, opening_fee_start_bps: 100, opening_decay_minutes: 0, fee_vest_bps: 5000, fee_vest_days: 90 };
const opening: FeeTerms = { ...standard, opening_fee_start_bps: 500, opening_decay_minutes: 60 };
const MIN = 60n * 1_000_000_000n;
const R = { q: 1_000_000_000n, t: 1_000_000_000_000n };

describe('opening fee decay (vectors from crates/kruxa-market/tests/props.rs)', () => {
  it('decays 500 bps to 100 bps over 60 minutes', () => {
    expect(appliedRatePpm(opening, 0n)).toBe(50_000n);
    expect(appliedRatePpm(opening, 30n * MIN)).toBe(30_000n);
    expect(appliedRatePpm(opening, 60n * MIN)).toBe(10_000n);
    expect(appliedRatePpm(opening, 2n ** 64n - 1n)).toBe(10_000n);
  });
  it('sends the whole surcharge to LP and leaves creator and platform unchanged', () => {
    const at0 = routeFee(100_000_000n, opening, 0n);
    const late = routeFee(100_000_000n, opening, 2n ** 64n - 1n);
    expect(at0.total).toBe(5_000_000n);
    expect(late.total).toBe(1_000_000n);
    expect(at0.creator).toBe(late.creator);
    expect(at0.platform).toBe(late.platform);
    expect(at0.surcharge).toBe(4_000_000n);
    expect(at0.lp - late.lp).toBe(4_000_000n);
  });
});

describe('five-slice router (M-A routing)', () => {
  it('matches the Rust default split at 1 percent', () => {
    const f = routeFee(100_000_000n, standard, 0n);
    expect([f.total, f.creator, f.platform]).toEqual([1_000_000n, 500_000n, 150_000n]);
    expect([f.redHolders, f.redReferral, f.holders, f.referral]).toEqual([150_000n, 100_000n, 0n, 0n]);
    expect(f.lp).toBe(350_000n);
  });
  it('always sums to the total, including rounding dust', () => {
    for (const amt of [1_000_000n, 1_234_567n, 99_999_999n, 7_777_777_777n]) {
      const f = routeFee(amt, opening, 17n * MIN);
      expect(f.creator + f.platform + f.holders + f.lp + f.referral).toBe(f.total);
    }
  });
});

describe('swaps', () => {
  it('buy: out is floor constant product on the net input and reserves move as the contract moves them', () => {
    const q = quoteBuy(R, 10_000_000n, 1n, standard, 0n);
    const net = 10_000_000n - q.fee.total;
    expect(q.amountOut).toBe((R.t * net) / (R.q + net));
    expect(q.after.t).toBe(R.t - q.amountOut);
    expect(q.after.q).toBe(R.q + net + q.fee.lp);
    expect(q.after.q * q.after.t >= R.q * R.t).toBe(true);
  });
  it('sell: net out is gross minus fee, creator and platform leave the reserve', () => {
    const tin = 5_000_000_000n;
    const q = quoteSell(R, tin, 1n, standard, 0n);
    const gross = (R.q * tin) / (R.t + tin);
    expect(q.qLeg).toBe(gross);
    expect(q.amountOut).toBe(gross - q.fee.total);
    expect(q.after.q).toBe(R.q - gross + q.fee.lp);
    expect(q.after.t).toBe(R.t + tin);
  });
  it('refuses a zero min_out (R_MIN_OUT), a trade under $1 (R_MIN_TRADE) and an unmet min_out', () => {
    expect(() => quoteBuy(R, 10_000_000n, 0n, standard, 0n)).toThrowError(MarketMathError);
    try { quoteBuy(R, 999_999n, 1n, standard, 0n); } catch (e) { expect((e as MarketMathError).code).toBe('R_MIN_TRADE'); }
    try { quoteBuy(R, 10_000_000n, 10n ** 30n, standard, 0n); } catch (e) { expect((e as MarketMathError).code).toBe('R_MIN_OUT'); }
    try { quoteSell(R, 10n, 1n, standard, 0n); } catch (e) { expect((e as MarketMathError).code).toBe('R_MIN_TRADE'); }
  });
  it('previewSwap never throws for a missing min_out', () => {
    expect(previewSwap('buy', R, 5_000_000n, standard, 0n).amountOut > 0n).toBe(true);
  });
  it('reports price impact growing with size', () => {
    const small = quoteBuy(R, 1_000_000n, 1n, standard, 0n).priceImpactBps;
    const big = quoteBuy(R, 400_000_000n, 1n, standard, 0n).priceImpactBps;
    expect(big).toBeGreaterThan(small);
  });
});

describe('min_out from slippage', () => {
  it('floors, and is never below 1', () => {
    expect(minOutFor(10_000n, 100)).toBe(9_900n);
    expect(minOutFor(1n, 5000)).toBe(1n);
    expect(minOutFor(0n, 0)).toBe(1n);
  });
  it('clamps absurd slippage to 50 percent', () => {
    expect(minOutFor(1000n, 99999)).toBe(500n);
  });
});

describe('opening window', () => {
  it('counts down and ends', () => {
    const w = openingWindow(opening, 1000, 1000 + 1800)!;
    expect(w.secondsLeft).toBe(1800);
    expect(w.appliedBps).toBe(300);
    expect(openingWindow(opening, 1000, 1000 + 3600)).toBeNull();
    expect(openingWindow(standard, 1000, 1000)).toBeNull();
  });
});
