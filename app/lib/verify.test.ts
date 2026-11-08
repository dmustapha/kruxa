import { describe, expect, it } from 'vitest';
import { bookHashCheck, recompute, summarize, tampered, type ChainSnapshot } from './verify';
import { allocate, inputsHash, type VerdictInputs } from './verdict';
import type { Settlement } from './near';

const inputs: VerdictInputs = { launch_id: '1', charter_hash: Array<number>(32).fill(0), total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false };
const a = allocate(350_000_000n, 1_000_000_000n, 6000n, 2500n);
const settlement: Settlement = {
  pass: true, reasons: 0, settled_at: '1', total_active: '350000000', accepted: a.accepted.toString(), launch_fee: a.launchFee.toString(), lp_quote: a.lpQuote.toString(),
  stream: a.stream.toString(), excess_pool: a.excessPool.toString(), inputs_hash: inputsHash(inputs), book_hash: 'bb',
};
const snap = (over: Partial<ChainSnapshot> = {}): ChainSnapshot => ({
  inputs, storedInputsHash: inputsHash(inputs), settlement, state: { total_active: inputs.total_active, active_funders: 10, book_hash: 'bb' },
  charter: { sale_bps: 6000, lp_bps: 2500, hard_cap: '1000000000' }, ...over,
});

describe('recompute', () => {
  it('an honest settled launch is all MATCH', () => {
    const checks = recompute(snap(), { tamper: false });
    expect(checks.map((c) => c.status)).toEqual(['MATCH', 'MATCH', 'MATCH', 'MATCH']);
    expect(summarize(checks)).toBe('MATCH');
  });
  it('tamper (+1 unit) must print MISMATCH', () => {
    const checks = recompute(snap(), { tamper: true });
    expect(summarize(checks)).toBe('MISMATCH');
    expect(checks[0]).toMatchObject({ id: 'V1', status: 'MISMATCH' });
  });
  it('a stored hash that was altered is MISMATCH without any tamper switch', () => {
    expect(summarize(recompute(snap({ storedInputsHash: 'deadbeef' }), { tamper: false }))).toBe('MISMATCH');
  });
  it('a stored verdict that disagrees with the rule is MISMATCH', () => {
    expect(recompute(snap({ settlement: { ...settlement, pass: false, reasons: 1 } }), { tamper: false }).find((c) => c.id === 'V2')?.status).toBe('MISMATCH');
  });
  it('an unsettled launch is PENDING, not MATCH', () => {
    const checks = recompute(snap({ settlement: null }), { tamper: false });
    expect(checks.find((c) => c.id === 'V2')?.status).toBe('PENDING');
    expect(summarize(checks)).toBe('PENDING');
  });
  it('tamper only touches total_active', () => expect(tampered(inputs)).toEqual({ ...inputs, total_active: '350000001' }));
});

describe('book hash cross-check', () => {
  it('matches, differs, and degrades to UNAVAILABLE rather than MISMATCH when a side is missing', () => {
    expect(bookHashCheck('aa', 'aa').status).toBe('MATCH');
    expect(bookHashCheck('aa', 'bb').status).toBe('MISMATCH');
    expect(bookHashCheck('aa', null).status).toBe('UNAVAILABLE');
    expect(bookHashCheck(null, 'bb').status).toBe('UNAVAILABLE');
  });
  it('an unavailable check never turns the summary into MISMATCH', () => expect(summarize([{ id: 'x', label: '', status: 'UNAVAILABLE' }, { id: 'y', label: '', status: 'MATCH' }])).toBe('UNAVAILABLE'));
});
