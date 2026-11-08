'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { useNow } from '@/lib/clock';
import { fmtDuration, shortAccount } from '@/lib/format';
import { nextDeadline } from '@/lib/launch';
import { PHASE_LABEL, phaseOf } from '@/lib/phase';
import { useHolderKeys } from '@/lib/useHolders';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { Countdown } from '@/components/ui/Countdown';
import { Freshness } from '@/components/ui/Freshness';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { PhaseBadge } from '@/components/ui/PhaseBadge';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { VerdictMeters } from '@/components/ui/VerdictMeters';
import { FundsStrip } from '../FundsStrip';
import { GenesisStepper } from '../GenesisStepper';
import { RecomputeButton } from '../RecomputeButton';
import { ShareBox } from '../ShareBox';
import { EventLog } from './EventLog';
import { LifecycleStepper } from './LifecycleStepper';
import { TermsPanel } from './TermsPanel';
import { TrialActions, phaseFor } from './TrialActions';
import { VerdictPanel } from './VerdictPanel';
import { useChainLaunch } from './useChain';

function BookHashCrosscheck({ indexer, chain }: { indexer: string; chain: string | null | undefined }) {
  if (!chain) return <Badge tone="muted" title="The NEAR RPC did not answer, so there is nothing to compare the indexer against.">Chain cross-check unavailable</Badge>;
  return indexer === chain
    ? <Badge tone="match" title="The indexer's last logged book hash equals the contract's get_state book hash.">Book hash matches the contract</Badge>
    : <Badge tone="mismatch" title="The indexer and the contract disagree. Run scripts/verify.sh.">Book hash differs from the contract</Badge>;
}

type MTab = 'terms' | 'activity' | 'verify';

