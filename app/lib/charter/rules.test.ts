import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets';
import { DEMO_RULES, LADDER_RULES, STANDARD_FEES, USDC, derive, validateAll, type TrialParams } from './rules';

const base: TrialParams = { ...PRESETS[0]!.params, symbol: 'ABCD', name: 'ABCD Test Token', commit_secs: 86_400, stream_days: 30 };
const codes = (p: TrialParams, r = LADDER_RULES): string[] => validateAll(p, r).map((v) => v.code);
const fees = (edit: Partial<typeof STANDARD_FEES>): TrialParams => ({ ...base, fees: { ...STANDARD_FEES, ...edit } });

describe('rule mirror: one failing case per code (cases lifted from crates/kruxa-logic rules.rs one_failing_case_per_code)', () => {
  it('defaults pass', () => expect(codes(base)).toEqual([]));
  const cases: [string, TrialParams][] = [
    ['R_SYMBOL', { ...base, symbol: 'abcd' }], ['R_SYMBOL', { ...base, symbol: 'USDC' }], ['R_SUPPLY', { ...base, total_supply_whole: 9_999_999 }],
    ['R_BUCKETS', { ...base, sale_bps: 5900 }], ['R_BUCKETS', { ...base, sale_bps: 4900, lp_bps: 3600 }],
    ['R_ALLOC', { ...base, creator_bps: 1900, backer_bps: 700, sale_bps: 5400, lp_bps: 2000 }],
    ['R_HARD_CAP', { ...base, hard_cap: 1000n * USDC + 1n }], ['R_HARD_CAP', { ...base, hard_cap: 499n * USDC }],
    ['R_SOFT_CAP', { ...base, soft_cap: 100n * USDC - 1n }], ['R_MIN_BUY', { ...base, min_buy: 10n * USDC - 1n }], ['R_WALLET_CAP', { ...base, wallet_bps: 49 }],
    ['R_FUNDERS', { ...base, min_funders: 9 }], ['R_PASSABLE', { ...base, min_funders: 18 }],
    ['R_WINDOW', { ...base, commit_secs: 43_199 }], ['R_WINDOW', { ...base, tail_secs: 3599 }], ['R_STREAM', { ...base, stream_days: 29 }],
    ['R_FEE_TOTAL', fees({ total_fee_bps: 201 })], ['R_FEE_TOTAL', fees({ total_fee_bps: 29 })], ['R_CREATOR_SHARE', fees({ creator_bps: 6001 })],
    ['R_SPLIT_SUM', fees({ referral_bps: 900 })],
  ];
  for (const [code, p] of cases) it(`${code} fires`, () => expect(codes(p)).toContain(code));
  it('R_CAP_GLOBAL fires when headroom is short', () => expect(validateAll(base, LADDER_RULES, 500n * USDC).map((v) => v.code)).toContain('R_CAP_GLOBAL'));
});

describe('lowest launch bar: $100 soft cap', () => {
  const low: TrialParams = { ...base, hard_cap: 500n * USDC, soft_cap: 100n * USDC, min_buy: 10n * USDC, min_funders: 10 };
  it('hard 500 / soft 100 / min buy 10 / 10 funders is legal', () => expect(codes(low)).toEqual([]));
  it('one micro-USDC below refuses', () => {
    expect(codes({ ...low, soft_cap: 100n * USDC - 1n })).toContain('R_SOFT_CAP');
    expect(codes({ ...low, min_buy: 10n * USDC - 1n })).toContain('R_MIN_BUY');
  });
  it('a $100 soft cap under a $1,000 hard cap needs 20%', () => expect(codes({ ...low, hard_cap: 1000n * USDC })).toEqual(['R_SOFT_CAP']));
  it('11 funders at $10 cannot pass a $100 soft cap', () => expect(codes({ ...low, min_funders: 11 })).toEqual(['R_PASSABLE']));
});

describe('hostile preset (fixtures/hostile.json)', () => {
  const hostile = PRESETS.find((p) => p.id === 'hostile')!.params;
  it('is refused with R_ALLOC and R_WINDOW, in contract check order', () => expect(codes(hostile)).toEqual(['R_ALLOC', 'R_WINDOW']));
  it('stays refused under the relaxed demo clock for the allocation, but the 12 h window is then legal', () => expect(codes(hostile, DEMO_RULES)).toEqual(['R_ALLOC']));
});

describe('presets', () => {
  for (const p of PRESETS.filter((x) => !x.expectRefusal)) {
    it(`${p.id} is legal once it has a ticker and name`, () => expect(codes({ ...p.params, symbol: 'ZED', name: 'Zed' })).toEqual([]));
  }
});

describe('derive', () => {
  it('matches the documented $1,000 arithmetic', () => {
    const d = derive(base)!;
    expect(d.walletCap).toBe(100n * USDC);
    expect(d.maxHolders).toBe(100);
    expect(d.nSale + d.nLp + d.nCreator + d.nBacker).toBe(1_000_000_000_000_000n);
  });
  it('returns null when the inputs are unusable', () => expect(derive({ ...base, min_buy: 0n })).toBeNull());
});
