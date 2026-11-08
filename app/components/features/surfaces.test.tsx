// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { LaunchSummary } from '@/lib/api/types';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn(), path: '/' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.params, useRouter: () => ({ replace: nav.replace, push: nav.push }), usePathname: () => nav.path, useParams: () => ({ id: '1' }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/near', async (orig) => ({ ...(await orig<typeof import('@/lib/near')>()), view: vi.fn(async () => { throw new Error('fetch failed'); }), getState: vi.fn(async () => { throw new Error('rpc down'); }), getCharter: vi.fn(async () => { throw new Error('rpc down'); }), getPosition: vi.fn(async () => null) }));

import { Wallets, NEAR_SESSION } from '@/components/testing/mockWallet';
import { LaunchCard } from './LaunchCard';
import { GenesisStepper } from './GenesisStepper';
import { Discover } from './discover/Discover';
import { CreateStudio } from './create/CreateStudio';
import { BottomTabs, hasOwnActionBar } from '@/components/layouts/BottomTabs';
import { VerdictMeters } from '@/components/ui/VerdictMeters';
import { LaunchSigil } from '@/components/ui/LaunchSigil';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); nav.params = new URLSearchParams(); nav.replace.mockClear(); localStorage.clear(); });

const launch = (over: Partial<LaunchSummary> = {}): LaunchSummary => ({
  launch_id: '3', symbol: 'CHARLIE', creator: 'carol.testnet', payout_recipient: 'carol.testnet', status: 'open', stage: 'open', opens_at: 100, commit_end: 5000, walk_end: 9000,
  total_active: '437000000', funders: 11, soft_cap: '350000000', min_funders: 10, progress_bps: 12485, verdict: null, has_market: false, source: 'fixture', ...over,
});

describe('LaunchCard v2', () => {
  it('shows phase, margin sentence, fixture badge and one stretched link with a full accessible name', () => {
    render(<LaunchCard launch={launch()} now={200} frozenClock />);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Passing by $87 and 1 backer.')).toBeTruthy();
    expect(screen.getByText('Fixture data')).toBeTruthy();
    const link = screen.getByRole('link', { name: /CHARLIE, trial-verified, launch 3, Open, Passing by \$87 and 1 backer\./ });
    expect(link.getAttribute('href')).toBe('/launch/3');
    expect(screen.getByRole('link', { name: 'Verify' }).getAttribute('href')).toBe('/launch/3/verify');
  });
  it('a trading launch links to the trade view and shows price fields, not the trial meters', () => {
    render(<LaunchCard launch={launch({ status: 'passed', stage: 'passed', verdict: 'PASS', has_market: true, last_price: 0.0000341, volume_24h: 136.6 })} now={999999} />);
    expect(screen.getByRole('link', { name: /Trading/ }).getAttribute('href')).toBe('/token/3');
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('136.60 USDC')).toBeTruthy();
  });
  it('meters expose role=meter with values, and a missing term says so instead of drawing zero', () => {
    render(<VerdictMeters l={{ total_active: '1', soft_cap: null, funders: 1, min_funders: null, verdict: null }} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Soft cap not indexed.')).toBeTruthy();
  });
  it('the sigil is deterministic', () => {
    const a = render(<LaunchSigil id="1" symbol="A" />).container.innerHTML; cleanup();
    const b = render(<LaunchSigil id="1" symbol="A" />).container.innerHTML; cleanup();
    const c = render(<LaunchSigil id="2" symbol="A" />).container.innerHTML;
    expect(a).toBe(b); expect(a).not.toBe(c);
  });
});

