'use client';
// Creator earnings and claim. Claim is market.claim(launch_id): only the payout recipient may call it and the money goes to the recipient.
import { useState } from 'react';
import { useWallet } from '@/components/wallet/index';
import { MARKET_CONFIG } from '@/lib/market/config';
import type { MarketFacts } from '@/lib/market/facts';
import { fmtUnits, shortAccount } from '@/lib/market/format';
import type { CreatorBundle, Section } from '@/lib/market/hooks';
import { buildClaimTx, describeSignError } from '@/lib/market/tx';
import { TRADE_ACTION } from '@/lib/market/wallet-bridge';
import type { TokenPageData } from '@/lib/market/types';
import { Async, Panel } from './shared';

const MIN_CLAIM = 1_000_000n;
type Phase = { s: 'idle' } | { s: 'signing' } | { s: 'sent'; txHash?: string } | { s: 'error'; message: string };

export function claimableOf(b: CreatorBundle): bigint | null {
  try {
    if (b.status) return BigInt(b.status.claimable);
    if (b.earnings?.claimable_estimate !== undefined) return BigInt(b.earnings.claimable_estimate);
  } catch { /* fall through */ }
  return null;
}

export function CreatorPanel({ page, facts, earnings, onClaimed, onRetry }: { page: TokenPageData; facts: MarketFacts; earnings: Section<CreatorBundle>; onClaimed(): void; onRetry(): void }) {
  const { guard, sessions, adapters, openChooser } = useWallet();
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const recipient = page.creator?.payout_recipient ?? page.launch.payout_recipient;
  const near = sessions.near;
  const isRecipient = near?.address === recipient;

  async function claim() {
    if (!near) { openChooser({ action: 'claim', chains: ['near'] }); return; }
    setPhase({ s: 'signing' });
    try {
      const res = await adapters.near.signAndSendTransaction(buildClaimTx(facts.market, page.launch.launch_id));
      setPhase({ s: 'sent', txHash: res.txHash });
      onClaimed();
    } catch (e) { setPhase({ s: 'error', message: describeSignError(e) }); }
  }

  return (
    <Panel title="Creator earnings" id="mkt-creator-h">
      <Async section={earnings} lines={3} onRetry={onRetry}>
        {(b) => {
          const claimable = claimableOf(b);
          const tooSmall = claimable !== null && claimable < MIN_CLAIM;
          const reason = !page.pool.open ? 'Fees accrue once the pool is open.'
            : !guard.signingEnabled ? (guard.lockReason ?? 'Signing is locked on this network.')
            : near && !isRecipient ? `Connected as ${shortAccount(near.address, 14, 4)}. Only the payout recipient can claim.`
            : claimable === null ? 'The claimable amount is unknown, so claiming is disabled.'
            : tooSmall ? 'The minimum claim is $1.' : null;
          return (
            <>
              <dl className="mkt-kv">
                {b.status ? (<>
                  <dt>Accrued</dt><dd>${fmtUnits(b.status.accrued, 6, 4)}</dd>
                  <dt>Unlocked</dt><dd>${fmtUnits(b.status.unlocked, 6, 4)}</dd>
                  <dt>Already paid</dt><dd>${fmtUnits(b.status.paid, 6, 4)}</dd>
                  <dt>Claimable now</dt><dd><strong>${fmtUnits(b.status.claimable, 6, 4)}</strong></dd>
                </>) : b.earnings ? (<>
                  <dt>Creator slice earned</dt><dd>${fmtUnits(b.earnings.market_fees_creator_slice, 6, 4)}</dd>
                  <dt>Claimed</dt><dd>${fmtUnits(b.earnings.claimed, 6, 4)}</dd>
                  <dt>Claimable (estimate)</dt><dd>${fmtUnits(b.earnings.claimable_estimate, 6, 4)}</dd>
                </>) : (<><dt>Earnings</dt><dd>unknown</dd></>)}
                <dt>Pays out to</dt><dd title={recipient}>{shortAccount(recipient, 16, 4)}</dd>
              </dl>
              <p className="mkt-note">{b.basis === 'chain' ? 'Read from the market contract (creator_status).' : b.basis === 'indexer' ? 'Indexer estimate, folded from swap events. The contract view was not reachable, so the exact unlocked amount is unknown.' : 'Neither the contract view nor the indexer reported earnings.'} Claims always pay the payout recipient.</p>
              {b.stream && <StreamBar s={b.stream} />}
              {reason && <div className="mkt-alert" data-tone="warn" role="status">{reason}</div>}
              {phase.s === 'error' && <div className="mkt-alert" data-tone="bad" role="alert"><strong>Not sent</strong>{phase.message}</div>}
              {phase.s === 'sent' && <div className="mkt-alert" data-tone="ok" role="status"><strong>Claim submitted</strong>{phase.txHash && <>Transaction <a href={`${MARKET_CONFIG.explorerTx}${phase.txHash}`} target="_blank" rel="noopener noreferrer" className="mkt-mono">{phase.txHash.slice(0, 10)}…</a>. </>}Check the result on the explorer.</div>}
              <button type="button" className="mkt-submit" data-side="buy" onClick={() => void claim()} disabled={phase.s === 'signing' || (near ? !!reason : !!(!page.pool.open || !guard.signingEnabled))} aria-busy={phase.s === 'signing' || undefined}>
                {phase.s === 'signing' ? 'Waiting for wallet...' : near ? 'Claim to payout recipient' : 'Connect wallet to claim'}
              </button>
            </>
          );
        }}
      </Async>
    </Panel>
  );
}

function StreamBar({ s }: { s: NonNullable<CreatorBundle['stream']> }) {
  const pct = s.progress_bps !== null && s.progress_bps !== undefined ? s.progress_bps / 100 : null;
  return (
    <div style={{ margin: '12px 0' }}>
      <div className="mkt-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}><span>Trial proceeds stream</span><span className="mkt-mono">${fmtUnits(s.drawn, 6, 2)} of ${fmtUnits(s.total, 6, 2)} drawn</span></div>
      <span className="mkt-bar" role="progressbar" aria-label="Stream drawn" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} style={{ marginTop: 6 }}><span style={{ width: `${pct ?? 0}%` }} /></span>
      <p className="mkt-note">{s.drawable_estimate ? `Drawable now (estimate): $${fmtUnits(s.drawable_estimate, 6, 2)}.` : 'Drawable amount unknown.'} The creator desk draws it.</p>
    </div>
  );
}
