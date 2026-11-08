import { describe, expect, it } from 'vitest';
import { phaseOf, tokenState } from './phase';
import { deriveWindow, windowRows } from './windows';
import { buildMarkers } from './markers';
import { safetyTiles, tileSummary, top10ShareBps } from './tiles';
import { genesisSteps } from './genesis';
import { bookHashCheck, readSnapshot, recompute, summarize, tampered, verifyCommand, type ChainSnapshot } from './verify';
import { allocate, inputsHash, type VerdictInputs } from '@/lib/verdict';
import type { LaunchDetail, LaunchSummary, TokenPageData, Trade } from './types';

const launch = (o: Partial<LaunchSummary> = {}): LaunchSummary => ({ launch_id: '1', symbol: 'A', creator: 'c.testnet', payout_recipient: 'c.testnet', status: 'open', stage: 'open', source: 'chain', ...o });
const page = (l: Partial<LaunchSummary>, pool: Partial<TokenPageData['pool']> = {}, safety: TokenPageData['safety'] = []): TokenPageData => ({
  launch: launch(l), pool: { open: false, paused: false, ...pool }, stats: {}, safety, as_of: { block_height: 1, block_time: 1 }, source: 'chain' });

describe('phase and token state', () => {
  it('maps the lifecycle vocabulary', () => {
    expect(phaseOf(launch({ opens_at: 200 }), 100)).toBe('SCHEDULED');
    expect(phaseOf(launch({ stage: 'open' }), 100)).toBe('OPEN');
    expect(phaseOf(launch({ stage: 'closing', walk_end: 500 }), 100)).toBe('WALK_WINDOW');
    expect(phaseOf(launch({ stage: 'closing', walk_end: 50 }), 100)).toBe('AWAITING_SETTLE');
    expect(phaseOf(launch({ verdict: 'PASS', stage: 'passed', status: 'passed' }), 100)).toBe('PASS');
    expect(phaseOf(launch({ verdict: 'PASS', stage: 'passed', status: 'passed', has_market: true }), 100)).toBe('TRADING');
    expect(phaseOf(launch({ verdict: 'FAIL', stage: 'failed', status: 'failed' }), 100)).toBe('FAIL');
    expect(phaseOf(launch({ status: 'dissolved' }), 100)).toBe('DISSOLVED');
    expect(phaseOf(launch({ phase: 'WALK_WINDOW', stage: 'open' }), 100)).toBe('WALK_WINDOW');
  });
  it('picks the token-page state', () => {
    expect(tokenState(page({}), 0)).toBe('trial');
    expect(tokenState(page({ verdict: 'FAIL', stage: 'failed', status: 'failed' }), 0)).toBe('failed');
    expect(tokenState(page({ verdict: 'PASS', stage: 'passed', status: 'passed' }), 0)).toBe('genesis');
    expect(tokenState(page({ verdict: 'PASS', stage: 'passed', status: 'passed' }, { open: true }), 0)).toBe('trading');
    expect(tokenState(page({ verdict: 'PASS', stage: 'passed', status: 'passed' }, { open: true, paused: true }), 0)).toBe('halted');
  });
});

const tr = (time: number, price: number, side: 'buy' | 'sell' = 'buy', trader = 'x.testnet', q = '1000000'): Trade => ({ launch_id: '1', side, trader, amount_in: '1', amount_out: '1', price, quote_amount: q, fee_total: '1', block_height: 1, receipt_id: `r${time}`, time, source: 'chain' });

describe('window stats from swaps', () => {
  const trades = [tr(1000, 2, 'sell'), tr(900, 1.5, 'buy'), tr(500, 1, 'buy'), tr(100, 1, 'buy')];
  it('computes change, counts and volume when the swaps reach the window start', () => {
    const w = deriveWindow(trades, 1000, '1h', true);
    expect(w.basis).toBe('swaps');
    expect(w.buys).toBe(3); expect(w.sells).toBe(1);
    expect(w.buyVolume).toBe(3); expect(w.sellVolume).toBe(1);
    expect(w.change_pct).toBeCloseTo(100, 5);
  });
  it('says unknown when the list does not reach back far enough', () => {
    const old = [tr(100000, 2), tr(99000, 1)];
    expect(deriveWindow(old, 100000, '24h', false).basis).toBe('unknown');
    expect(deriveWindow(old, 100000, '24h', true).basis).toBe('swaps');
  });
  it('prefers API windows', () => {
    const rows = windowRows({ '1h': { change_pct: 3, buys: 1, sells: 2 } }, trades, 1000, true);
    expect(rows.find((r) => r.key === '1h')!.basis).toBe('api');
  });
});

