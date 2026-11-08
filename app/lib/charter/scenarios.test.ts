import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets';
import { scenarios } from './scenarios';
import { feePreview } from './form';
import { summarizeFees, summarizeOpening, summarizeRaise, summarizeStream, summarizeTime } from './summary';
import { USDC } from './rules';

const p = { ...PRESETS[0]!.params, symbol: 'ZED', name: 'Zed' };

describe('raise scenarios', () => {
  const rows = scenarios(p)!;
  it('has four rows and the right verdicts', () => expect(rows.map((r) => [r.label, r.verdict])).toEqual([['Below soft cap', 'FAIL'], ['At soft cap', 'PASS'], ['At hard cap', 'PASS'], ['2x oversubscribed', 'PASS']]));
  it('a failed trial refunds everything and draws nothing', () => expect(rows[0]).toMatchObject({ accepted: 0n, stream: 0n, sample: { spend: 0n, refund: 100n * USDC, tokens: 0n } }));
  it('at the hard cap the launch fee is 1.5% and conservation holds', () => {
    const r = rows[2]!;
    expect(r.launchFee).toBe(15n * USDC);
    expect(r.launchFee + r.lpSeed + r.stream).toBe(r.accepted);
    expect(r.streamPerDay).toBe(r.stream / 90n);
  });
  it('oversubscription refunds the excess pro rata', () => {
    const r = rows[3]!;
    expect(r.accepted).toBe(1000n * USDC);
    expect(r.refundPool).toBe(1000n * USDC);
    expect(r.sample.spend + r.sample.refund).toBe(100n * USDC);
    expect(r.sample.refund).toBe(50n * USDC);
  });
  it('returns null on unusable input', () => expect(scenarios({ ...p, soft_cap: 0n })).toBeNull());
});

describe('summaries', () => {
  it('raise sentence', () => expect(summarizeRaise(p)).toBe('If $350 or more is committed by at least 10 backers when the Walk window ends, the trial passes. Otherwise every backer gets a refund.'));
  it('time sentence', () => expect(summarizeTime(p)).toContain('Commits close 3 days later. Backers can still Walk for 6 h'));
  it('stream sentence names STREAM_CAP', () => expect(summarizeStream(p)).toContain('1/90'));
  it('fee sentence carries the creator-maximum qualifier', () => { const s = summarizeFees(p); expect(s).toContain('1.00% of volume'); expect(s).toContain('80%'); });
  it('opening sentence', () => { expect(summarizeOpening(p)).toMatch(/No opening surcharge/); expect(summarizeOpening({ ...p, fees: { ...p.fees, opening_fee_start_bps: 500, opening_decay_minutes: 60 } })).toBe('Trading opens at 5% and falls to 1% over 60 minutes; the extra goes to liquidity.'); });
  it('fee preview at the standard split is 0.50% creator', () => expect(feePreview(p).find((r) => r.label.startsWith('Creator'))?.pct).toBe('0.50%'));
});
