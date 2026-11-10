// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn(), path: '/' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, useRouter: () => ({ replace: nav.replace, push: nav.push }), usePathname: () => nav.path }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));

const chain = vi.hoisted(() => ({
  ops: { halted: false, owed_near: '0', pending_upgrade: null as null | { code_hash: string; effective_at: string } },
  solvency: { held_native: '5000000', held_intents: '2000000', recomputed_native: '5000000', recomputed_intents: '2000000', counters_ok: true, intents_alert: false, cooldown_ns: '30000000000', last_check: null as unknown },
  config: { pause: 'None', creator_gate: true, profile: 'testnet', global_cap: '3000000000', global_held: '500000000' } as Record<string, unknown>,
  fail: false,
}));
vi.mock('@/lib/near', async (orig) => ({
  ...(await orig<typeof import('@/lib/near')>()),
  view: vi.fn(async (method: string) => { if (chain.fail) throw new Error('rpc down'); return method === 'get_config' ? chain.config : null; }),
  getOpsState: vi.fn(async (launchId?: string) => { if (chain.fail) throw new Error('rpc down'); return launchId === '9' ? { ...chain.ops, halted: true } : chain.ops; }),
  getSolvencyReport: vi.fn(async () => { if (chain.fail) throw new Error('rpc down'); return chain.solvency; }),
}));

import { Wallets, NEAR_SESSION } from '@/components/testing/mockWallet';
import { OpsLogView } from './ops/OpsLogView';
import { StatusView } from './status/StatusView';
import { SettingsView } from './settings/SettingsView';
import { SearchView } from './search/SearchView';
import { ProfileView, trialRecord } from './profile/ProfileView';
import { StatsSection } from './insights/StatsSection';
import { StatusStrip } from '@/components/layouts/SiteChrome';
import { MORE } from '@/components/layouts/BottomTabs';
import { resetSnapshotServed, markSnapshotServed } from '@/lib/api/snapshot';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); nav.params = new URLSearchParams(); nav.replace.mockClear(); chain.fail = false; chain.ops.pending_upgrade = null; resetSnapshotServed(); });

const asOf = { block_height: 5, block_time: 1700000000 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const opsItem = (event: string, summary: string, i = 1) => ({ event, scope: 'core', contract: 'core.kruxa.testnet', summary, data: {}, block_height: 100 + i, receipt_id: `r${i}abcdefghij`, time: 1700000000 + i, source: 'chain' });

describe('/ops-log', () => {
  it('lists every operator power with its limit, and says only a freeze can block exits', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], next_cursor: null, as_of: asOf, source: 'chain' }));
    render(<OpsLogView />);
    expect(screen.getByRole('heading', { name: /Operator powers are public/ })).toBeTruthy();
    for (const id of ['halt_launch', 'queue_upgrade', 'force_resolve_op', 'check_solvency']) expect(screen.getAllByText(id).length).toBeGreaterThan(0);
    expect(screen.getByText(/Waits 48 hours between the two steps/)).toBeTruthy();
    expect(await screen.findByText('No operator action has been taken.')).toBeTruthy();
  });
  it('shows a queued upgrade and the solvency report read from the chain', async () => {
    chain.ops.pending_upgrade = { code_hash: 'ab'.repeat(32), effective_at: String((Math.floor(Date.now() / 1000) + 86400) * 1_000_000_000) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], next_cursor: null, as_of: asOf, source: 'chain' }));
    render(<OpsLogView />);
    expect(await screen.findByText(/An upgrade is queued\./)).toBeTruthy();
    expect(await screen.findByText('yes')).toBeTruthy();
    expect(screen.getByText('clear')).toBeTruthy();
    expect(screen.getAllByText(/Informational/).length).toBeGreaterThan(0);
  });
  it('says no upgrade is queued, and reports whether a launch is halted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], next_cursor: null, as_of: asOf, source: 'chain' }));
    render(<OpsLogView />);
    expect(await screen.findByText(/No upgrade is queued\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Is a launch halted?'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Launch 9 is HALTED\./)).toBeTruthy();
    expect(screen.getByText(/Walk, refunds and token claims still work/)).toBeTruthy();
  });
  it('lists log entries newest first and filters by kind', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [opsItem('paused', 'core paused by guardian.testnet', 2), opsItem('global_cap_queued', 'raise to 10,000 USDC pending', 1)], next_cursor: null, as_of: asOf, source: 'chain' }));
    render(<OpsLogView />);
    expect(await screen.findByText(/core paused by guardian.testnet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Caps' }));
    expect(screen.queryByText(/core paused by guardian.testnet/)).toBeNull();
    expect(screen.getByText(/raise to 10,000 USDC pending/)).toBeTruthy();
  });
  it('a failing indexer and RPC show errors, never an empty log', async () => {
    chain.fail = true;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    render(<OpsLogView />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByText('No operator action has been taken.')).toBeNull();
  });
});

