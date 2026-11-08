import { describe, expect, it, vi } from 'vitest';
import { askLauncher, isInstantId, launcherConfig } from './preview';
import { DAY_NS, INSTANT_DEFAULTS, INSTANT_FEES, LOCAL_LIMITS, TOTAL_SUPPLY, cliffEnd, deriveInstant, rateLimited, termWord, unitInfo, unlockedAt, validateInstant, vestEnd, type InstantParams } from './rules';
import { USDC } from '../charter/rules';
import { OPEN_INSTANT_GAS_TGAS, abandonInstantNear, abortInstantNear, claimVestedNear, createInstantNear, openInstantNear, seedInstantNear } from '../actions';

const ok: InstantParams = { ...INSTANT_DEFAULTS, name: 'Zed', symbol: 'ZED' };
const codes = (p: InstantParams, limits = LOCAL_LIMITS): string[] => validateInstant(p, limits).map((v) => v.code);

describe('instant rules mirror (INSTANT-ABI section 5)', () => {
  it('defaults pass', () => expect(codes(ok)).toEqual([]));
  it('one failing case per code', () => {
    expect(codes({ ...ok, symbol: 'zed' })).toContain('R_SYMBOL');
    expect(codes({ ...ok, symbol: 'KRUXA' })).toContain('R_SYMBOL_RESERVED');
    expect(codes({ ...ok, creator_alloc_bps: 1001 })).toContain('R_ALLOC');
    expect(codes({ ...ok, vest_days: 29 })).toContain('R_VEST');
    expect(codes({ ...ok, cliff_days: 6 })).toContain('R_VEST');
    expect(codes({ ...ok, cliff_days: 30, vest_days: 30 })).toEqual([]);
    expect(codes({ ...ok, seed_q: 99n * USDC })).toContain('R_SEED_RANGE');
    expect(codes({ ...ok, seed_q: 1001n * USDC })).toContain('R_SEED_RANGE');
    expect(codes({ ...ok, fees: { ...ok.fees, total_fee_bps: 201 } })).toContain('R_FEE_TOTAL');
  });
  it('boundaries are inclusive', () => { expect(codes({ ...ok, seed_q: 100n * USDC })).toEqual([]); expect(codes({ ...ok, seed_q: 1000n * USDC, creator_alloc_bps: 1000, vest_days: 365 })).toEqual([]); expect(codes({ ...ok, creator_alloc_bps: 0 })).toEqual([]); });
  it('the seed must exceed the launcher\'s own launch fee, and the launcher\'s bounds replace the local defaults', () => {
    expect(codes({ ...ok, seed_q: 100n * USDC }, { ...LOCAL_LIMITS, launchFee: 100n * USDC })).toContain('R_SEED_RANGE');
    expect(codes({ ...ok, seed_q: 50n * USDC }, { ...LOCAL_LIMITS, seedMin: 10n * USDC })).toEqual([]);
  });
  it('default fees carry the opening decay the launcher uses (500 bps over 60 minutes)', () => { expect(INSTANT_DEFAULTS.fees).toEqual(INSTANT_FEES); expect(INSTANT_FEES.opening_fee_start_bps).toBe(500); expect(INSTANT_FEES.opening_decay_minutes).toBe(60); expect(codes(ok)).toEqual([]); });
});

describe('derive (exact split)', () => {
  it('pool plus allocation is the whole supply for every bps', () => {
    for (const bps of [0, 1, 333, 500, 999, 1000]) { const d = deriveInstant({ ...ok, creator_alloc_bps: bps }, 0n); expect(d.nAlloc + d.nPool).toBe(TOTAL_SUPPLY); }
  });
  it('5% default and the seed net of the fee', () => {
    const d = deriveInstant(ok, 10n * USDC);
    expect(d.nAlloc).toBe(50_000_000n * 1_000_000n);
    expect(d.poolSeed).toBe(240n * USDC);
    expect(d.openPriceUsdc).toBeCloseTo(240 / 950_000_000, 12);
  });
});

describe('vesting (IL-5)', () => {
  const i = { nAlloc: 90_000_000n, openedAt: 1000, cliffDays: 7, vestDays: 90 };
  it('zero until the cliff, exact at the boundary', () => {
    expect(unlockedAt(i, 1000)).toBe(0n);
    expect(unlockedAt(i, cliffEnd(i) - 1)).toBe(0n);
    expect(unlockedAt(i, cliffEnd(i))).toBe((90_000_000n * 7n) / 90n);
  });
  it('monotonic and complete at the end, capped after', () => {
    let prev = 0n;
    for (let d = 0; d <= 120; d += 3) { const u = unlockedAt(i, 1000 + d * 86400); expect(u >= prev).toBe(true); prev = u; }
    expect(unlockedAt(i, vestEnd(i))).toBe(90_000_000n);
    expect(unlockedAt(i, vestEnd(i) + 10_000_000)).toBe(90_000_000n);
  });
  it('the demo clock unit scales it', () => expect(unlockedAt({ ...i, unitSecs: 10 }, 1000 + 70)).toBe((90_000_000n * 70n) / 900n));
});

