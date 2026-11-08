'use client';
// The only place a wallet prompt starts. Browsing and verifying never render this.
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { gateAction, intentsPathNote, type GateDecision } from '@/lib/wallet/gating';
import type { WalletAction } from '@/lib/wallet/types';
import { useWallet } from './WalletProvider';

export type ReadyDecision = Extract<GateDecision, { status: 'ready' }>;

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  action: WalletAction;
  /** Runs only when the gate says ready, from the user's own click. It must perform the signing itself. */
  onReady(decision: ReadyDecision): void;
  children: ReactNode;
  loading?: boolean;
}

export function WalletActionButton({ action, onReady, children, loading, disabled, ...rest }: Props) {
  const { guard, sessions, openChooser } = useWallet();
  const noteId = useId();
  const decision = gateAction(action, sessions, guard);
  const note =
    decision.status === 'needs-near' || decision.status === 'blocked' ? decision.message
    : decision.status === 'ready' && decision.path === 'solana-intents' ? intentsPathNote(action)
    : null;
  const blocked = decision.status === 'blocked';

  function click() {
    if (decision.status === 'ready') return onReady(decision);
    if (decision.status === 'connect') return openChooser({ action, chains: decision.chains });
    if (decision.status === 'needs-near') return openChooser({ action, chains: ['near'] });
  }

  return (
    <div className="wlt-action">
      <button {...rest} type="button" onClick={click} disabled={disabled || loading || blocked} aria-busy={loading || undefined}
        aria-describedby={note ? noteId : undefined} data-gate={decision.status}>
        {loading ? 'Waiting for wallet...' : children}
      </button>
      {note && <p id={noteId} role="status" className={decision.status === 'ready' ? 'wlt-note' : 'wlt-note wlt-note-warn'}>{note}</p>}
    </div>
  );
}