export function TrialView() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi(() => api.launch(id), `launch-${id}`, 10000);
  const health = useApi(() => api.health(), 'health', 15000);
  const chain = useChainLaunch(id);
  const holders = useHolderKeys();
  const funds = useApi(holders.keys.length ? () => Promise.all(holders.keys.map((k) => api.portfolio(k))) : null, `fim-${holders.keys.join(',')}`, 20000);
  const [mtab, setMtab] = useState<MTab>('terms');
  const d = detail.status === 'ok' ? detail.data : null;
  const asOf = health.status === 'ok' ? health.data.as_of : undefined;
  const now = useNow(d?.source, asOf);
  const reload = useCallback(() => { detail.reload(); chain.reload(); }, [detail, chain]);

  if (detail.status === 'loading' || detail.status === 'idle') return <LoadingBlock label={`Loading launch ${id}`} lines={5} />;
  if (detail.status === 'error') {
    return (
      <>
        <ErrorState error={detail.error} what={`launch ${id}`} onRetry={detail.reload} />
        <p className="hint">You can still <Link href={`/launch/${id}/verify`}>recompute this launch from the chain</Link>; that page does not need the indexer.</p>
      </>
    );
  }
  const l = detail.data;
  const live = chain.status === 'ok' ? chain.data : null;
  const phase = phaseOf(l, now);
  const chainPhase = phaseFor(l, live?.state ?? null);
  const next = nextDeadline(l, now);
  const fundsItems = funds.status === 'ok' ? funds.data.flatMap((p) => p.funds_in_motion) : undefined;
  const url = typeof window === 'undefined' ? `/launch/${id}` : `${window.location.origin}/launch/${id}`;
  const primary = phase === 'OPEN' ? { href: '#act-commit', label: 'Commit' } : phase === 'WALK_WINDOW' ? { href: '#act-walk', label: 'Walk' } : phase === 'AWAITING_SETTLE' ? { href: '#act-settle', label: 'Settle' }
    : phase === 'TRADING' ? { href: `/token/${id}`, label: 'Trade' } : phase === 'FAIL' ? { href: '#act-settle', label: 'Claim refund' } : phase === 'PASS' ? { href: '#act-settle', label: 'Claim tokens' } : null;
  const hide = (t: MTab): string => (mtab === t ? '' : 'mt-hide');

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <LaunchSigil id={l.launch_id} symbol={l.symbol} size={64} />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Launch #{l.launch_id} · trial</p>
            <h1>{l.name && l.name !== l.symbol ? <>{l.name} <span style={{ color: 'var(--accent)' }}>${l.symbol}</span></> : <>${l.symbol}</>}</h1>
            <div className="row" style={{ marginTop: 8 }}><PhaseBadge phase={phase} /><SourceBadge source={l.source} /><BookHashCrosscheck indexer={l.verdict_inputs.book_hash_folded} chain={live?.state?.book_hash} /></div>
          </div>
        </div>
        <p className="hint">Creator {shortAccount(l.creator)} · payout recipient {shortAccount(l.payout_recipient)}{chain.status === 'error' ? ' · the NEAR RPC is not answering, so live phase and terms are hidden rather than guessed' : ''}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {next && <Countdown label={next.label} at={next.at} now={now} frozen={l.source === 'fixture'} />}
          <ShareBox launch={l} url={url} />
        </div>
      </header>

      <LifecycleStepper phase={phase} events={l.timeline} deadline={next ? `${next.label} ${fmtDuration(next.at - now)}` : undefined} />
      {phase === 'TRADING' && <div className="callout ok"><p><b>Trading on the Kruxa NEAR pool.</b> <Link href={`/token/${id}`}>Open the trade view</Link>. Unreviewed market contract; not executable across chains.</p></div>}

      <section className="card" aria-labelledby="vm-h">
        <h2 id="vm-h" style={{ marginTop: 0 }}>Where the verdict stands</h2>
        <VerdictMeters l={{ ...l, verdict: l.verdict }} />
        <p className="hint">The verdict is three public numbers anyone can recompute: total committed, active backers, and the Charter&apos;s two thresholds.</p>
      </section>

      <div className="seg mtabs" role="tablist" aria-label="Sections" style={{ margin: '0 0 12px' }}>
        {(['terms', 'activity', 'verify'] as const).map((t) => <button key={t} role="tab" type="button" aria-selected={mtab === t} aria-pressed={mtab === t} onClick={() => setMtab(t)}>{t === 'terms' ? 'Terms' : t === 'activity' ? 'Activity' : 'Verify'}</button>)}
      </div>

      <div className="grid grid-aside">
        <div className="stack">
          <div className={hide('terms')}><VerdictPanel d={l} /><TermsPanel charter={live?.charter ?? null} /></div>
          <div className={`stack ${hide('verify')}`}>
            <section className="card" aria-labelledby="ver-h">
              <h2 id="ver-h" style={{ marginTop: 0 }}>Verify this launch</h2>
              <RecomputeButton launchId={l.launch_id} indexerBookHash={l.verdict_inputs.book_hash_folded} />
              <p className="hint">Command: <code>./scripts/verify.sh {l.launch_id}</code> (add <code>--tamper-all</code> to see it fail on purpose).</p>
            </section>
            <section className="card" aria-labelledby="gen-h">
              <h2 id="gen-h" style={{ marginTop: 0 }}>Genesis on Solana</h2>
              <GenesisStepper verdict={l.verdict} genesis={l.genesis} />
              <p className="hint">The Solana token is created only after a pass. The NEAR-side token exists from the start of the trial.</p>
            </section>
          </div>
          <div className={`stack ${hide('activity')}`}>
            <FundsStrip items={fundsItems} keys={holders.keys} loading={funds.status === 'loading'} error={funds.status === 'error' ? funds.error.message : null} />
            <EventLog events={l.timeline} bookHash={l.verdict_inputs.book_hash_folded} />
          </div>
        </div>
        <div className="stack">
          <TrialActions d={l} chain={live?.state ?? null} charter={live?.charter ?? null} phase={chainPhase} onChanged={reload} />
          <section className="card" aria-labelledby="disc-h">
            <h2 id="disc-h" style={{ marginTop: 0, fontSize: '1.1rem' }}>Disclosures for this trial</h2>
            <ul>
              <li>No independent audit. A single-party upgrade key exists on testnet; the factory token publisher key can change token code.</li>
              <li>A relay fee, if you paid one, is not returned on a Walk.</li>
              <li>Solana-delivered tokens after PASS carry fixed-supply protection and claims, not a refund right.</li>
            </ul>
            <p><Link href="/charter">Full disclosures</Link></p>
          </section>
        </div>
      </div>
      <div style={{ margin: '16px 0' }}><Freshness source={l.source} asOf={asOf} /></div>
      {primary && (
        <div className="actionbar" role="region" aria-label={`Primary action: ${PHASE_LABEL[phase]}`}>
          <a className="btn btn-primary" href={primary.href}>{primary.label}</a>
          <a className="btn" href="#ver-h">Verify</a>
        </div>
      )}
    </>
  );
}
