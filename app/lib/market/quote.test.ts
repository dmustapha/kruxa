import { describe, expect, it } from 'vitest';
import { computeQuote, parseReserves, parseSlippagePct } from './quote';
import type { FeeTerms } from './types';

const terms: FeeTerms = { total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000, opening_fee_start_bps: 500, opening_decay_minutes: 60, fee_vest_bps: 5000, fee_vest_days: 90 };
const reserves = { q: 26_571_793n, t: 794_353_574_700n };
const base = { side: 'buy' as const, amountText: '5', reserves, terms, openedAtSec: 1000, nowSec: 1000 + 7200, slippageBps: 100 };

describe('computeQuote', () => {
  it('is empty for blank input and invalid for junk', () => {
    expect(computeQuote({ ...base, amountText: '' }).status).toBe('empty');
    expect(computeQuote({ ...base, amountText: 'abc' }).status).toBe('invalid');
    expect(computeQuote({ ...base, amountText: '0' }).status).toBe('invalid');
    expect(computeQuote({ ...base, amountText: '0.5' })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/\$1/) });
  });
  it('never guesses: missing reserves or terms are unavailable', () => {
    expect(computeQuote({ ...base, reserves: null }).status).toBe('unavailable');
    expect(computeQuote({ ...base, terms: null }).status).toBe('unavailable');
  });
  it('buy: min_out is positive and below expected out', () => {
    const v = computeQuote(base);
    if (v.status !== 'ok') throw new Error('expected ok');
    expect(v.minOut).toBeGreaterThan(0n);
    expect(v.minOut).toBeLessThan(v.expectedOut);
    expect(v.minOut).toBe((v.expectedOut * 9900n) / 10000n);
    expect(v.quote.fee.total).toBe(50_000n); // 1% of 5 USDC after the opening window
  });
  it('charges the higher opening rate inside the window', () => {
    const early = computeQuote({ ...base, nowSec: 1000 });
    const late = computeQuote(base);
    if (early.status !== 'ok' || late.status !== 'ok') throw new Error('expected ok');
    expect(early.quote.fee.total).toBeGreaterThan(late.quote.fee.total);
  });
  it('sell takes tokens in and refuses under $1 gross', () => {
    expect(computeQuote({ ...base, side: 'sell', amountText: '1000' }).status).toBe('invalid');
    const v = computeQuote({ ...base, side: 'sell', amountText: '100000' });
    expect(v.status).toBe('ok');
  });
  it('flags high price impact', () => {
    const v = computeQuote({ ...base, amountText: '20' });
    expect(v.status === 'ok' && v.highImpact).toBe(true);
  });
  it('parses reserves and slippage strictly', () => {
    expect(parseReserves('1', '2')).toEqual({ q: 1n, t: 2n });
    expect(parseReserves(null, '2')).toBeNull();
    expect(parseReserves('x', '2')).toBeNull();
    expect(parseSlippagePct('1')).toBe(100);
    expect(parseSlippagePct('0.5')).toBe(50);
    expect(parseSlippagePct('0')).toBeNull();
    expect(parseSlippagePct('51')).toBeNull();
    expect(parseSlippagePct('1.234')).toBeNull();
  });
});
