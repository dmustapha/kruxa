import { describe, expect, it } from 'vitest';
import { claimVestedBlock, contractFacts, instantTiles, linearUnlocked, vestSchedule } from './instant';
import { INSTANT_NOTICE_TITLE, MODE_LABEL, launchMode } from './mode';
import { instantCapCheck, selfBuyBlock } from './rules';
import { buildClaimVestedTx } from './tx';
import { phaseOf, tokenState } from './phase';
import type { InstantInfo, LaunchSummary, SafetyIndicator, TokenPageData } from './types';

const DAY = 86_400; const NS = 1_000_000_000n;
const info: InstantInfo = { n_alloc: '50000000000000', creator_alloc_bps: 500, cliff_days: 7, vest_days: 90, opened_at_ns: String(1_000_000n * NS), total_supply: '1000000000000000' };
const lp: SafetyIndicator = { id: 'lp_in_pool', label: 'x', status: 'pass', basis: 'event' };
const l = (o: Partial<LaunchSummary> = {}): LaunchSummary => ({ launch_id: '1000000003', symbol: 'MYC', creator: 'c.testnet', payout_recipient: 'p.testnet', status: 'trading', stage: 'passed', source: 'chain', ...o });
const pg = (launch: Partial<LaunchSummary>, pool: Partial<TokenPageData['pool']> = {}): TokenPageData => ({ launch: l(launch), pool: { open: false, paused: false, ...pool }, stats: {}, safety: [], as_of: { block_height: 1, block_time: 1 }, source: 'chain' });

describe('mode', () => {
  it('has exactly two labels', () => { expect(Object.values(MODE_LABEL).sort()).toEqual(['Instant (no trial)', 'Trial-verified']); });
  it('reads the API, then the pool, then the id range', () => {
    expect(launchMode({ launch_id: '7', mode: 'instant' })).toBe('instant');
    expect(launchMode({ launch_id: '7' }, { mode: 'instant' })).toBe('instant');
    expect(launchMode({ launch_id: '1000000000' })).toBe('instant');
    expect(launchMode({ launch_id: '999999999' })).toBe('trial');
    expect(launchMode({ launch_id: 'x' })).toBe('trial');
  });
  it('the notice names what is missing', () => { expect(INSTANT_NOTICE_TITLE).toBe('Launched instantly: no trial, no refund, no verdict'); });
});

describe('instant phase and state', () => {
  it('launching, trading, failed', () => {
    expect(phaseOf(l({ status: 'launching' }), 0, false)).toBe('LAUNCHING');
    expect(phaseOf(l({ status: 'launching' }), 0, true)).toBe('TRADING');
    expect(phaseOf(l({ status: 'abandoned' }), 0)).toBe('LAUNCH_FAILED');
    expect(tokenState(pg({ status: 'launching' }), 0)).toBe('launching');
    expect(tokenState(pg({ status: 'trading' }, { open: true }), 0)).toBe('trading');
    expect(tokenState(pg({ status: 'trading' }, { open: true, paused: true }), 0)).toBe('halted');
    expect(tokenState(pg({ status: 'aborted' }), 0)).toBe('failed');
  });
  it('never shows trial words for an instant launch', () => {
    expect(tokenState(pg({ status: 'launching', verdict: null }), 0)).not.toBe('trial');
  });
});

describe('vesting', () => {
  const open = 1_000_000;
  it('linear_unlocked matches the floor formula', () => {
    expect(linearUnlocked(1000n, 0n, 100n, 50n)).toBe(500n);
    expect(linearUnlocked(1000n, 0n, 100n, 99n)).toBe(990n);
    expect(linearUnlocked(1000n, 0n, 100n, 100n)).toBe(1000n);
    expect(linearUnlocked(1000n, 10n, 100n, 5n)).toBe(0n);
  });
  it('is zero before the cliff and says when it ends', () => {
    const s = vestSchedule(info, null, open + 3 * DAY);
    expect(s.phase).toBe('cliff'); expect(s.unlocked).toBe(0n); expect(s.claimable).toBe(null);
    expect(s.basis).toBe('schedule estimate'); expect(s.next).toMatch(/Cliff ends/);
  });
  it('after the cliff it is linear from open (INSTANT-ABI section 6) and fully unlocked at vest end', () => {
    const half = vestSchedule(info, null, open + 45 * DAY);
    expect(half.phase).toBe('vesting'); expect(half.unlocked).toBe(25_000_000_000_000n);
    expect(vestSchedule(info, null, open + 90 * DAY).unlocked).toBe(50_000_000_000_000n);
    expect(vestSchedule(info, null, open + 91 * DAY).phase).toBe('done');
  });
  it('prefers the contract view and reports claimable from it', () => {
    const s = vestSchedule(info, { recipient: 'p', total: '100', unlocked: '40', claimed: '10', claimable: '30', cliff_end_ns: String(1n), vest_end_ns: String(2n * NS * 1000000n) }, open + 45 * DAY);
    expect(s.basis).toBe('contract view'); expect(s.claimable).toBe(30n);
  });
  it('is not started before the pool opens', () => { expect(vestSchedule({ n_alloc: '5' }, null, 1).phase).toBe('before_open'); });
  it('gates claim_vested: recipient only, after the cliff, with an amount', () => {
    const cliff = vestSchedule(info, null, open + DAY);
    expect(claimVestedBlock(cliff, 'p', 'p', true)).toMatch(/Cliff ends/);
    const v = vestSchedule(info, { recipient: 'p', total: '100', unlocked: '40', claimed: '10', claimable: '30', cliff_end_ns: '1', vest_end_ns: String(2n * NS * 1000000n) }, open + 45 * DAY);
    expect(claimVestedBlock(v, 'p', 'stranger', true)).toMatch(/Only the payout recipient/);
    expect(claimVestedBlock(v, 'p', 'p', false, 'locked')).toBe('locked');
    expect(claimVestedBlock(v, 'p', 'p', true)).toBeNull();
    expect(claimVestedBlock({ ...v, claimable: 0n }, 'p', 'p', true)).toMatch(/Nothing is claimable/);
    expect(claimVestedBlock({ ...v, claimable: null }, 'p', 'p', true)).toMatch(/unknown/);
  });
  it('builds claim_vested with and without an amount', () => {
    expect(buildClaimVestedTx('instant.kruxa.testnet', '1000000003').actions[0]!.params).toMatchObject({ methodName: 'claim_vested', args: { launch_id: '1000000003' }, deposit: '0' });
    expect(buildClaimVestedTx('i', '1', 5n).actions[0]!.params.args.amount).toBe('5');
    expect(() => buildClaimVestedTx('i', '1', 0n)).toThrow();
  });
});

