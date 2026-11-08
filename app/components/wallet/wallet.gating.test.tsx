// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WalletProvider, type Adapters } from './WalletProvider';
import { WalletActionButton } from './WalletActionButton';
import { PayoutRecipientField, usePayoutRecipient } from './PayoutRecipientField';
import { WalletStatus } from './AccountBadge';
import { resolveNetworkGuard } from '@/lib/wallet/env';
import type { Chain, SessionListener, WalletAdapter, WalletOption, WalletSession } from '@/lib/wallet/types';

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(cleanup);

function mockAdapter(chain: Chain, options: WalletOption[], session: WalletSession | null = null) {
  let current = session;
  const listeners = new Set<SessionListener>();
  const adapter: WalletAdapter = {
    chain,
    listWallets: vi.fn(async () => options),
    connect: vi.fn(async (id: string) => {
      current = { chain, walletId: id, walletName: id, address: chain === 'near' ? 'maya.testnet' : 'SoLaddr', env: 'testnet' };
      listeners.forEach((l) => l(current));
      return current;
    }),
    disconnect: vi.fn(async () => { current = null; listeners.forEach((l) => l(null)); }),
    getSession: () => current,
    subscribe: (l) => { listeners.add(l); if (current) l(current); return () => { listeners.delete(l); }; },
    signAndSendTransaction: vi.fn(),
    signMessage: vi.fn(),
  };
  return adapter;
}
const NEAR_OPTS: WalletOption[] = [{ id: 'meteor-wallet', chain: 'near', name: 'Meteor', installed: true }];
const SOL_OPTS: WalletOption[] = [{ id: 'phantom', chain: 'solana', name: 'Phantom', installed: true }, { id: 'backpack', chain: 'solana', name: 'Backpack', installed: false, installUrl: 'https://backpack.app' }];
const solSession: WalletSession = { chain: 'solana', walletId: 'phantom', walletName: 'Phantom', address: 'SoLaddr', env: 'testnet', intentsAccountId: 'ab'.repeat(32) };
const nearSession: WalletSession = { chain: 'near', walletId: 'meteor-wallet', walletName: 'Meteor', address: 'maya.testnet', env: 'testnet' };

function setup(opts: { near?: WalletSession | null; solana?: WalletSession | null; env?: Record<string, string> } = {}) {
  const adapters: Adapters = { near: mockAdapter('near', NEAR_OPTS, opts.near ?? null), solana: mockAdapter('solana', SOL_OPTS, opts.solana ?? null) };
  const onReady = vi.fn();
  const guard = resolveNetworkGuard(opts.env ?? {});
  const ui = (action: 'create' | 'commit' | 'walk' | 'claim') => (
    <WalletProvider adapters={adapters} guard={guard}>
      <WalletStatus />
      <WalletActionButton action={action} onReady={onReady}>{action === 'create' ? 'Create trial' : 'Commit'}</WalletActionButton>
    </WalletProvider>
  );
  return { adapters, onReady, ui };
}

describe('wallet is requested only by an action', () => {
  it('rendering and browsing never list wallets, connect, or show a Connect button', () => {
    const { adapters, ui } = setup();
    render(ui('create'));
    expect(adapters.near.listWallets).not.toHaveBeenCalled();
    expect(adapters.solana.listWallets).not.toHaveBeenCalled();
    expect(adapters.near.connect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create trial' })).toBeTruthy();
  });

  it('pressing Commit with no wallet opens the chooser with both labelled groups', async () => {
    const { ui, onReady } = setup();
    render(ui('commit'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /NEAR wallets/ })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: /Solana wallets/ })).toBeTruthy();
    expect(await within(dialog).findByRole('button', { name: /Meteor/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Phantom/ })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /Backpack/ }).getAttribute('href')).toBe('https://backpack.app');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('connecting from the chooser closes it and shows the chain-badged account, without auto-signing', async () => {
    const { ui, onReady } = setup();
    render(ui('commit'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(await screen.findByRole('button', { name: /Meteor/ }));
    await waitFor(() => expect(screen.getByLabelText(/Disconnect NEAR account maya.testnet/)).toBeTruthy());
    expect(onReady).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false));
  });
});

