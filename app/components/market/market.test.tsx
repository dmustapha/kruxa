// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FeeTerms, TokenPageData } from '@/lib/market/types';
import type { MarketFacts } from '@/lib/market/facts';

const signAndSend = vi.fn(async (_i: unknown) => ({ txHash: 'HASH123456789', raw: {} }));
const openChooser = vi.fn();
let wallet: { guard: { signingEnabled: boolean; lockReason?: string }; sessions: { near: { address: string } | null; solana: unknown }; adapters: unknown; openChooser: unknown };
vi.mock('@/components/wallet/index', () => ({ useWallet: () => wallet, WalletProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/market/chain', async (orig) => ({ ...(await orig<typeof import('@/lib/market/chain')>()), viewCall: vi.fn(async () => null) }));

const { TradePanel } = await import('./TradePanel');
const { SafetyPanel, mergeIndicators } = await import('./SafetyPanel');
const { FeePanel } = await import('./FeePanel');
const { WhereToTrade } = await import('./WhereToTrade');
const { CreatorPanel, claimableOf } = await import('./CreatorPanel');
const { SourceBadge } = await import('./shared');

const terms: FeeTerms = { total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000, opening_fee_start_bps: 500, opening_decay_minutes: 60, fee_vest_bps: 5000, fee_vest_days: 90 };
const page = (over: Partial<TokenPageData> = {}): TokenPageData => ({
  launch: { launch_id: '1', symbol: 'ALPHA', creator: 'alice.testnet', payout_recipient: 'alice.testnet', status: 'passed', stage: 'passed', source: 'chain' },
  pool: { open: true, paused: false, opened_at: 1000, quote_reserve: '26571793', token_reserve: '794353574700', price: 3e-5 },
  stats: {}, safety: [], as_of: { block_height: 5, block_time: 5 }, source: 'chain', ...over,
});
const facts = (over: Partial<MarketFacts> = {}): MarketFacts => ({ market: 'market.kruxa.testnet', token: 'tok.testnet', terms, totalSupply: null, openedAtSec: 1000, basis: 'chain', ...over });
const setWallet = (near: { address: string } | null, signingEnabled = true) => {
  wallet = { guard: { signingEnabled, lockReason: signingEnabled ? undefined : 'Mainnet signing needs the per-action confirmation token.' }, sessions: { near, solana: null }, adapters: { near: { signAndSendTransaction: signAndSend } }, openChooser };
};
afterEach(() => { cleanup(); signAndSend.mockClear(); openChooser.mockClear(); });

const renderTrade = (f = facts(), p = page()) => render(<TradePanel page={p} facts={f} reserves={{ q: p.pool.quote_reserve, t: p.pool.token_reserve }} nowSec={1000 + 7200} onSubmitted={() => {}} />);
const type = (v: string) => fireEvent.change(screen.getByLabelText('You pay'), { target: { value: v } });

describe('TradePanel', () => {
  it('shows an exact preview with min_out and fee', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(); type('5');
    expect(screen.getByLabelText('Quote preview').textContent).toContain('Minimum accepted (min_out)');
    expect(screen.getByLabelText('Quote preview').textContent).toContain('$0.05');
  });
  it('signs an ft_transfer_call through the adapter with the mandatory min_out', async () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(); type('5');
    fireEvent.click(screen.getByRole('button', { name: 'Buy ALPHA' }));
    await waitFor(() => expect(signAndSend).toHaveBeenCalledOnce());
    const tx = signAndSend.mock.calls[0]![0] as { receiverId: string; actions: { params: { methodName: string; args: { msg: string } } }[] };
    expect(tx.receiverId).toBe('usdc.kruxa.testnet');
    expect(tx.actions[0]!.params.methodName).toBe('ft_transfer_call');
    expect(BigInt(JSON.parse(tx.actions[0]!.params.args.msg).min_out) > 0n).toBe(true);
    expect(await screen.findByText(/Submitted/)).toBeTruthy();
  });
  it('opens the NEAR chooser instead of signing when no wallet is connected', () => {
    setWallet(null);
    renderTrade(); type('5');
    fireEvent.click(screen.getByRole('button', { name: /Connect wallet to trade/ }));
    expect(openChooser).toHaveBeenCalledWith({ action: 'trade', chains: ['near'] });
    expect(signAndSend).not.toHaveBeenCalled();
  });
  it('is locked by the mainnet guard and never signs', () => {
    setWallet({ address: 'bob.testnet' }, false);
    renderTrade(); type('5');
    expect(screen.getByText(/per-action confirmation token/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy ALPHA' })).toHaveProperty('disabled', true);
  });
  it('does not guess a quote when the fee terms are unknown', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(facts({ terms: null })); type('5');
    expect(screen.getByText('No quote')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy ALPHA' })).toHaveProperty('disabled', true);
  });
  it('explains a paused market and rejects an invalid slippage', () => {
    setWallet({ address: 'bob.testnet' });
    renderTrade(facts(), page({ pool: { ...page().pool, paused: true } })); type('5');
    expect(screen.getByText(/Buys are paused/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Max slippage'), { target: { value: '99' } });
    expect(screen.getByText(/0.1 to 50 percent/)).toBeTruthy();
  });
  it('surfaces a wallet rejection as not sent', async () => {
    setWallet({ address: 'bob.testnet' });
    signAndSend.mockRejectedValueOnce(new Error('denied'));
    renderTrade(); type('5');
    fireEvent.click(screen.getByRole('button', { name: 'Buy ALPHA' }));
    expect(await screen.findByText('Not sent')).toBeTruthy();
  });
});

describe('SafetyPanel', () => {
  it('shows unknown, never a pass, for facts the indexer did not log', () => {
    const rows = mergeIndicators([{ id: 'verdict_passed', label: 'x', status: 'pass', basis: 'event' }, { id: 'lp_in_pool', label: 'y', status: 'pass', basis: 'not_indexed' }]);
    expect(rows.find((r) => r.id === 'lp_in_pool')!.status).toBe('unknown');
    expect(rows.find((r) => r.id === 'mint_authority_null')!.status).toBe('unknown');
    expect(rows).toHaveLength(8);
  });
  it('renders text for every status, not colour alone', () => {
    render(<SafetyPanel page={page()} />);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });
});

describe('FeePanel', () => {
  it('lists five slices and says holders and referral go to LP', () => {
    render(<FeePanel page={page()} facts={facts()} nowSec={1000 + 1800} />);
    expect(screen.getByLabelText(/Five fee slices/).querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByText(/redirected to the liquidity slice/)).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toContain('3% now');
  });
  it('says unknown without terms', () => {
    render(<FeePanel page={page()} facts={facts({ terms: null })} nowSec={0} />);
    expect(screen.getByText('Fee terms unknown')).toBeTruthy();
  });
});

describe('WhereToTrade', () => {
  it('shows no Meteora link unless the API reports a pool', () => {
    render(<WhereToTrade page={page()} facts={facts()} />);
    expect(screen.queryByRole('link', { name: /Meteora/ })).toBeNull();
    cleanup();
    render(<WhereToTrade page={page({ external_pools: [{ venue: 'meteora', pool: 'P'.repeat(44), url: 'https://app.meteora.ag/dammv2/x' }] })} facts={facts()} />);
    expect(screen.getByRole('link', { name: /Meteora/ }).getAttribute('href')).toBe('https://app.meteora.ag/dammv2/x');
  });
  it('refuses non-https links', () => {
    render(<WhereToTrade page={page({ external_pools: [{ venue: 'meteora', pool: 'abc', url: 'javascript:alert(1)' }] })} facts={facts()} />);
    expect(screen.queryByRole('link', { name: /Meteora/ })).toBeNull();
  });
});

describe('CreatorPanel', () => {
  const ready = (b: object) => ({ status: 'ready' as const, data: { status: null, earnings: null, stream: null, claims: [], basis: 'none' as const, ...b } });
  it('only lets the payout recipient claim', () => {
    setWallet({ address: 'mallory.testnet' });
    render(<CreatorPanel page={page()} facts={facts()} earnings={ready({ earnings: { claimable_estimate: '5000000', market_fees_creator_slice: '5000000', claimed: '0' }, basis: 'indexer' })} onClaimed={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/Only the payout recipient can claim/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claim/ })).toHaveProperty('disabled', true);
  });
  it('claims market.claim for the recipient', async () => {
    setWallet({ address: 'alice.testnet' });
    render(<CreatorPanel page={page()} facts={facts()} earnings={ready({ earnings: { claimable_estimate: '5000000' }, basis: 'indexer' })} onClaimed={() => {}} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim to payout recipient' }));
    await waitFor(() => expect(signAndSend).toHaveBeenCalledOnce());
    expect((signAndSend.mock.calls[0]![0] as { actions: { params: { methodName: string } }[] }).actions[0]!.params.methodName).toBe('claim');
  });
  it('claimableOf prefers the chain view', () => {
    expect(claimableOf({ status: { recipient: 'a', accrued: '1', unlocked: '1', paid: '0', claimable: '7' }, earnings: { claimable_estimate: '9' }, stream: null, claims: [], basis: 'chain' })).toBe(7n);
    expect(claimableOf({ status: null, earnings: null, stream: null, claims: [], basis: 'none' })).toBeNull();
  });
});

describe('fixture data', () => {
  it('turns the order panel off with a reason', () => {
    setWallet({ address: 'bob.testnet' });
    const p = page(); p.source = 'fixture';
    renderTrade(facts(), p); type('5');
    expect(screen.getByText(/Fixture data: nothing here is on a chain/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy ALPHA' })).toHaveProperty('disabled', true);
  });
});

describe('SourceBadge', () => {
  it('always prints the source', () => {
    render(<SourceBadge source="fixture" />);
    expect(screen.getByText('source: fixture')).toBeTruthy();
  });
});