describe('GenesisStepper', () => {
  it('without indexer genesis data every step after the verdict is Unknown, never Done', () => {
    render(<GenesisStepper verdict="PASS" />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Done')).toBeTruthy();
    for (const li of items.slice(1)) expect(within(li).getByText('Unknown')).toBeTruthy();
  });
  it('on FAIL it says no Solana mint exists', () => {
    render(<GenesisStepper verdict="FAIL" />);
    expect(screen.getByText(/No Solana mint was created/)).toBeTruthy();
  });
});

describe('Discover', () => {
  const page = (items: LaunchSummary[], total = items.length) => new Response(JSON.stringify({ items, next_cursor: null, total, as_of: { block_height: 5, block_time: 200 }, source: 'fixture' }), { status: 200 });
  it('renders tabs with counts, the placeholder headline, and fixture cards', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([launch()], 1));
    render(<Wallets><Discover /></Wallets>);
    expect(screen.getByText(/Placeholder headline/)).toBeTruthy();
    expect(await screen.findByText('Passing by $87 and 1 backer.')).toBeTruthy();
    expect(screen.getByText(/Fixture data\./)).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.replace(/[0-9-]+$/, ''))).toEqual(['Live trials', 'Walk window', 'Launching', 'Trading', 'Passed, market pending', 'Failed and refunded', 'All']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });
  it('empty state per tab', async () => {
    nav.params = new URLSearchParams('tab=failed');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([], 0));
    render(<Wallets><Discover /></Wallets>);
    expect(await screen.findByText('No launch has failed yet.')).toBeTruthy();
  });
  it('error state says the service did not answer and offers retry, with no zeros', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    render(<Wallets><Discover /></Wallets>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/indexer could not be reached/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it('arrow keys move between tabs through the URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([], 0));
    render(<Wallets><Discover /></Wallets>);
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'ArrowRight' });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/?tab=walk', { scroll: false }));
  });
  it('each tab asks the indexer for its own API tab, including Launching for instant launches', async () => {
    nav.params = new URLSearchParams('tab=pending');
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([], 0));
    render(<Wallets><Discover /></Wallets>);
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('tab=passed') && String(u).includes('limit=24'))).toBe(true));
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/[0-9-]+$/, ''))).toContain('Launching');
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('tab=launching') && String(u).includes('limit=1'))).toBe(true));
  });
});

describe('BottomTabs', () => {
  it('steps aside on trial and token pages', () => {
    expect(hasOwnActionBar('/launch/3')).toBe(true); expect(hasOwnActionBar('/token/3')).toBe(true);
    expect(hasOwnActionBar('/launch/3/verify')).toBe(false); expect(hasOwnActionBar('/')).toBe(false);
    nav.path = '/launch/3';
    expect(render(<BottomTabs />).container.innerHTML).toBe('');
    cleanup(); nav.path = '/';
    render(<BottomTabs />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Discover', 'Create', 'Portfolio']);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByRole('dialog', { name: 'More' })).toBeTruthy();
  });
});

describe('Create v2', () => {
  it('the hostile preset is refused with rule codes, shows the preview card, and the Create button is disabled', async () => {
    nav.params = new URLSearchParams('preset=hostile');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ items: [], next_cursor: null, as_of: {}, source: 'chain' }), { status: 200 }));
    render(<Wallets near={NEAR_SESSION}><CreateStudio /></Wallets>);
    expect(screen.getByLabelText('Draft preview')).toBeTruthy();
    expect(screen.getAllByText('R_ALLOC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R_WINDOW').length).toBeGreaterThan(0);
    expect(screen.getByText('2 refused')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Create trial/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nothing is signed/)).toBeTruthy();
  });
  it('a legal preset shows summaries and the raise scenario table, with no wallet', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
    render(<Wallets><CreateStudio /></Wallets>);
    fireEvent.change(screen.getByLabelText(/Ticker/), { target: { value: 'ZED' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Zed' } });
    expect(screen.getByText('All rules pass')).toBeTruthy();
    expect(screen.getAllByText(/Otherwise every backer gets a refund/).length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Raise scenarios' })).toBeTruthy();
    expect(screen.getByText(/1.00% of volume/)).toBeTruthy();
  });
});