describe('Create gating', () => {
  it('Solana-only session on Create states that a NEAR account is needed, and the chooser then offers no Solana wallet', async () => {
    const { ui, onReady } = setup({ solana: solSession });
    render(ui('create'));
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/Creating a launch needs a NEAR account/);
    fireEvent.click(screen.getByRole('button', { name: 'Create trial' }));
    const dialog = await screen.findByRole('dialog');
    expect(onReady).not.toHaveBeenCalled();
    const phantom = await within(dialog).findByRole('button', { name: /Phantom/ });
    expect((phantom as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/needs a NEAR account\. Solana wallets are not offered/)).toBeTruthy();
    expect((await within(dialog).findByRole('button', { name: /Meteor/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a NEAR session on Create is ready and calls onReady with the native path', () => {
    const { ui, onReady } = setup({ near: nearSession });
    render(ui('create'));
    fireEvent.click(screen.getByRole('button', { name: 'Create trial' }));
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', path: 'near-native' }));
  });
});

describe('Solana-only buyer routing', () => {
  it('Commit with Solana only is ready on the Intents path and explains it', () => {
    const { ui, onReady } = setup({ solana: solSession });
    render(ui('commit'));
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/Intents buyer path/);
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ path: 'solana-intents' }));
    expect(screen.getByText(/Intents account/)).toBeTruthy();
  });
});

describe('network guard', () => {
  it('locked mainnet disables the action and explains why; nothing opens', () => {
    const { ui, onReady } = setup({ near: nearSession, env: { NEXT_PUBLIC_KRUXA_ENV: 'mainnet' } });
    render(ui('commit'));
    const btn = screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/per-action confirmation token/)).toBeTruthy();
    expect(screen.getByText('Mainnet (read only)')).toBeTruthy();
    fireEvent.click(btn);
    expect(onReady).not.toHaveBeenCalled();
  });
  it('testnet shows the Testnet label', () => {
    const { ui } = setup();
    render(ui('commit'));
    expect(screen.getByText('Testnet')).toBeTruthy();
  });
});

describe('disconnect', () => {
  it('Disconnect clears the account', async () => {
    const { ui, adapters } = setup({ near: nearSession });
    render(ui('commit'));
    fireEvent.click(screen.getByLabelText(/Disconnect NEAR account/));
    await waitFor(() => expect(screen.queryByLabelText(/Disconnect NEAR account/)).toBeNull());
    expect(adapters.near.disconnect).toHaveBeenCalled();
  });
});

describe('chooser errors', () => {
  it('shows a retryable error when the NEAR wallet list fails', async () => {
    const { ui, adapters } = setup();
    (adapters.near.listWallets as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    render(ui('commit'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    const alert = await screen.findAllByRole('alert');
    expect(alert[0]?.textContent).toMatch(/Something went wrong/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Meteor/ })).toBeTruthy();
  });
});

describe('PayoutRecipientField', () => {
  function Harness({ signer }: { signer: string | null }) {
    const p = usePayoutRecipient(signer, 'testnet');
    return (
      <>
        <PayoutRecipientField state={p.state} onChange={p.setState} resolution={p.resolution} signer={signer} />
        <output data-testid="out">{p.resolution.ok ? p.resolution.accountId : 'invalid'}</output>
      </>
    );
  }
  const wrap = (signer: string | null) => render(<WalletProvider adapters={{ near: mockAdapter('near', []), solana: mockAdapter('solana', []) }} guard={resolveNetworkGuard({})}><Harness signer={signer} /></WalletProvider>);

  it('defaults to the connected account and states the fixed rule', () => {
    wrap('maya.testnet');
    expect(screen.getByTestId('out').textContent).toBe('maya.testnet');
    expect(screen.getByText(/Fixed once the trial opens/)).toBeTruthy();
    expect(screen.getByText(/no Solana payout address/)).toBeTruthy();
  });
  it('validates a separate account and flags a bad id after blur', () => {
    wrap('maya.testnet');
    fireEvent.click(screen.getByLabelText(/A separate NEAR account/));
    const input = screen.getByLabelText('NEAR account id');
    fireEvent.change(input, { target: { value: 'Bad Id' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/lowercase|Use lowercase/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('out').textContent).toBe('invalid');
    fireEvent.change(input, { target: { value: 'dao.testnet' } });
    expect(screen.getByTestId('out').textContent).toBe('dao.testnet');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('rejects a Solana address as the payout', () => {
    wrap('maya.testnet');
    fireEvent.click(screen.getByLabelText(/A separate NEAR account/));
    const input = screen.getByLabelText('NEAR account id');
    fireEvent.change(input, { target: { value: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/Solana address/);
  });
});
