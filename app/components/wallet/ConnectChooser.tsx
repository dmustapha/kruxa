'use client';
// Connect chooser: a modal <dialog> with two chain-labelled groups. Opens only from an action button.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTION_LABEL } from '@/lib/wallet/gating';
import { WalletError, type Chain, type WalletOption } from '@/lib/wallet/types';
import { useWallet, type ChooserRequest } from './WalletProvider';

type ListState = { status: 'loading' } | { status: 'ready'; options: WalletOption[] } | { status: 'error'; message: string };

const GROUPS: { chain: Chain; title: string; blurb: string }[] = [
  { chain: 'near', title: 'NEAR wallets', blurb: 'Create, commit, walk and claim directly.' },
  { chain: 'solana', title: 'Solana wallets', blurb: 'Back a launch through the Intents buyer path. Cannot create a launch.' },
];

const message = (e: unknown): string => (e instanceof WalletError ? e.message : 'Something went wrong. Try again.');

export function ConnectChooser({ request, onClose }: { request: ChooserRequest | null; onClose: () => void }) {
  const { adapters, sessions } = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [lists, setLists] = useState<Record<Chain, ListState>>({ near: { status: 'loading' }, solana: { status: 'loading' } });
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Chain, string>>>({});
  const open = request !== null;

  const load = useCallback((chain: Chain) => {
    setLists((p) => ({ ...p, [chain]: { status: 'loading' } }));
    adapters[chain].listWallets()
      .then((options) => setLists((p) => ({ ...p, [chain]: { status: 'ready', options } })))
      .catch((e: unknown) => setLists((p) => ({ ...p, [chain]: { status: 'error', message: message(e) } })));
  }, [adapters]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setErrors({});
      load('near');
      load('solana');
    }
    if (!open && dialog.open) dialog.close();
  }, [open, load]);

  useEffect(() => {
    const solana = adapters.solana as { onRegistryChange?: (cb: () => void) => () => void };
    if (!open || !solana.onRegistryChange) return;
    return solana.onRegistryChange(() => load('solana'));
  }, [open, adapters, load]);

  async function pick(chain: Chain, wallet: WalletOption) {
    setBusy(`${chain}:${wallet.id}`);
    setErrors((p) => ({ ...p, [chain]: undefined }));
    try {
      await adapters[chain].connect(wallet.id);
      onClose();
    } catch (e) {
      setErrors((p) => ({ ...p, [chain]: message(e) }));
    } finally {
      setBusy(null);
    }
  }

  const allowed = request?.chains ?? [];
  const action = request ? ACTION_LABEL[request.action] : '';

  return (
    <dialog ref={ref} className="wlt-dialog" aria-labelledby="wlt-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="wlt-sheet">
        <div className="wlt-head">
          <h2 id="wlt-title">Connect a wallet to {action.toLowerCase()}</h2>
          <button type="button" className="wlt-close" aria-label="Close" onClick={onClose}>Close</button>
        </div>
        <p className="wlt-sub">You are only asked because you pressed {action}. Browsing and verifying never need a wallet.</p>
        {GROUPS.map((g) => (
          <Group key={g.chain} {...g} list={lists[g.chain]} enabled={allowed.includes(g.chain)} connected={sessions[g.chain]?.address ?? null}
            busy={busy} error={errors[g.chain]} onPick={(w) => void pick(g.chain, w)} onRetry={() => load(g.chain)} actionLabel={action} />
        ))}
      </div>
    </dialog>
  );
}

interface GroupProps {
  chain: Chain; title: string; blurb: string; list: ListState; enabled: boolean; connected: string | null;
  busy: string | null; error?: string; actionLabel: string; onPick(w: WalletOption): void; onRetry(): void;
}

function Group({ chain, title, blurb, list, enabled, connected, busy, error, actionLabel, onPick, onRetry }: GroupProps) {
  const headingId = `wlt-group-${chain}`;
  return (
    <section className="wlt-group" aria-labelledby={headingId} data-chain={chain} data-enabled={enabled}>
      <h3 id={headingId}><span className={`wlt-chip wlt-chip-${chain}`}>{chain === 'near' ? 'NEAR' : 'SOL'}</span> {title}</h3>
      <p className="wlt-blurb">{enabled ? blurb : `${actionLabel} needs a NEAR account. Solana wallets are not offered here.`}</p>
      {connected && <p className="wlt-blurb">Connected: <code>{connected}</code></p>}
      {list.status === 'loading' && <p className="wlt-state" role="status">Loading wallets...</p>}
      {list.status === 'error' && (
        <p className="wlt-state bad" role="alert">{list.message} <button type="button" onClick={onRetry}>Retry</button></p>
      )}
      {list.status === 'ready' && list.options.length === 0 && <p className="wlt-state">No wallets available on this network.</p>}
      {list.status === 'ready' && list.options.length > 0 && (
        <ul className="wlt-list">
          {list.options.map((w) => {
            const key = `${chain}:${w.id}`;
            return (
              <li key={key}>
                {w.installed ? (
                  <button type="button" className="wlt-wallet" disabled={!enabled || busy !== null} aria-busy={busy === key} onClick={() => onPick(w)}>
                    {w.icon ? <img src={w.icon} alt="" width={24} height={24} /> : <span className="wlt-icon-fallback" aria-hidden="true" />}
                    <span>{w.name}</span>
                    {busy === key && <span className="wlt-spin" role="status">Waiting for wallet...</span>}
                  </button>
                ) : (
                  <a className="wlt-wallet wlt-missing" href={w.installUrl} target="_blank" rel="noopener noreferrer" aria-disabled={!enabled}>
                    <span>{w.name}</span><span className="wlt-note">Not detected. Install</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="wlt-state bad" role="alert">{error}</p>}
    </section>
  );
}
