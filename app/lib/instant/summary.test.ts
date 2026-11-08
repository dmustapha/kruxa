import { describe, expect, it } from 'vitest';
import { DAY_NS, INSTANT_DEFAULTS } from './rules';
import { cliffSharePct, summarizeAllocation, summarizeOpenPrice, summarizeSeed } from './summary';

const p = { ...INSTANT_DEFAULTS, name: 'Zed', symbol: 'ZED' };
const USDC = 1_000_000n;
describe('instant summaries', () => {
  it('seed sentence states permanence and takes the fee from the launcher, never from the network', () => {
    expect(summarizeSeed(p, 0n)).toContain('no method can withdraw it');
    expect(summarizeSeed(p, 0n)).toContain('charges no launch fee');
    expect(summarizeSeed(p, 10n * USDC)).toContain('pool opens with $240');
    expect(summarizeSeed(p, null)).toContain('has not answered yet');
    expect(summarizeSeed(p, null)).not.toContain('$10');
  });
  it('allocation sentence is in days only on a day profile, and says what unlocks at the cliff', () => {
    expect(summarizeAllocation(p, DAY_NS)).toBe('5% of the supply (50,000,000 tokens) is yours. Nothing unlocks for 7 days. At the cliff 7.8% of it unlocks at once, then it unlocks evenly until 90 days after the pool opens. The other 95% goes into the pool.');
    expect(summarizeAllocation(p, null)).toContain('7 units (length not known)');
    expect(summarizeAllocation(p, null)).not.toMatch(/\bdays?\b/);
    expect(summarizeAllocation(p, '10000000000')).toContain('7 units (10 s each)');
    expect(summarizeAllocation({ ...p, creator_alloc_bps: 0 }, DAY_NS)).toMatch(/no allocation/);
  });
  it('the cliff share is the linear share vested by then (L-08): 7/30 is 23.3%, cliff equal to vest is 100%', () => {
    expect(cliffSharePct({ cliff_days: 7, vest_days: 30 })).toBe('23.3%');
    expect(cliffSharePct({ cliff_days: 30, vest_days: 30 })).toBe('100%');
  });
  it('price sentence uses the real opening fee terms', () => {
    expect(summarizeOpenPrice(p, 0n)).toMatch(/about 2\.63e-7 USDC per token/);
    expect(summarizeOpenPrice(p, 0n)).toContain('opening fee of 5% that falls to the base fee over 60 minutes');
    expect(summarizeOpenPrice({ ...p, fees: { ...p.fees, opening_fee_start_bps: 0, opening_decay_minutes: 0 } }, 0n)).not.toContain('opening fee');
  });
});
