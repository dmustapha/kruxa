import { describe, expect, it } from 'vitest';
import { INSTANT_DEFAULTS } from './rules';
import { summarizeAllocation, summarizeOpenPrice, summarizeSeed } from './summary';

const p = { ...INSTANT_DEFAULTS, name: 'Zed', symbol: 'ZED' };
describe('instant summaries', () => {
  it('seed sentence states permanence and the mainnet-only fee', () => {
    expect(summarizeSeed(p)).toContain('no method can withdraw it');
    expect(summarizeSeed(p)).toContain('no launch fee on testnet');
    expect(summarizeSeed(p, 'mainnet')).toContain('pool opens with $240');
  });
  it('allocation sentence', () => {
    expect(summarizeAllocation(p)).toBe('5% of the supply (50,000,000 tokens) is yours. Nothing unlocks for 7 days, then it unlocks evenly until day 90. The other 95% goes into the pool.');
    expect(summarizeAllocation({ ...p, creator_alloc_bps: 0 })).toMatch(/no allocation/);
  });
  it('price sentence', () => expect(summarizeOpenPrice(p)).toMatch(/about 2\.63e-7 USDC per token/));
});
