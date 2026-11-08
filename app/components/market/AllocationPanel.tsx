'use client';
// Creator allocation (instant launches): allocated, vested, claimed, claimable, next unlock, and claim_vested to the payout recipient.
import { useState } from 'react';
import { useWallet } from '@/components/wallet/index';
import { MARKET_CONFIG } from '@/lib/market/config';
import { fmtBps, fmtUnits, shortAccount } from '@/lib/market/format';
import type { InstantBundle, Section } from '@/lib/market/hooks';
import { claimVestedBlock, utc, vestSchedule } from '@/lib/market/instant';
import { buildClaimVestedTx, describeSignError } from '@/lib/market/tx';
import type { TokenPageData } from '@/lib/market/types';
import { Async, Panel } from './shared';

type Phase = { s: 'idle' } | { s: 'signing' } | { s: 'sent'; txHash?: string } | { s: 'error'; message: string };
const tok = (v: bigint | null): string => (v === null ? 'unknown' : `${fmtUnits(v, 6, 2)}`);

export function AllocationPanel({ page, instant, nowSec, onClaimed, onRetry }: { page: TokenPageData; instant: Section<InstantBundle>; nowSec: number; onClaimed(): void; onRetry(): void }) {
  const { guard, sessions, adapters, openChooser } = useWallet();
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const recipient = page.creator?.payout_recipient ?? page.launch.payout_recipient;
  const near = sessions.near;

  async function claim() {
    if (!near) { openChooser({ action: 'claim', chains: ['near'] }); return; }
    setPhase({ s: 'signing' });
    try {
      const res = await adapters.near.signAndSendTransaction(buildClaimVestedTx(MARKET_CONFIG.launcherAccount, page.launch.launch_id));
      setPhase({ s: 'sent', txHash: res.txHash });
      onClaimed();
    } catch (e) { setPhase({ s: 'error', message: describeSignError(e) }); }
  }

  return (
    <Panel title="Creator allocation" id="mkt-alloc-h">
      <Async section={instant} lines={4} onRetry={onRetry}>
        {(b) => {
          const s = vestSchedule(b.info, b.vesting, nowSec);
          const block = claimVestedBlock(s, recipient, near?.address ?? null, guard.signingEnabled, guard.lockReason);
          const pct = b.info?.creator_alloc_bps !== undefined ? ` (${fmtBps(b.info.creator_alloc_bps)} of supply)` : '';
          return (
            <>
              <dl className="mkt-kv">
                <dt>Allocated</dt><dd>{tok(s.allocated)} tokens{pct}</dd>
                <dt>Vested so far</dt><dd>{tok(s.unlocked)}</dd>
                <dt>Claimed</dt><dd>{tok(s.claimed)}</dd>
                <dt>Claimable now</dt><dd><strong>{tok(s.claimable)}</strong></dd>
                <dt>Cliff ends</dt><dd>{s.cliffEndSec ? utc(s.cliffEndSec) : 'unknown'}</dd>
                <dt>Fully vested</dt><dd>{s.vestEndSec ? utc(s.vestEndSec) : 'unknown'}</dd>
                <dt>Pays out to</dt><dd title={recipient}>{shortAccount(recipient, 16, 4)}</dd>
              </dl>
              <p className="mkt-note"><strong>Next unlock:</strong> {s.next}</p>
              <p className="mkt-note">
                {s.basis === 'contract view' ? 'Read from the launcher contract (get_vesting).' : s.basis === 'api' ? 'From the indexer.' : s.basis === 'schedule estimate' ? 'Estimate from the schedule with the contract formula. The launcher view was not reachable, so the claimed and claimable amounts may be stale.' : 'No vesting data was reported.'}
                {' '}The allocation is held by the launcher, never in the pool. The creator can sell what vests, and can move claimed tokens to other wallets.
              </p>
              {block && <div className="mkt-alert" data-tone="warn" role="status">{block}</div>}
              {phase.s === 'error' && <div className="mkt-alert" data-tone="bad" role="alert"><strong>Not sent</strong>{phase.message}</div>}
              {phase.s === 'sent' && <div className="mkt-alert" data-tone="ok" role="status"><strong>Claim submitted</strong>{phase.txHash && <>Transaction <a href={`${MARKET_CONFIG.explorerTx}${phase.txHash}`} target="_blank" rel="noopener noreferrer" className="mkt-mono">{phase.txHash.slice(0, 10)}…</a>. </>}Asking for more than is claimable is refused (STREAM_CAP). Check the result on the explorer.</div>}
              <button type="button" className="mkt-submit" data-side="buy" onClick={() => void claim()} disabled={phase.s === 'signing' || (near ? !!block : !guard.signingEnabled)} aria-busy={phase.s === 'signing' || undefined}>
                {phase.s === 'signing' ? 'Waiting for wallet...' : near ? 'Claim vested tokens to the payout recipient' : 'Connect wallet to claim'}
              </button>
            </>
          );
        }}
      </Async>
    </Panel>
  );
}