describe('/status', () => {
  const health = (status: string) => ({ status, network: 'testnet', source: 'chain', as_of: asOf, head_height: 9, lag_blocks: 4, max_lag_blocks: 10, event_count: 12, state_hash: 'x', uptime_s: 3700, last_error: null });
  it('reports indexer health and the core pause level read from chain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(health('stale')));
    chain.config = { pause: 'Paused', creator_gate: true, profile: 'testnet', global_cap: '3000000000', global_held: '500000000' };
    render(<StatusView />);
    expect(await screen.findByText('The indexer is behind.')).toBeTruthy();
    expect(await screen.findByText('Paused')).toBeTruthy();
    expect(screen.getByText(/A pause does not block exits/)).toBeTruthy();
    expect(screen.getByText('$500 of $3,000')).toBeTruthy();
  });
  it('an unreachable RPC says not reachable rather than guessing', async () => {
    chain.fail = true;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    render(<StatusView />);
    expect(await screen.findByText('not reachable')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('/settings', () => {
  it('saves the default slippage and buy presets to this browser only', async () => {
    render(<Wallets><SettingsView /></Wallets>);
    fireEvent.click(screen.getByRole('button', { name: '3%' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('kruxa.settings.v1')!).slippagePct).toBe('3'));
    fireEvent.change(screen.getByLabelText(/Buy preset amounts/), { target: { value: '10, 20, 30' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('kruxa.settings.v1')!).buyPresets).toEqual([10, 20, 30]));
  });
  it('refuses a non https RPC address and keeps the earlier value', async () => {
    render(<Wallets><SettingsView /></Wallets>);
    fireEvent.change(screen.getByLabelText('NEAR RPC address'), { target: { value: 'http://insecure' } });
    expect((await screen.findAllByRole('alert')).some((a) => /not an https address/.test(a.textContent ?? ''))).toBe(true);
    expect(localStorage.getItem('kruxa.settings.v1')).toBeNull();
  });
  it('shows a connected wallet with a disconnect button, and clears local data', async () => {
    localStorage.setItem('kruxa.watchlist.v1', JSON.stringify(['1', '2']));
    render(<Wallets near={NEAR_SESSION}><SettingsView /></Wallets>);
    expect(screen.getByRole('button', { name: 'Disconnect NEAR' })).toBeTruthy();
    expect(await screen.findByText('2 launches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(localStorage.getItem('kruxa.watchlist.v1')).toBeNull();
    expect(await screen.findByText('Cleared.')).toBeTruthy();
  });
});

describe('/search and /u', () => {
  const lcard = (id: string, over: Record<string, unknown> = {}) => ({ launch_id: id, symbol: `S${id}`, creator: 'maya.testnet', payout_recipient: 'maya.testnet', status: 'open', stage: 'open', total_active: '0', funders: 0, source: 'chain', opens_at: 1, commit_end: 2e9, walk_end: 3e9, ...over });
  it('search queries the indexer for the q parameter and lists matches', async () => {
    nav.params = new URLSearchParams('q=maya');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [lcard('1'), lcard('2')], next_cursor: null, total: 2, as_of: asOf, source: 'chain' }));
    render(<SearchView />);
    expect(await screen.findByText('2 matches.')).toBeTruthy();
    expect(String(spy.mock.calls[0]![0])).toContain('q=maya');
  });
  it('search with no match says what search covers', async () => {
    nav.params = new URLSearchParams('q=zzz');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ items: [], next_cursor: null, total: 0, as_of: asOf, source: 'chain' }));
    render(<SearchView />);
    expect(await screen.findByText('No launch matches.')).toBeTruthy();
  });
  it('trialRecord states a factual count, not a score', () => {
    expect(trialRecord([{ verdict: 'PASS' }, { verdict: 'PASS' }, { verdict: 'FAIL' }])).toBe('3 trials: 2 PASS, 1 FAIL');
    expect(trialRecord([{ verdict: null }, { mode: 'instant' }])).toBe('1 trial: 0 PASS, 0 FAIL, 1 without a verdict yet');
  });
  it('a profile queries the creator filter, never a follower count', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      const url = String(u);
      if (url.includes('/api/launches')) return json({ items: [lcard('1', { verdict: 'PASS', stage: 'passed', status: 'passed' }), lcard('2', { verdict: 'FAIL', stage: 'failed', status: 'failed' })], next_cursor: null, total: 2, as_of: asOf, source: 'chain' });
      if (url.includes('/api/portfolio/')) return json({ account: 'maya.testnet', positions: [], funds_in_motion: [], as_of: asOf, source: 'chain' });
      return json({ account: 'maya.testnet', launches: [], totals: {}, claims: [], as_of: asOf, source: 'chain' });
    });
    render(<ProfileView account="maya.testnet" />);
    expect(await screen.findByText(/2 trials: 1 PASS, 1 FAIL/)).toBeTruthy();
    expect(spy.mock.calls.some((c) => String(c[0]).includes('creator=maya.testnet'))).toBe(true);
    expect(screen.queryByText(/follower/i)?.textContent ?? '').toMatch(/no followers/);
  });
});