describe('markers', () => {
  const range = { from: 0, to: 10_000 };
  it('marks only known creator accounts and snaps to the bucket', () => {
    const t = [tr(3700, 1, 'sell', 'creator.testnet'), tr(3700, 1, 'sell', 'stranger.testnet'), tr(3700, 1, 'buy', 'creator.testnet')];
    const m = buildMarkers(t, [{ launch_id: '1', kind: 'creator_claimed', amount: '1', block_height: 1, receipt_id: 'a', time: 7300, source: 'chain' }, { launch_id: '1', kind: 'stream_draw', amount: '1', block_height: 1, receipt_id: 'b', time: 7300, source: 'chain' }], ['creator.testnet'], '1h', range);
    expect(m.map((x) => [x.kind, x.time])).toEqual([['creator_sell', 3600], ['creator_claim', 7200], ['stream_draw', 7200]]);
  });
  it('draws nothing without a range', () => { expect(buildMarkers([tr(1, 1, 'sell', 'c')], [], ['c'], '1h', null)).toEqual([]); });
});

describe('safety tiles', () => {
  const ind = (id: string, status: 'pass' | 'unknown', basis: 'event' | 'not_indexed') => ({ id, label: id, status, basis });
  it('shows None only when the data says so and unknown otherwise', () => {
    const tiles = safetyTiles(page({}, {}, [ind('mint_authority_null', 'pass', 'event'), ind('freeze_authority_null', 'unknown', 'not_indexed')]), undefined, undefined, undefined);
    expect(tiles.find((t) => t.id === 'mint_authority_null')!.value).toBe('None (null)');
    expect(tiles.find((t) => t.id === 'freeze_authority_null')!.status).toBe('unknown');
    expect(tiles.find((t) => t.id === 'lp')!.value).toBe('unknown');
    expect(tiles.find((t) => t.id === 'stream')!.status).toBe('unknown');
    expect(tiles.find((t) => t.id === 'top10')!.status).toBe('unknown');
  });
  it('claims no LP property unless lp_in_pool is a logged pass, and never says locked', () => {
    const t = safetyTiles(page({}, {}, [ind('lp_in_pool', 'pass', 'event')]), undefined, undefined, undefined).find((x) => x.id === 'lp')!;
    expect(t.status).toBe('pass');
    expect(JSON.stringify(t).toLowerCase()).not.toContain('locked');
    expect(safetyTiles(page({}, {}, [ind('lp_in_pool', 'pass', 'not_indexed')]), undefined, undefined, undefined).find((x) => x.id === 'lp')!.status).toBe('unknown');
  });
  it('sums the top ten holders without the pool', () => {
    const h = [{ holder: 'pool', balance: '1', share_bps: 6000, is_pool: true }, { holder: 'a', balance: '1', share_bps: 1000 }, { holder: 'b', balance: '1', share_bps: 500 }];
    expect(top10ShareBps(h)).toBe(1500);
    expect(top10ShareBps([])).toBeNull();
  });
  it('builds the verdict tile from inputs and summarises', () => {
    const d = { ...launch(), charter_hash: 'h', verdict_inputs: { total_active: '87000000', funders: 4, soft_cap: '50000000', min_funders: 3, book_hash_folded: 'x' } } as LaunchDetail;
    const tiles = safetyTiles(page({}), undefined, undefined, d);
    expect(tiles.find((t) => t.id === 'verdict_inputs')!.value).toContain('$87 of $50');
    expect(tileSummary(tiles).total).toBe(6);
  });
});

