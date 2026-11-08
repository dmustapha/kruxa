'use client';
// The token page needs a wallet context for its action buttons. If the app layout already mounts <WalletProvider>, reuse it;
// otherwise mount one here so the page works on its own. useWallet throws without a provider, which is the detection.
import type { ReactNode } from 'react';
import { WalletProvider, useWallet } from '@/components/wallet/index';

function useHasWallet(): boolean {
  try { useWallet(); return true; } catch { return false; }
}

export function EnsureWallet({ children }: { children: ReactNode }) {
  return useHasWallet() ? <>{children}</> : <WalletProvider>{children}</WalletProvider>;
}