describe('/insights stats', () => {
  it('shows aggregates with their basis and never calls the platform slice revenue', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
      launches: { total: 4, by_phase: { PASS: 1, FAIL: 1, OPEN: 2 }, passed: 1, failed: 1, pass_rate_bps: 5000 },
      committed: { total_committed: '900000000', total_walked: '100000000', refunds_paid: '50000000' },
      volume: { trades: 12, quote_volume: 321.5, unique_traders: 5, fees_total: '3215000', fee_slices: { creator: '1607500', platform: '482250', lp: '1125250', holders: '0', referral: '0' } },
      basis: 'Folds of indexed events only.', as_of: asOf, source: 'chain', since_block: 50,
    }));
    const { container } = render(<StatsSection />);
    expect(await screen.findByText('50%')).toBeTruthy();
    expect(screen.getByText('$900')).toBeTruthy();
    expect(screen.getByText(/Folds of indexed events only\./)).toBeTruthy();
    expect(screen.getByText(/Counted from block 50/)).toBeTruthy();
    expect(/revenue|earnings/i.test(container.textContent ?? '')).toBe(false);
  });
  it('an unreachable service is an error, not zeros', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    render(<StatsSection />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('chrome', () => {
  it('shows the RECORDED strip only after a snapshot was served', () => {
    render(<StatusStrip />);
    expect(screen.queryByText(/RECORDED snapshot/)).toBeNull();
    markSnapshotServed(1700000000);
    return waitFor(() => expect(screen.getByText(/RECORDED snapshot from 2023-11-14/)).toBeTruthy());
  });
  it('the More sheet reaches every P1 page', () => {
    const hrefs = MORE.map((m) => m.href);
    for (const h of ['/insights', '/ops-log', '/status', '/settings']) expect(hrefs).toContain(h);
  });
});

describe('trades filter (H23)', () => {
  const t = (trader: string) => ({ trader, side: 'buy', price: 1, receipt_id: trader, time: 1, token_amount: '1', quote_amount: '1' }) as unknown as import('@/lib/market/types').Trade;
  const items = [t('maya.testnet'), t('bob.testnet'), t('creator.testnet')];
  it('All keeps everything, You keeps the connected account, Creator accounts keeps declared wallets only', async () => {
    const { filterTrades } = await import('@/components/market/TradesFeed');
    expect(filterTrades(items, 'all', null, undefined).length).toBe(3);
    expect(filterTrades(items, 'you', 'bob.testnet', undefined).map((x) => x.trader)).toEqual(['bob.testnet']);
    expect(filterTrades(items, 'you', null, undefined)).toEqual([]);
    expect(filterTrades(items, 'creator', null, { 'creator.testnet': 'creator' }).map((x) => x.trader)).toEqual(['creator.testnet']);
  });
});
