// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeeTerms, TokenPageData, InstantInfo } from '@/lib/market/types';
import type { MarketFacts } from '@/lib/market/facts';
import type { InstantBundle, Section } from '@/lib/market/hooks';

const signAndSend = vi.fn(async (_i: unknown) => ({ txHash: 'HASHABCDEF123', raw: {} }));
const openChooser = vi.fn();
let wallet: { guard: { signingEnabled: boolean; lockReason?: string }; sessions: { near: { address: string } | null; solana: unknown }; adapters: unknown; openChooser: unknown };
vi.mock('@/components/wallet/index', () => ({ useWallet: () => wallet, WalletProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/market/chain', async (orig) => ({ ...(await orig<typeof import('@/lib/market/chain')>()), viewCall: vi.fn(async () => null) }));

const { ModeBadge, InstantNotice } = await import('./InstantNotice');
const { ContractFacts } = await import('./ContractFacts');
const { AllocationPanel } = await import('./AllocationPanel');
const { TradePanel } = await import('./TradePanel');
const { TradesFeed } = await import('./TradesFeed');
const { MechanicsPanel } = await import('./MechanicsPanel');
const { LaunchingState, LaunchFailedState } = await import('./StateCards');

const terms: FeeTerms = { total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000, opening_fee_start_bps: 500, opening_decay_minutes: 60, fee_vest_bps: 5000, fee_vest_days: 90 };
const NS = 1_000_000_000n; const OPEN = 1_000_000; const DAY = 86_400;
const info: InstantInfo = { n_alloc: '50000000000000', creator_alloc_bps: 500, cliff_days: 7, vest_days: 90, opened_at_ns: String(BigInt(OPEN) * NS), total_supply: '1000000000000000' };
const page = (): TokenPageData => ({
  launch: { launch_id: '1000000003', symbol: 'MYC', mode: 'instant', creator: 'alice.testnet', payout_recipient: 'pay.testnet', status: 'trading', stage: 'passed', source: 'chain' },
  pool: { open: true, paused: false, opened_at: OPEN, quote_reserve: '250000000', token_reserve: '950000000000000', price: 2.6e-7 },
  stats: {}, safety: [{ id: 'lp_in_pool', label: 'x', status: 'pass', basis: 'event' }], as_of: { block_height: 5, block_time: 5 }, source: 'chain' });
const facts: MarketFacts = { market: 'market.kruxa.testnet', token: 'myc.factory.testnet', terms, totalSupply: '1000000000000000', openedAtSec: OPEN, basis: 'api' };
const bundle = (over: Partial<InstantBundle> = {}): Section<InstantBundle> => ({ status: 'ready', data: { info, vesting: null, basis: 'chain', ...over } });
const setWallet = (near: { address: string } | null, signingEnabled = true) => {
  wallet = { guard: { signingEnabled, lockReason: signingEnabled ? undefined : 'locked reason' }, sessions: { near, solana: null }, adapters: { near: { signAndSendTransaction: signAndSend } }, openChooser };
};
afterEach(() => { cleanup(); signAndSend.mockClear(); openChooser.mockClear(); });

describe('mode badge and notice', () => {
  it('uses only the two labels', () => {
    render(<><ModeBadge mode="trial" /><ModeBadge mode="instant" /></>);
    expect(screen.getByText('Trial-verified')).toBeTruthy();
    expect(screen.getByText('Instant (no trial)')).toBeTruthy();
  });
  it('the notice says what is missing and links to the Risk page, with no dismiss control', () => {
    render(<InstantNotice />);
    expect(screen.getByText('Launched instantly: no trial, no refund, no verdict')).toBeTruthy();
    expect(screen.getByRole('link', { name: /risks/ }).getAttribute('href')).toBe('/legal/risk');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ContractFacts', () => {
  it('lists the facts with their basis and has no verdict or recompute control', () => {
    render(<ContractFacts page={page()} facts={facts} instant={bundle()} nowSec={OPEN + DAY} />);
    expect(screen.getByRole('heading', { name: 'Contract facts' })).toBeTruthy();
    expect(screen.getByText('7 day cliff, linear over 90 days')).toBeTruthy();
    expect(screen.getByText(/Seeded; the market has no LP withdrawal method/)).toBeTruthy();
    expect(screen.getByText('./scripts/verify.sh instant 1000000003')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Recompute/ })).toBeNull();
    expect(document.body.textContent!.toLowerCase()).not.toMatch(/\blocked\b|audited|\bsafe\b/);
  });
  it('says unknown when the record is missing', () => {
    render(<ContractFacts page={{ ...page(), safety: [] }} facts={{ ...facts, totalSupply: null, terms: null }} instant={bundle({ info: null })} nowSec={OPEN} />);
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(2);
  });
});

describe('AllocationPanel', () => {
  const vesting = { recipient: 'pay.testnet', total: '50000000000000', unlocked: '25000000000000', claimed: '5000000000000', claimable: '20000000000000', cliff_end_ns: String(BigInt(OPEN + 7 * DAY) * NS), vest_end_ns: String(BigInt(OPEN + 90 * DAY) * NS) };
  it('shows allocated, vested, claimed, claimable and the next unlock', () => {
    setWallet(null);
    render(<AllocationPanel page={page()} instant={bundle({ vesting })} nowSec={OPEN + 45 * DAY} onClaimed={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/50,000,000 tokens \(5% of supply\)/)).toBeTruthy();
    expect(screen.getByText('20,000,000')).toBeTruthy();
    expect(screen.getByText(/Unlocks continuously until/)).toBeTruthy();
    expect(screen.getByText(/Read from the launcher contract/)).toBeTruthy();
  });
  it('blocks the claim before the cliff', () => {
    setWallet({ address: 'pay.testnet' });
    render(<AllocationPanel page={page()} instant={bundle()} nowSec={OPEN + 2 * DAY} onClaimed={() => {}} onRetry={() => {}} />);
    expect(screen.getAllByText(/Cliff ends/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Claim vested/ })).toHaveProperty('disabled', true);
  });
  it('only the payout recipient can claim', () => {
    setWallet({ address: 'alice.testnet' });
    render(<AllocationPanel page={page()} instant={bundle({ vesting })} nowSec={OPEN + 45 * DAY} onClaimed={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/Only the payout recipient can claim/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claim vested/ })).toHaveProperty('disabled', true);
  });
  it('claims through the launcher for the recipient', async () => {
    setWallet({ address: 'pay.testnet' });
    render(<AllocationPanel page={page()} instant={bundle({ vesting })} nowSec={OPEN + 45 * DAY} onClaimed={() => {}} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Claim vested/ }));
    await waitFor(() => expect(signAndSend).toHaveBeenCalledOnce());
    const tx = signAndSend.mock.calls[0]![0] as { receiverId: string; actions: { params: { methodName: string; args: { launch_id: string } } }[] };
    expect(tx.receiverId).toBe('instant.kruxa.testnet');
    expect(tx.actions[0]!.params).toMatchObject({ methodName: 'claim_vested', args: { launch_id: '1000000003' } });
    expect(await screen.findByText('Claim submitted')).toBeTruthy();
  });
  it('is locked by the mainnet guard', () => {
    setWallet({ address: 'pay.testnet' }, false);
    render(<AllocationPanel page={page()} instant={bundle({ vesting })} nowSec={OPEN + 45 * DAY} onClaimed={() => {}} onRetry={() => {}} />);
    expect(screen.getByText('locked reason')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claim vested/ })).toHaveProperty('disabled', true);
  });
});

