import { describe, expect, it } from 'vitest';
import vectors from '../../fixtures/vectors/verdict.json';
import { allocate, inputsHash, settlePosition, verdict, type VerdictInputs } from './verdict';

const zero = Array<number>(32).fill(0);
const base: VerdictInputs = { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false };

describe('verdict mirrors kruxa-logic', () => {
  it('passes exactly at the boundary and fails one micro-USDC below', () => {
    expect(verdict(base)).toEqual({ pass: true });
    expect(verdict({ ...base, total_active: '349999999' })).toEqual({ pass: false, reasons: 1 });
  });

  // The same file the Rust golden test (`u_verdict_hash_golden`) reads. A hash written by kruxa-sim must come out of this mirror too.
  it.each(vectors.cases)('matches the shared vector $name (outcome and inputs_hash)', (c) => {
    const inputs: VerdictInputs = c.inputs;
    expect(verdict(inputs)).toEqual(c.outcome === 'PASS' ? { pass: true } : { pass: false, reasons: c.reasons });
    expect(inputsHash(inputs)).toBe(c.inputs_hash);
  });

  it('reproduces S1-B example 1 to the unit', () => {
    const a = allocate(12_500_000_000n, 5_000_000_000n, 6000n, 2500n);
    expect([a.launchFee, a.lpQuote, a.stream, a.excessPool]).toEqual([75_000_000n, 2_083_333_333n, 2_841_666_667n, 7_500_000_000n]);
    const p = settlePosition(100_000_000n, 12_500_000_000n, a.accepted, 600_000_000_000_000n, 50_000_000_000_000n);
    expect([p.spend, p.refund, p.tokens]).toEqual([40_000_000n, 60_000_000n, 4_800_000_000_000n]);
  });
});
