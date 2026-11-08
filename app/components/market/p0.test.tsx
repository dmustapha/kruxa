// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Sigil, sigilCells } from './Sigil';
import { StatsRail } from './StatsRail';
import { Tabs } from './Tabs';
import { SafetyTiles } from './SafetyTiles';
import { GenesisStepper } from './GenesisStepper';
import { FailedState, HaltedBanner, TrialState } from './StateCards';
import { VerifyPanel } from './VerifyPanel';
import { StickyTradeBar } from './OrderSheet';
import { windowRows } from '@/lib/market/windows';
import { safetyTiles } from '@/lib/market/tiles';
import { allocate, inputsHash, type VerdictInputs } from '@/lib/verdict';
import type { ChainReaders } from '@/lib/market/verify';
import type { LaunchDetail, TokenPageData, Trade } from '@/lib/market/types';

vi.mock('@/lib/market/api', async (orig) => ({ ...(await orig<typeof import('@/lib/market/api')>()), fetchVerify: vi.fn(async () => ({ book_hash_folded: 'bh' })) }));
afterEach(cleanup);

const tr = (time: number, price: number, side: 'buy' | 'sell'): Trade => ({ launch_id: '1', side, trader: 'x', amount_in: '1', amount_out: '1', price, quote_amount: '2000000', fee_total: '1', block_height: 1, receipt_id: `r${time}`, time, source: 'chain' });

