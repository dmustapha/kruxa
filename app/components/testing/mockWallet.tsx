// Test-only helpers: a wallet provider with injected mock adapters. No real wallet, no network.
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { WalletProvider, type Adapters } from '@/components/wallet';
import { resolveNetworkGuard } from '@/lib/wallet/env';
import type { Chain, SessionListener, WalletAdapter, WalletSession } from '@/lib/wallet/types';

export function mockAdapter(chain: Chain, session: WalletSession | null = null): WalletAdapter & { signAndSendTransaction: ReturnType<typeof vi.fn>; signMessage: ReturnType<typeof vi.fn> } {
  const listeners = new Set<SessionListener>();
  return {
    chain,
    listWallets: vi.fn(async () => []),
    connect: vi.fn(async () => { throw new Error('mock wallet: connect is not available in tests'); }),
    disconnect: vi.fn(async () => undefined),
    getSession: () => session,
    subscribe: (l: SessionListener) => { listeners.add(l); if (session) l(session); return () => { listeners.delete(l); }; },
    signAndSendTransaction: vi.fn(async () => ({ txHash: 'MOCKTXHASH', raw: {} })),
    signMessage: vi.fn(async () => ({ chain: 'solana', address: 'x', signature: new Uint8Array(64).fill(1), signedMessage: new Uint8Array() })),
  } as never;
}

export const NEAR_SESSION: WalletSession = { chain: 'near', walletId: 'mock', walletName: 'Mock', address: 'maya.testnet', env: 'testnet' };

/** The adapters of the most recently rendered <Wallets>, so a test can inspect what was signed. */
export const lastAdapters: { current: Adapters | null } = { current: null };

export function Wallets({ children, near = null, solana = null }: { children: ReactNode; near?: WalletSession | null; solana?: WalletSession | null }) {
  const adapters: Adapters = { near: mockAdapter('near', near), solana: mockAdapter('solana', solana) };
  lastAdapters.current = adapters;
  return <WalletProvider adapters={adapters} guard={resolveNetworkGuard({})}>{children}</WalletProvider>;
}
