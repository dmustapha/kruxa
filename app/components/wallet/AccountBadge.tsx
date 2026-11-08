'use client';
import { useState } from 'react';
import type { WalletSession } from '@/lib/wallet/types';
import { NetworkBadge } from './NetworkBadge';
import { useWallet } from './WalletProvider';

const short = (a: string): string => (a.length > 24 ? `${a.slice(0, 6)}...${a.slice(-6)}` : a);

/** One connected account with its chain badge and a Disconnect button. */
export function AccountBadge({ session }: { session: WalletSession }) {
  const { disconnect } = useWallet();
  const [busy, setBusy] = useState(false);
  const chain = session.chain === 'near' ? 'NEAR' : 'Solana';
  return (
    <div className="wlt-account" data-chain={session.chain}>
      <span className={`wlt-chip wlt-chip-${session.chain}`}>{chain}</span>
      <span className="wlt-addr" title={session.address}>{short(session.address)}</span>
      <span className="wlt-via">{session.walletName}</span>
      <button type="button" className="wlt-link" disabled={busy} aria-label={`Disconnect ${chain} account ${session.address}`}
        onClick={() => { setBusy(true); void disconnect(session.chain).finally(() => setBusy(false)); }}>
        {busy ? 'Disconnecting...' : 'Disconnect'}
      </button>
    </div>
  );
}

/** Shows connected sessions and the network label. It renders nothing to click when no one is connected, by design: connect lives on action buttons. */
export function WalletStatus() {
  const { sessions } = useWallet();
  const list = [sessions.near, sessions.solana].filter((s): s is WalletSession => s !== null);
  return (
    <div className="wlt-status" aria-label="Wallet status">
      <NetworkBadge />
      {list.map((s) => <AccountBadge key={s.chain} session={s} />)}
      {sessions.solana?.intentsAccountId && (
        <p className="wlt-blurb">Intents account: <code title={sessions.solana.intentsAccountId}>{sessions.solana.intentsAccountId.slice(0, 8)}...{sessions.solana.intentsAccountId.slice(-6)}</code></p>
      )}
    </div>
  );
}