describe('Sigil', () => {
  it('is deterministic, mirrored and decorative', () => {
    expect(sigilCells('1:A')).toEqual(sigilCells('1:A'));
    expect(sigilCells('1:A')).not.toEqual(sigilCells('2:B'));
    for (const row of sigilCells('9:Z')) expect(row[0]).toBe(row[4]);
    const { container } = render(<Sigil id="1" symbol="A" />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('StatsRail', () => {
  const rows = windowRows(undefined, [tr(1000, 2, 'buy'), tr(900, 1, 'sell')], 1000, true);
  it('switches windows with the keyboard and shows buys vs sells', () => {
    render(<StatsRail rows={rows} partial={false} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => /^\d+[MHD]|^\d+H/.exec(t.textContent!)![0])).toEqual(['5M', '1H', '6H', '24H']);
    expect(tabs[3]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[3]!, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText(/Transactions: buys 1, sells 1/)).toBeTruthy();
  });
  it('says unknown when a window cannot be computed', () => {
    render(<StatsRail rows={windowRows(undefined, [tr(100000, 2, 'buy')], 100000, false)} partial />);
    expect(screen.getAllByText(/Unknown for/).length).toBe(1);
  });
});

describe('Tabs', () => {
  function Harness() {
    const [a, setA] = useState('one');
    return <Tabs label="t" active={a} onChange={setA} tabs={[{ id: 'one', label: 'One', body: <p>body one</p> }, { id: 'two', label: 'Two', body: <p>body two</p> }]} />;
  }
  it('follows the tab pattern with arrows', () => {
    render(<Harness />);
    expect(screen.getByText('body one')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'ArrowRight' });
    expect(screen.getByText('body two')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('tabindex')).toBe('-1');
  });
});

const page = (): TokenPageData => ({ launch: { launch_id: '1', symbol: 'A', creator: 'c', payout_recipient: 'c', status: 'passed', stage: 'passed', verdict: 'PASS', source: 'chain' }, pool: { open: true, paused: false }, stats: {}, safety: [{ id: 'mint_authority_null', label: 'm', status: 'pass', basis: 'event' }], as_of: { block_height: 1, block_time: 1 }, source: 'chain' });

describe('SafetyTiles', () => {
  it('prints the status as a word and an unknown for missing facts', () => {
    const open = vi.fn();
    render(<SafetyTiles tiles={safetyTiles(page(), undefined, undefined, undefined)} onOpenVerify={open} />);
    expect(screen.getAllByText(/Unknown/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pass/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Recompute in your browser/ }));
    expect(open).toHaveBeenCalled();
    expect(document.body.textContent!.toLowerCase()).not.toMatch(/\bsafe\b|locked|audited/);
  });
});

describe('GenesisStepper and state cards', () => {
  it('marks the current step', () => {
    render(<GenesisStepper steps={[{ id: 'a', label: 'A', state: 'done' }, { id: 'b', label: 'B', state: 'current' }, { id: 'c', label: 'C', state: 'unknown', note: 'Not reported' }]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[2]!.textContent).toContain('Unknown');
  });
  const detail = { status: 'ready' as const, data: { ...page().launch, charter_hash: 'h', commit_end: 1800000000, walk_end: 1800100000, verdict_inputs: { total_active: '30000000', funders: 2, soft_cap: '50000000', min_funders: 3, book_hash_folded: 'x' } } as LaunchDetail };
  it('trial state states the margin and has no trade controls', () => {
    render(<TrialState page={page()} detail={detail} />);
    expect(screen.getByText(/cannot be traded yet/)).toBeTruthy();
    expect(screen.getByText(/Needs \$20 and 1 more backer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Buy/ })).toBeNull();
  });
  it('failed state sends the reader to refunds and says no Solana mint exists', () => {
    render(<FailedState page={page()} />);
    expect(screen.getByText(/No Solana mint was created/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /refunds/ }).getAttribute('href')).toBe('/launch/1');
  });
  it('halted banner keeps sells open', () => {
    render(<HaltedBanner />);
    expect(screen.getByText(/never pauses them/)).toBeTruthy();
  });
});

describe('StickyTradeBar', () => {
  it('disables Buy with a reason while Sell stays available', () => {
    const open = vi.fn();
    render(<StickyTradeBar onOpen={open} buyDisabledReason="Buys paused by the operator (sells and claims stay open)" sellDisabled={false} />);
    expect(screen.getByRole('button', { name: 'Buy' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(open).toHaveBeenCalledWith('sell');
    expect(screen.getByText(/stay open/)).toBeTruthy();
  });
});

describe('VerifyPanel', () => {
  const inputs: VerdictInputs = { launch_id: '1', charter_hash: Array(32).fill(3), total_active: '87000000', active_funders: 4, soft_cap: '50000000', min_funders: 3, cancelled: false };
  const a = allocate(87_000_000n, 1_000_000_000n, 6000n, 2500n);
  const readers: ChainReaders = {
    getVerdictInputs: async () => ({ inputs: inputs as unknown as Record<string, unknown>, inputs_hash: inputsHash(inputs) }),
    getState: async () => ({ book_hash: 'bh' }),
    getSettlement: async () => ({ pass: true, reasons: 0, total_active: '87000000', accepted: String(a.accepted), launch_fee: String(a.launchFee), lp_quote: String(a.lpQuote), stream: String(a.stream), excess_pool: String(a.excessPool), inputs_hash: inputsHash(inputs) }),
    getCharter: async () => ({ params: { sale_bps: 6000, lp_bps: 2500, hard_cap: '1000000000' } }),
  };
  it('recomputes to MATCH, then the tamper toggle turns it into MISMATCH', async () => {
    render(<VerifyPanel launchId="1" readers={readers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recompute in your browser' }));
    await waitFor(() => expect(screen.getByText('MATCH', { selector: 'p' })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/MISMATCH \(expected: tamper is on\)/)).toBeTruthy();
    expect(screen.getByText('./scripts/verify.sh 1')).toBeTruthy();
  });
  it('shows UNAVAILABLE, not MISMATCH, when the contract cannot be read', async () => {
    render(<VerifyPanel launchId="1" readers={{ ...readers, getVerdictInputs: async () => { throw new Error('rpc down'); } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recompute in your browser' }));
    await waitFor(() => expect(screen.getByText('UNAVAILABLE')).toBeTruthy());
    expect(document.querySelector('.mkt-overall')).toBeNull();
    expect(screen.getByText(/This is not a mismatch/)).toBeTruthy();
  });
});