describe('contract facts and tiles', () => {
  const sched = vestSchedule(info, null, 1_000_000 + 45 * DAY);
  it('says unknown where nothing is logged and never claims authorities or locked liquidity', () => {
    const facts = contractFacts({ totalSupply: null, info: null, sched: vestSchedule(null, null, 1), safety: [], feeTotalBps: null, payout: 'p', token: null, market: 'm' });
    expect(facts.find((f) => f.id === 'supply')!.value).toBe('unknown');
    expect(facts.find((f) => f.id === 'pool')!.status).toBe('unknown');
    expect(facts.find((f) => f.id === 'authorities')!.value).toBe('unknown');
    expect(JSON.stringify(facts).toLowerCase()).not.toMatch(/\blocked\b|audited|\bsafe\b/);
  });
  it('lists the vesting schedule and fees when logged', () => {
    const facts = contractFacts({ totalSupply: '1000000000000000', info, sched, safety: [lp], feeTotalBps: 100, payout: 'p', token: 't', market: 'm' });
    expect(facts.find((f) => f.id === 'vest')!.value).toBe('7 day cliff, linear over 90 days');
    expect(facts.find((f) => f.id === 'pool')!.status).toBe('pass');
    expect(facts.find((f) => f.id === 'fees')!.value).toContain('1%');
    expect(facts.find((f) => f.id === 'solana')!.value).toContain('NEAR only');
  });
  it('instant tiles follow CO-7: no authorities tile, allocation with unlocked and claimed', () => {
    const t = instantTiles({ totalSupply: '1000000000000000', info, sched, safety: [lp], payout: 'p', openingNow: '3.2% now', top10Bps: 1200 });
    expect(t.map((x) => x.id)).toEqual(['lp', 'supply', 'alloc', 'payout', 'opening', 'solana', 'top10']);
    expect(t.find((x) => x.id === 'alloc')!.value).toContain('5%');
    expect(t.some((x) => /authorit/i.test(x.label))).toBe(false);
    expect(JSON.stringify(t).toLowerCase()).not.toMatch(/\blocked\b|audited|\bsafe\b/);
  });
});

describe('market rules for instant pools', () => {
  it('blocks buys by the creator and payout recipient only, only on instant pools', () => {
    expect(selfBuyBlock(true, 'buy', ['c', 'p'], 'c')).toMatch(/R_SELF_BUY/);
    expect(selfBuyBlock(true, 'buy', ['c', 'p'], 'p')).toMatch(/R_SELF_BUY/);
    expect(selfBuyBlock(true, 'sell', ['c', 'p'], 'c')).toBeNull();
    expect(selfBuyBlock(true, 'buy', ['c', 'p'], 'other')).toBeNull();
    expect(selfBuyBlock(false, 'buy', ['c', 'p'], 'c')).toBeNull();
    expect(selfBuyBlock(true, 'buy', ['c', 'p'], null)).toBeNull();
  });
  it('pre-checks the instant sub-cap and admits when it cannot read it', () => {
    expect(instantCapCheck(null, 5n).status).toBe('unknown');
    const cfg = { max_instant_reserve_q: '5000000000', instant_q: '4990000000' };
    expect(instantCapCheck(cfg, 20_000_000n).status).toBe('refused');
    expect(instantCapCheck(cfg, 5_000_000n).status).toBe('ok');
    expect(instantCapCheck(cfg, 20_000_000n).message).toMatch(/R_MARKET_CAP/);
  });
});
