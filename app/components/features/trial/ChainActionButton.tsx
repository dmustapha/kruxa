'use client';
// A signing button tied to ONE chain, for the From NEAR and From Solana tabs. It never decides anything the gate decides:
// signing locked on this network disables it, a missing session opens the chooser limited to that chain.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useWallet } from '@/components/wallet';
import type { WalletAction, WalletSession } from '@/lib/wallet/index';
import type { Chain } from '@/lib/wallet/types';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  chain: Chain; action: WalletAction; onReady(session: WalletSession): void; loading?: boolean; children: ReactNode;
}

export function ChainActionButton({ chain, action, onReady, loading, disabled, children, ...rest }: Props) {
  const { guard, sessions, openChooser } = useWallet();
  const session = sessions[chain];
  const label = chain === 'near' ? 'NEAR' : 'Solana';
  const locked = !guard.signingEnabled;
  return (
    <div className="wlt-action">
      <button {...rest} type="button" disabled={disabled || loading || locked} aria-busy={loading || undefined}
        onClick={() => (session ? onReady(session) : openChooser({ action, chains: [chain] }))}>
        {loading ? 'Waiting for wallet...' : session ? children : `Connect a ${label} wallet to continue`}
      </button>
      {locked && <p role="status" className="wlt-note wlt-note-warn">{guard.lockReason}</p>}
    </div>
  );
}
