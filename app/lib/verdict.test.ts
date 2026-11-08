import { describe, expect, it } from 'vitest';
import { allocate, inputsHash, settlePosition, verdict, type VerdictInputs } from './verdict';

const zero = Array<number>(32).fill(0);
const base: VerdictInputs = { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false };

describe('verdict mirrors kruxa-logic', () => {
  it('passes exactly at the boundary and fails one micro-USDC below', () => {
    expect(verdict(base)).toEqual({ pass: true });
    expect(verdict({ ...base, total_active: '349999999' })).toEqual({ pass: false, reasons: 1 });
  });

  it('pins the hashes printed by `kruxa-sim verdict` (Rust)', () => {
    expect(inputsHash(base)).toBe('c2bd1b3b11872b7f56eda70d71c367d068038a24688f5fe18a5ef2c86d600d29');
    expect(inputsHash({ ...base, total_active: '349999999' })).toBe('b43f5ec3bf27dd8c017f68db97a30adda6aab06224a6e74818cd90042f100dd6');
  });

  it('reproduces S1-B example 1 to the unit', () => {
    const a = allocate(12_500_000_000n, 5_000_000_000n, 6000n, 2500n);
    expect([a.launchFee, a.lpQuote, a.stream, a.excessPool]).toEqual([75_000_000n, 2_083_333_333n, 2_841_666_667n, 7_500_000_000n]);
    const p = settlePosition(100_000_000n, 12_500_000_000n, a.accepted, 600_000_000_000_000n, 50_000_000_000_000n);
    expect([p.spend, p.refund, p.tokens]).toEqual([40_000_000n, 60_000_000n, 4_800_000_000_000n]);
  });
});
