import { describe, expect, it } from 'vitest';
import { volumeScenarios } from './scenarios';
import { STANDARD_FEES } from './rules';

describe('volumeScenarios', () => {
  it('at the standard 1% fee the creator slice is 0.5% of volume, the platform 0.15%, and the rest goes to liquidity', () => {
    const [a, b, c] = volumeScenarios(STANDARD_FEES);
    expect(a).toMatchObject({ volume: 1_000_000_000n, fee: 10_000_000n, creator: 5_000_000n, platform: 1_500_000n, liquidity: 3_500_000n });
    expect(b!.fee).toBe(100_000_000n);
    expect(c!.creator).toBe(500_000_000n);
  });
  it('slices always add back to the fee, with no dust lost', () => {
    for (const v of [1n, 7n, 999_999n, 123_456_789n]) {
      const [r] = volumeScenarios({ total_fee_bps: 137, creator_bps: 3333, platform_bps: 1500, fee_vest_bps: 5000 }, [v]);
      expect(r!.creator + r!.platform + r!.liquidity).toBe(r!.fee);
      expect(r!.creatorNow + r!.creatorVesting).toBe(r!.creator);
    }
  });
  it('splits the creator slice into claimable now and vesting by fee_vest_bps', () => {
    const [r] = volumeScenarios(STANDARD_FEES, [1_000_000_000n]);
    expect(r!.creatorVesting).toBe(2_500_000n);
    expect(r!.creatorNow).toBe(2_500_000n);
  });
});
