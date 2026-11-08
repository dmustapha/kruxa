// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { LaunchSummary } from '@/lib/api/types';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => '/create', useParams: () => ({ id: '1000000007' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));
const L = vi.hoisted(() => ({
  askLauncher: vi.fn(), launcherConfig: vi.fn(), getInstantPhase: vi.fn(), getInstant: vi.fn(), getVesting: vi.fn(), instantsByCreator: vi.fn(),
}));
vi.mock('@/lib/instant/preview', async (orig) => ({ ...(await orig<typeof import('@/lib/instant/preview')>()), ...L }));
vi.mock('@/lib/near', async (orig) => ({ ...(await orig<typeof import('@/lib/near')>()), view: vi.fn(async () => { throw new Error('rpc down'); }), getCharter: vi.fn(async () => null), getState: vi.fn(async () => null), getPosition: vi.fn(async () => null) }));

import { Wallets, NEAR_SESSION } from '@/components/testing/mockWallet';
import { ModeSelector } from './ModeSelector';
import { InstantStudio } from './InstantStudio';
import { InstantProgress, stepsFor } from './InstantProgress';
import { VestPanel } from './VestPanel';
import { CreateRoot } from '../create/CreateRoot';
import { LaunchCard } from '../LaunchCard';
import { Discover } from '../discover/Discover';

beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
afterEach(() => { cleanup(); vi.clearAllMocks(); nav.params = new URLSearchParams(); localStorage.clear(); vi.restoreAllMocks(); });