describe('TradePanel on an instant pool', () => {
  const renderTrade = (config: { max_instant_reserve_q?: string; instant_q?: string } | null = null) => render(
    <TradePanel page={page()} facts={facts} reserves={{ q: '250000000', t: '950000000000000' }} nowSec={OPEN + 1800} onSubmitted={() => {}} instant={{ declared: ['alice.testnet', 'pay.testnet'], config }} />);
  const type = (v: string) => fireEvent.change(screen.getByLabelText('You pay'), { target: { value: v } });
  it('refuses buys from the creator and the payout recipient with the reason, before signing', () => {
    for (const who of ['alice.testnet', 'pay.testnet']) {
      setWallet({ address: who });
      renderTrade(); type('5');
      expect(screen.getAllByText(/R_SELF_BUY/).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Buy MYC' })).toHaveProperty('disabled', true);
      cleanup();
    }
  });
  it('lets the creator sell and other wallets buy', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(); type('5');
    expect(screen.getByRole('button', { name: 'Buy MYC' })).toHaveProperty('disabled', false);
  });
  it('shows the opening-fee countdown', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade();
    expect(screen.getByRole('timer').textContent).toContain('3% now');
  });
  it('warns about the instant sub-cap and refuses a buy that would exceed it', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade({ max_instant_reserve_q: '5000000000', instant_q: '4990000000' }); type('50');
    expect(screen.getAllByText(/R_MARKET_CAP/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Buy MYC' })).toHaveProperty('disabled', true);
  });
  it('says the limit could not be read instead of inventing one', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(null);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });
});

describe('other instant pieces', () => {
  it('flags trades by declared wallets', () => {
    const t = { launch_id: '1', side: 'sell' as const, trader: 'alice.testnet', amount_in: '1', amount_out: '1', price: 1, quote_amount: '1000000', token_amount: '1', fee_total: '1', block_height: 1, receipt_id: 'r', time: 1, source: 'chain' as const };
    render(<TradesFeed trades={{ status: 'ready', data: { items: [t], next_cursor: null, as_of: { block_height: 1, block_time: 1 }, source: 'chain' } }} nowSec={5} onRetry={() => {}} declared={{ 'alice.testnet': 'creator' }} />);
    expect(screen.getByText('creator')).toBeTruthy();
  });
  it('the instant mechanics panel has no verdict or trial origin', () => {
    render(<MechanicsPanel launchId="1000000003" detail={{ status: 'loading' }} epochTrades={{ status: 'loading' }} openedAtSec={OPEN} onRetry={() => {}} instant />);
    expect(screen.getByRole('heading', { name: 'Fee epochs' })).toBeTruthy();
    expect(screen.queryByText(/Verdict|soft cap|Recompute/i)).toBeNull();
  });
  it('launching shows three steps and no trial words', () => {
    render(<LaunchingState steps={[{ id: 'created', label: 'Created', state: 'done' }, { id: 'seeded', label: 'Seeded', state: 'current' }, { id: 'trading', label: 'Trading', state: 'pending' }]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/trial|verdict|Walk/i);
  });
  it('a failed instant launch says nobody else put money in', () => {
    render(<LaunchFailedState status="abandoned" />);
    expect(screen.getByText(/did not complete/)).toBeTruthy();
    expect(screen.getByText(/instant launches have no backers/)).toBeTruthy();
  });
});