describe('genesis steps', () => {
  const d = { ...launch({ verdict: 'PASS' }), charter_hash: 'h', verdict_inputs: { total_active: '1', funders: 1, book_hash_folded: 'x' }, timeline: [{ event: 'verdict', block_height: 1, receipt_id: 'R1', source: 'chain' as const }, { event: 'settled', block_height: 2, receipt_id: 'R2', source: 'chain' as const }] } as LaunchDetail;
  it('marks Solana steps unknown when the indexer has no genesis object', () => {
    const steps = genesisSteps(page({ verdict: 'PASS' }), d, false);
    expect(steps.find((s) => s.id === 'committed')!.state).toBe('unknown');
    expect(steps.find((s) => s.id === 'verdict')).toMatchObject({ state: 'done', receipt: 'R1' });
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
  });
  it('does not call the mint done unless both authorities are logged null', () => {
    const p = { ...page({ verdict: 'PASS' }), genesis: { stage: 'confirmed' as const, mint_authority: 'unknown' as const, freeze_authority: 'null' as const } };
    expect(genesisSteps(p, d, false).find((s) => s.id === 'confirmed')!.state).not.toBe('done');
  });
  it('reads the genesis stage and the pool state', () => {
    const p = { ...page({ verdict: 'PASS' }), genesis: { stage: 'confirmed' as const, network: 'devnet', path: 'F1' as const, mint_authority: 'null' as const, freeze_authority: 'null' as const } };
    const steps = genesisSteps(p, d, true);
    expect(steps.find((s) => s.id === 'confirmed')!.state).toBe('done');
    expect(steps.find((s) => s.id === 'distributor')!.state).toBe('pending');
    expect(steps.find((s) => s.id === 'pool')!.state).toBe('current');
  });
});

describe('verify recompute', () => {
  const inputs: VerdictInputs = { launch_id: '1', charter_hash: Array(32).fill(7), total_active: '87000000', active_funders: 4, soft_cap: '50000000', min_funders: 3, cancelled: false };
  const alloc = allocate(87_000_000n, 1_000_000_000n, 6000n, 2500n);
  const settlement = { pass: true, reasons: 0, total_active: '87000000', accepted: String(alloc.accepted), launch_fee: String(alloc.launchFee), lp_quote: String(alloc.lpQuote), stream: String(alloc.stream), excess_pool: String(alloc.excessPool), inputs_hash: inputsHash(inputs) };
  const snap: ChainSnapshot = { inputs, storedInputsHash: inputsHash(inputs), settlement, bookHash: 'bh', charter: { sale_bps: 6000, lp_bps: 2500, hard_cap: '1000000000' } };
  it('matches on honest data', () => {
    const c = recompute(snap, false);
    expect(c.map((x) => x.status)).toEqual(['MATCH', 'MATCH', 'MATCH', 'MATCH']);
    expect(summarize(c)).toBe('MATCH');
  });
  it('the tamper toggle flips one unit and must show MISMATCH', () => {
    expect(tampered(inputs).total_active).toBe('87000001');
    const c = recompute(snap, true);
    expect(c[0]!.status).toBe('MISMATCH');
    expect(summarize(c)).toBe('MISMATCH');
  });
  it('is PENDING before settle and UNAVAILABLE (not MISMATCH) when a read fails', async () => {
    expect(summarize(recompute({ ...snap, settlement: null }, false))).toBe('PENDING');
    const bad = await readSnapshot('1', { getVerdictInputs: async () => { throw new Error('rpc down\nstack'); }, getState: async () => null, getSettlement: async () => null, getCharter: async () => null });
    expect(bad).toEqual({ status: 'unavailable', message: 'rpc down' });
    expect(bookHashCheck('a', null).status).toBe('UNAVAILABLE');
    expect(bookHashCheck('a', 'b').status).toBe('MISMATCH');
    expect(summarize([bookHashCheck('a', null)])).toBe('UNAVAILABLE');
  });
  it('builds the command', () => { expect(verifyCommand('7')).toBe('./scripts/verify.sh 7'); });
});
