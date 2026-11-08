'use client';
// Holds the two adapters and the chain-labelled sessions. It connects nothing on mount except a silent restore of a
// session the user already made in this browser (and only if a hint says one exists), so reading pages stays wallet-free.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './wallet.css';
import { resolveNetworkGuard, type NetworkGuard } from '@/lib/wallet/env';
import { NearConnectAdapter } from '@/lib/wallet/near';
import { SolanaWalletStandardAdapter } from '@/lib/wallet/solana';
import type { SessionSet } from '@/lib/wallet/gating';
import type { Chain, WalletAction, WalletAdapter } from '@/lib/wallet/types';
import { ConnectChooser } from './ConnectChooser';

export interface Adapters { near: WalletAdapter; solana: WalletAdapter }
export interface ChooserRequest { action: WalletAction; chains: Chain[] }

export interface WalletContextValue {
  guard: NetworkGuard;
  sessions: SessionSet;
  adapters: Adapters;
  openChooser(request: ChooserRequest): void;
  disconnect(chain: Chain): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const NEAR_HINT = 'kruxa.near.hint';

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

function hint(op: 'get' | 'set' | 'clear'): boolean {
  try {
    if (op === 'set') localStorage.setItem(NEAR_HINT, '1');
    else if (op === 'clear') localStorage.removeItem(NEAR_HINT);
    else return localStorage.getItem(NEAR_HINT) === '1';
  } catch { /* storage may be blocked */ }
  return false;
}

interface Props { children: ReactNode; adapters?: Adapters; guard?: NetworkGuard }

export function WalletProvider({ children, adapters: injected, guard: injectedGuard }: Props) {
  const guard = useMemo(() => injectedGuard ?? resolveNetworkGuard(), [injectedGuard]);
  const adapters = useMemo<Adapters>(
    () => injected ?? { near: new NearConnectAdapter({ guard }), solana: new SolanaWalletStandardAdapter({ guard }) },
    [injected, guard],
  );
  const [sessions, setSessions] = useState<SessionSet>({ near: null, solana: null });
  const [request, setRequest] = useState<ChooserRequest | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    const offNear = adapters.near.subscribe((s) => { setSessions((p) => ({ ...p, near: s })); if (s) hint('set'); });
    const offSol = adapters.solana.subscribe((s) => setSessions((p) => ({ ...p, solana: s })));
    if (!restored.current) {
      restored.current = true;
      const restorable = (a: WalletAdapter) => (a as { restore?: () => Promise<unknown> }).restore;
      if (hint('get')) void restorable(adapters.near)?.call(adapters.near);
      void restorable(adapters.solana)?.call(adapters.solana);
    }
    return () => { offNear(); offSol(); };
  }, [adapters]);

  const openChooser = useCallback((r: ChooserRequest) => setRequest(r), []);
  const disconnect = useCallback(async (chain: Chain) => {
    if (chain === 'near') hint('clear');
    await adapters[chain].disconnect();
  }, [adapters]);

  const value = useMemo<WalletContextValue>(() => ({ guard, sessions, adapters, openChooser, disconnect }), [guard, sessions, adapters, openChooser, disconnect]);

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectChooser request={request} onClose={() => setRequest(null)} />
    </WalletContext.Provider>
  );
}
