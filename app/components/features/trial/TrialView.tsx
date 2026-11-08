'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { useNow } from '@/lib/clock';
import { nextDeadline, phaseText } from '@/lib/launch';
import { shortAccount } from '@/lib/format';
import { useHolderKeys } from '@/lib/useHolders';
import { Badge, SourceBadge, StageBadge } from '@/components/ui/Badges';
import { Countdown } from '@/components/ui/Countdown';
import { Freshness } from '@/components/ui/Freshness';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { FundsStrip } from '../FundsStrip';
import { EventLog } from './EventLog';
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

export function TrialView() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi(() => api.launch(id), `launch-${id}`, 10000);
  const health = useApi(() => api.health(), 'health', 15000);
  const chain = useChainLaunch(id);
  const holders = useHolderKeys();
  const funds = useApi(holders.keys.length ? () => Promise.all(holders.keys.map((k) => api.portfolio(k))) : null, `fim-${holders.keys.join(',')}`, 20000);
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
  const live = chain.status === 'ok' ? chain.data : null;
  const phase = phaseFor(detail.data, live?.state ?? null);
  const next = nextDeadline(detail.data, now);
  const fundsItems = funds.status === 'ok' ? funds.data.flatMap((p) => p.funds_in_motion) : undefined;
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Launch #{detail.data.launch_id} · trial</p>
        <div className="row"><h1>{detail.data.symbol}</h1><StageBadge stage={detail.data.stage} /><SourceBadge source={detail.data.source} /></div>
        <p className="lede">{phaseText(detail.data.stage, detail.data.verdict)}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {next && <Countdown label={next.label} at={next.at} now={now} frozen={detail.data.source === 'fixture'} />}
          <BookHashCrosscheck indexer={detail.data.verdict_inputs.book_hash_folded} chain={live?.state?.book_hash} />
          <Link className="btn" href={`/launch/${id}/verify`}>Recompute the verdict yourself</Link>
        </div>
        <p className="hint">Creator {shortAccount(detail.data.creator)} · payout recipient {shortAccount(detail.data.payout_recipient)}{chain.status === 'error' ? ' · the NEAR RPC is not answering, so live phase and terms are hidden rather than guessed' : ''}</p>
      </header>
      <div className="grid grid-aside">
        <div className="stack">
          <VerdictPanel d={detail.data} />
          <TermsPanel charter={live?.charter ?? null} />
          <FundsStrip items={fundsItems} keys={holders.keys} loading={funds.status === 'loading'} error={funds.status === 'error' ? funds.error.message : null} />
          <EventLog events={detail.data.timeline} bookHash={detail.data.verdict_inputs.book_hash_folded} />
        </div>
        <TrialActions d={detail.data} chain={live?.state ?? null} charter={live?.charter ?? null} phase={phase} onChanged={reload} />
      </div>
      <div style={{ marginTop: 16 }}><Freshness source={detail.data.source} asOf={asOf} /></div>
      <section className="card" aria-labelledby="disc-h">
        <h2 id="disc-h" style={{ marginTop: 0 }}>Disclosures for this trial</h2>
        <ul>
          <li>The NEAR-side launch token exists from the start of the trial. Only the Solana mint is gated by PASS.</li>
          <li>No independent audit. A single-party upgrade key exists on testnet. The factory token publisher key can change token code.</li>
          <li>Solana-delivered tokens after PASS carry fixed-supply protection and claims, not a refund right.</li>
        </ul>
        <p><Link href="/charter">Full disclosures</Link></p>
      </section>
    </>
  );
}