describe('unit (never a day unless the launcher says so)', () => {
  it('day only for exactly 86,400 s; other units and a missing unit are named as such', () => {
    expect(termWord(7, unitInfo(DAY_NS))).toBe('7 days'); expect(termWord(1, unitInfo(DAY_NS))).toBe('1 day');
    expect(termWord(7, unitInfo('10000000000'))).toBe('7 units (10 s each)');
    expect(termWord(7, unitInfo(null))).toBe('7 units (length not known)');
    expect(termWord(7, unitInfo('abc'))).toBe('7 units (length not known)');
    expect(unitInfo('10000000000').kind).toBe('other'); expect(unitInfo(DAY_NS).kind).toBe('day'); expect(unitInfo(undefined).kind).toBe('unknown');
  });
});

describe('rate limit and ids', () => {
  it('one unit window, and unknown when the unit is unknown', () => {
    const day = unitInfo(DAY_NS);
    expect(rateLimited([100], 100 + 86399, day)).toBe(true); expect(rateLimited([100], 100 + 86400, day)).toBe(false); expect(rateLimited([], 5, day)).toBe(false);
    expect(rateLimited([100], 101, unitInfo(null))).toBeNull();
    expect(rateLimited([100], 105, unitInfo('10000000000'))).toBe(true);
    expect(rateLimited([100], 111, unitInfo('10000000000'))).toBe(false);
  });
  it('instant ids start at 1e9', () => { expect(isInstantId('1000000000')).toBe(true); expect(isInstantId('999999999')).toBe(false); expect(isInstantId('abc')).toBe(false); });
});

describe('askLauncher', () => {
  it('the launcher returns violations as strings; both shapes become codes, and its launch fee and pool seed are kept', async () => {
    expect(await askLauncher(ok, null, async () => ({ ok: false, violations: ['R_RATE_LIMIT: wait', { code: 'R_SEED_RANGE' }] }))).toEqual({ kind: 'refused', violations: [{ code: 'R_RATE_LIMIT' }, { code: 'R_SEED_RANGE' }] });
    expect(await askLauncher(ok, null, async () => ({ ok: true, launch_fee: '10000000', pool_seed_q: '240000000', required_deposit: '1' }))).toMatchObject({ kind: 'ok', launchFee: '10000000', poolSeed: '240000000' });
  });
  it('reads preview_instant', async () => {
    const v = vi.fn(async () => ({ ok: true, required_deposit: '131250000000000000000000', pool_seed_q: '250000000' }));
    expect(await askLauncher(ok, 'maya.testnet', v)).toMatchObject({ kind: 'ok', deposit: '131250000000000000000000' });
    const call = (v.mock.calls as unknown as [string, Record<string, unknown>][])[0]!;
    expect(call[0]).toBe('preview_instant');
    expect(Object.keys(call[1]).sort()).toEqual(['creator', 'params']); // the contract takes (params, creator) only
  });
  it('refusals carry the launcher codes', async () => expect(await askLauncher(ok, null, async () => ({ ok: false, violations: [{ code: 'R_RATE_LIMIT' }] }))).toEqual({ kind: 'refused', violations: [{ code: 'R_RATE_LIMIT' }] }));
  it('an undeployed launcher is not_deployed, an RPC failure is unreachable', async () => {
    expect((await askLauncher(ok, null, async () => { throw new Error('Account instant.kruxa.testnet does not exist'); })).kind).toBe('not_deployed');
    expect((await askLauncher(ok, null, async () => { throw new Error('fetch failed'); })).kind).toBe('unreachable');
    expect((await launcherConfig(async () => { throw new Error('fetch failed'); })).kind).toBe('unreachable');
  });
});

describe('instant transactions', () => {
  it('seed is a USDC ft_transfer_call with the seed_instant message and 1 yocto', () => {
    const t = seedInstantNear('1000000007', 250n * USDC);
    const a = t.actions[0]!.params;
    expect(a.methodName).toBe('ft_transfer_call'); expect(a.deposit).toBe('1');
    expect(JSON.parse((a.args as { msg: string }).msg)).toEqual({ v: 1, op: 'seed_instant', launch_id: '1000000007' });
    expect((a.args as { amount: string }).amount).toBe('250000000');
  });
  it('the creator ends an unseeded launch with abandon_instant: the contract has no cancel_instant', () => {
    expect(abandonInstantNear('1000000007').actions[0]!.params).toMatchObject({ methodName: 'abandon_instant', deposit: '0', args: { launch_id: '1000000007' } });
    expect(JSON.stringify([abandonInstantNear('1'), abortInstantNear('1')])).not.toContain('cancel_instant');
  });
  it('open_instant attaches the stated gas (300 Tgas until the launcher owner measures a minimum)', () => {
    expect(OPEN_INSTANT_GAS_TGAS).toBe(300);
    expect(openInstantNear('1').actions[0]!.params.gas).toBe('300000000000000');
  });
  it('create carries the deposit, open is permissionless with no deposit, claim passes null for all', () => {
    expect(createInstantNear({}, null, '5').actions[0]!.params).toMatchObject({ methodName: 'create_instant', deposit: '5' });
    expect(openInstantNear('1').actions[0]!.params).toMatchObject({ methodName: 'open_instant', deposit: '0' });
    expect(claimVestedNear('1', null).actions[0]!.params.args).toEqual({ launch_id: '1', amount: null });
  });
});
