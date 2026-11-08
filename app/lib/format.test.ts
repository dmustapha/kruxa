import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtNear, fmtPct, fmtSignedUsdc, microFromDollars, shortHash } from './format';
import { fmtUsdc } from './config';
import { marginOf, nextDeadline } from './launch';

describe('money', () => {
  it('formats micro-USDC exactly', () => { expect(fmtUsdc('350000000')).toBe('$350'); expect(fmtUsdc('1500000')).toBe('$1.5'); expect(fmtUsdc('-42000000')).toBe('-$42'); });
  it('signs margins', () => { expect(fmtSignedUsdc('37000000')).toBe('+$37'); expect(fmtSignedUsdc('0')).toBe('+$0'); expect(fmtSignedUsdc('-1')).toBe('-$0.000001'); });
  it('parses dollar input without floats', () => {
    expect(microFromDollars('20')).toBe(20_000_000n); expect(microFromDollars('0.000001')).toBe(1n); expect(microFromDollars('19.99')).toBe(19_990_000n);
    expect(microFromDollars('1.2345678')).toBeNull(); expect(microFromDollars('-3')).toBeNull(); expect(microFromDollars('abc')).toBeNull();
  });
  it('formats NEAR', () => expect(fmtNear('1234000000000000000000000')).toBe('1.234 NEAR'));
});

describe('text', () => {
  it('durations', () => { expect(fmtDuration(90061)).toBe('1d 1h 1m'); expect(fmtDuration(-5)).toBe('0m 0s'); });
  it('percent and hashes', () => { expect(fmtPct(17400)).toBe('174%'); expect(fmtPct(null)).toBe('n/a'); expect(shortHash('abcdef0123456789abcdef0123456789')).toBe('abcdef01...456789'); expect(shortHash(null)).toBe('n/a'); });
});

describe('verdict margin', () => {
  it('clears only when both inputs clear', () => {
    expect(marginOf({ total_active: '87000000', soft_cap: '50000000', funders: 4, min_funders: 3 })).toEqual({ usdc: 37000000n, funders: 1, clears: true });
    expect(marginOf({ total_active: '8000000', soft_cap: '50000000', funders: 1, min_funders: 3 }).clears).toBe(false);
    expect(marginOf({ total_active: '99000000', soft_cap: '50000000', funders: 2, min_funders: 3 }).clears).toBe(false);
  });
  it('is unknown, not guessed, when the soft cap is missing', () => expect(marginOf({ total_active: '1', soft_cap: null, funders: 1, min_funders: null }).clears).toBeNull());
  it('exactly at the line clears', () => expect(marginOf({ total_active: '50000000', soft_cap: '50000000', funders: 3, min_funders: 3 }).clears).toBe(true));
});

describe('deadlines', () => {
  const l = { status: 'open' as const, opens_at: 100, commit_end: 200, walk_end: 300 };
  it('walks through the phases', () => {
    expect(nextDeadline(l, 50)).toEqual({ label: 'Opens in', at: 100 });
    expect(nextDeadline(l, 150)).toEqual({ label: 'Commits close in', at: 200 });
    expect(nextDeadline(l, 250)).toEqual({ label: 'Walk closes in', at: 300 });
    expect(nextDeadline(l, 301)).toBeNull();
    expect(nextDeadline({ ...l, status: 'passed' as never }, 150)).toBeNull();
  });
});
