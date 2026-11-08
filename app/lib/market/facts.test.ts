import { describe, expect, it } from 'vitest';
import { resolveFacts, sliceRows } from './facts';
import type { ChainPool } from './chain';
import type { FeeTerms, TokenPageData } from './types';

const terms: FeeTerms = { total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000, opening_fee_start_bps: 500, opening_decay_minutes: 60, fee_vest_bps: 5000, fee_vest_days: 90 };
const page = (pool: Partial<TokenPageData['pool']>): TokenPageData => ({
  launch: { launch_id: '1', symbol: 'A', creator: 'c', payout_recipient: 'c', status: 'passed', stage: 'passed', source: 'fixture' },
  pool: { open: true, paused: false, opened_at: 1000, ...pool }, stats: {}, safety: [], as_of: { block_height: 1, block_time: 1 }, source: 'fixture',
});
const chain: ChainPool = { launch_id: '1', token: 'tok.testnet', quote: 'usdc', state: 'Open', q: '1', t: '1', opened_ns: '1000000000000', payout_recipient: 'c', total_supply: '1', charter_hash: 'h', terms };

describe('resolveFacts', () => {
  it('prefers the API when it carries terms and token', () => {
    expect(resolveFacts(page({ fee_terms: terms, token: 'tok' }), chain)).toMatchObject({ basis: 'api', token: 'tok' });
  });
  it('falls back to the chain read', () => {
    expect(resolveFacts(page({}), chain)).toMatchObject({ basis: 'chain', token: 'tok.testnet', terms, openedAtSec: 1000 });
  });
  it('is honest when nothing is known', () => {
    expect(resolveFacts(page({}), null)).toMatchObject({ basis: 'none', token: null, terms: null });
  });
  it('ignores a chain pool that is not Open', () => {
    expect(resolveFacts(page({}), { ...chain, state: 'AwaitToken' }).terms).toBeNull();
  });
});

describe('sliceRows', () => {
  it('lists five slices that sum to 10000 and flags the two redirected ones', () => {
    const rows = sliceRows(terms);
    expect(rows).toHaveLength(5);
    expect(rows.reduce((s, r) => s + r.bps, 0)).toBe(10_000);
    expect(rows.filter((r) => r.redirected).map((r) => r.id)).toEqual(['holders', 'referral']);
  });
});