const NOT_DEPLOYED = { kind: 'not_deployed' as const, message: 'Account instant.kruxa.testnet does not exist' };
function setup(over: Partial<Record<keyof typeof L, unknown>> = {}) {
  L.launcherConfig.mockResolvedValue(over.launcherConfig ?? NOT_DEPLOYED);
  L.askLauncher.mockResolvedValue(over.askLauncher ?? { kind: 'not_deployed', message: 'x' });
  L.instantsByCreator.mockResolvedValue([]); L.getInstantPhase.mockResolvedValue(null); L.getInstant.mockResolvedValue(null); L.getVesting.mockResolvedValue(null);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ items: [], next_cursor: null, total: 0, as_of: {}, source: 'chain' }), { status: 200 }));
}
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('mode selector', () => {
  it('Trial launch is the default and both cards state what they are', () => {
    const onChange = vi.fn();
    render(<ModeSelector mode="trial" onChange={onChange} />);
    expect((screen.getByRole('radio', { name: /Trial launch/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Backers can Walk until the deadline/)).toBeTruthy();
    expect(screen.getByText(/no trial, no verdict and no refund for buyers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Instant launch/ }));
    expect(onChange).toHaveBeenCalledWith('instant');
  });
  it('a disabled instant mode says why', () => {
    render(<ModeSelector mode="trial" onChange={vi.fn()} instantDisabledReason="Instant launch: not available yet." />);
    expect((screen.getByRole('radio', { name: /Instant launch/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Instant launch: not available yet.')).toBeTruthy();
  });
  it('CreateRoot shows the trial form by default and the instant form for ?mode=instant', () => {
    setup();
    nav.params = new URLSearchParams('mode=instant');
    render(<Wallets><CreateRoot /></Wallets>);
    expect(screen.getByText(/Higher risk: read this before you launch/)).toBeTruthy();
    expect(screen.queryByText('Raise scenarios')).toBeNull();
  });
});

describe('Instant studio', () => {
  it('shows the risk panel and keeps step 1 disabled until the acknowledgement is ticked', async () => {
    setup({ launcherConfig: { kind: 'ok', config: { creator_gate: false, paused: 'None' } }, askLauncher: { kind: 'ok', deposit: '131250000000000000000000', poolSeed: null, openPrice: null } });
    render(<Wallets near={NEAR_SESSION}><InstantStudio /></Wallets>);
    type(/Ticker/, 'ZED'); type('Name', 'Zed');
    const btn = () => screen.getByRole('button', { name: /Step 1 of 3: Create token/ }) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByText(/The launcher accepts these parameters/)).toBeTruthy());
    expect(btn().disabled).toBe(true);
    expect(screen.getByText('Tick the acknowledgement to continue.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /no trial and no refund, and my seed cannot be withdrawn/ }));
    await waitFor(() => expect(btn().disabled).toBe(false));
  });
  it('rule codes from the local mirror: reserved KRUXA and a seed out of range', () => {
    setup();
    render(<Wallets><InstantStudio /></Wallets>);
    type(/Ticker/, 'KRUXA'); type('Name', 'K'); type(/USDC seed/, '50');
    expect(screen.getAllByText('R_SYMBOL_RESERVED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R_SEED_RANGE').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/local mirror/).length).toBeGreaterThan(0);
  });
  it('an undeployed launcher is said plainly and nothing can be created', async () => {
    setup();
    render(<Wallets near={NEAR_SESSION}><InstantStudio /></Wallets>);
    type(/Ticker/, 'ZED'); type('Name', 'Zed');
    expect(await screen.findByText(/The instant launcher is not deployed on this network yet\./)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Step 1 of 3/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('one instant launch per account per 24 hours (R_RATE_LIMIT)', async () => {
    setup();
    const now = Math.floor(Date.now() / 1000);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ items: [{ launch_id: '1000000001', symbol: 'OLD', creator: 'maya.testnet', payout_recipient: 'maya.testnet', status: 'trading', stage: 'passed', mode: 'instant', created_at: now - 3600, total_active: '0', funders: 0, source: 'chain' }], next_cursor: null, total: 1, as_of: {}, source: 'chain' }), { status: 200 }));
    render(<Wallets near={NEAR_SESSION}><InstantStudio /></Wallets>);
    type(/Ticker/, 'ZED'); type('Name', 'Zed');
    expect((await screen.findAllByText('R_RATE_LIMIT')).length).toBeGreaterThan(0);
  });
  it('shows the preview card with the instant badge and the opening price', () => {
    setup();
    render(<Wallets><InstantStudio /></Wallets>);
    const card = screen.getByLabelText('Draft preview');
    expect(card.textContent).toContain('Instant (no trial)');
    expect(card.textContent).toContain('Opening price');
  });
});

describe('instant steps', () => {
  it('maps launcher statuses to the three steps', () => {
    expect(stepsFor('TokenReady', 'seed').map((s) => s.state)).toEqual(['done', 'next', 'wait']);
    expect(stepsFor('Seeded', 'open_instant').map((s) => s.state)).toEqual(['done', 'done', 'next']);
    expect(stepsFor('Open', 'none').map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(stepsFor('Aborted', 'none').map((s) => s.state)).toEqual(['dead', 'dead', 'dead']);
  });
  it('TokenReady shows the exact seed button for the creator; the launcher is the source of status', async () => {
    L.getInstantPhase.mockResolvedValue({ status: 'TokenReady', step: 'seed', next_action: 'seed', can_cancel: true });
    L.getInstant.mockResolvedValue({ launch_id: '1000000007', status: 'TokenReady', creator: 'maya.testnet', payout_recipient: 'maya.testnet', name: 'Zed', symbol: 'ZED', token: 'zed.factory', n_alloc: '0', n_pool: '0', creator_alloc_bps: 500, cliff_days: 7, vest_days: 90, seed_q: '250000000', launch_fee: '0', pool_seed_q: '250000000' });
    L.getVesting.mockResolvedValue(null);
    render(<Wallets near={NEAR_SESSION}><InstantProgress launchId="1000000007" /></Wallets>);
    expect(await screen.findByRole('button', { name: 'Step 2 of 3: Seed pool ($250 USDC)' })).toBeTruthy();
  });
  it('an ended launch offers the deposit reclaim to the creator only', async () => {
    L.getInstantPhase.mockResolvedValue({ status: 'Abandoned', step: 'dead', next_action: 'none' });
    L.getInstant.mockResolvedValue({ launch_id: '1', status: 'Abandoned', creator: 'maya.testnet', payout_recipient: 'maya.testnet', name: 'Z', symbol: 'Z', token: null, n_alloc: '0', n_pool: '0', creator_alloc_bps: 0, cliff_days: 7, vest_days: 30, seed_q: '1', launch_fee: '0', pool_seed_q: '1' });
    L.getVesting.mockResolvedValue(null);
    render(<Wallets near={NEAR_SESSION}><InstantProgress launchId="1" /></Wallets>);
    expect(await screen.findByText(/This launch ended: Abandoned/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reclaim the refundable part/ })).toBeTruthy();
  });
});

describe('vesting panel', () => {
  const vest = { recipient: 'maya.testnet', total: '50000000000000', unlocked: '7000000000000', claimed: '1000000000000', claimable: '6000000000000', cliff_end_ns: '1800000000000000000', vest_end_ns: '1807776000000000000' };
  it('shows cliff, unlocked, claimed and claimable, and the claim is enabled for the recipient', async () => {
    L.getVesting.mockResolvedValue(vest);
    render(<Wallets near={NEAR_SESSION}><VestPanel launchId="1000000007" symbol="ZED" /></Wallets>);
    expect(await screen.findByText('6,000,000 tokens')).toBeTruthy();
    expect(screen.getByText('50,000,000 tokens')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Claim vested tokens' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/locked in the pool and cannot be withdrawn/)).toBeTruthy();
  });
  it('a reader who is not the recipient cannot claim, and nothing claimable disables it', async () => {
    L.getVesting.mockResolvedValue({ ...vest, claimable: '0' });
    render(<Wallets><VestPanel launchId="1" /></Wallets>);
    expect((await screen.findByRole('button', { name: /Connect a NEAR wallet/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('an unreadable launcher says so instead of guessing', async () => {
    L.getVesting.mockRejectedValue(new Error('rpc down'));
    render(<Wallets><VestPanel launchId="1" /></Wallets>);
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});

const base: LaunchSummary = { launch_id: '9', symbol: 'ZED', creator: 'maya.testnet', payout_recipient: 'maya.testnet', status: 'open', stage: 'open', opens_at: 1, commit_end: 9999, walk_end: 99999, total_active: '5000000', funders: 1, soft_cap: '50000000', min_funders: 3, verdict: null, has_market: false, source: 'chain' };
describe('badges and cards', () => {
  it('a trial card carries Trial-verified and verdict meters', () => {
    render(<LaunchCard launch={base} now={100} />);
    expect(screen.getByText('Trial-verified')).toBeTruthy(); expect(screen.getAllByRole('meter').length).toBe(2);
  });
  it('an instant card carries Instant (no trial), price and volume, and no verdict meters', () => {
    render(<LaunchCard launch={{ ...base, launch_id: '1000000007', mode: 'instant', status: 'trading', stage: 'passed', has_market: true, last_price: 0.0000003, volume_24h: 12.5 }} now={100} />);
    expect(screen.getByText('Instant (no trial)')).toBeTruthy();
    expect(screen.queryByText('Trial-verified')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('12.50 USDC')).toBeTruthy();
    expect(screen.getByRole('link', { name: /instant launch, no trial/ }).getAttribute('href')).toBe('/token/1000000007');
  });
  it('a launching instant card links to the launch steps, not the trade view', () => {
    render(<LaunchCard launch={{ ...base, launch_id: '1000000008', mode: 'instant', status: 'launching', has_market: false }} now={100} />);
    expect(screen.getByText('Launching')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Launching/ }).getAttribute('href')).toBe('/launch/1000000008');
  });
});

describe('feed Launch type filter', () => {
  const page = (items: LaunchSummary[]) => new Response(JSON.stringify({ items, next_cursor: null, total: items.length, as_of: { block_height: 1, block_time: 100 }, source: 'chain' }), { status: 200 });
  it('has All, Trial-verified and Instant, writes ?mode= and filters client-side as a fallback', async () => {
    nav.params = new URLSearchParams('mode=instant&tab=all');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([{ ...base, launch_id: '1', symbol: 'TRL' }, { ...base, launch_id: '1000000001', symbol: 'INS', mode: 'instant', status: 'trading', has_market: true }]));
    render(<Wallets><Discover /></Wallets>);
    const group = screen.getByRole('group', { name: 'Launch type' });
    expect(group.textContent).toContain('Trial-verified'); expect(group.textContent).toContain('Instant');
    expect(await screen.findByRole('link', { name: /INS, instant launch/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /TRL/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(nav.replace).toHaveBeenCalledWith('/create?tab=all', { scroll: false });
  });
});
