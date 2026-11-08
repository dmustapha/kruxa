import Link from 'next/link';
import { Countdown } from '@/components/ui/Countdown';
import { SourceBadge } from '@/components/ui/Badges';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { ModeBadge, PhaseBadge } from '@/components/ui/PhaseBadge';
import { VerdictMeters } from '@/components/ui/VerdictMeters';
import { fmtUsdc } from '@/lib/config';
import { fmtDuration, shortAccount } from '@/lib/format';
import { marginSentence, nextDeadline } from '@/lib/launch';
import { PHASE_LABEL, hrefFor, phaseOf } from '@/lib/phase';
import type { LaunchSummary } from '@/lib/api/types';

export const launchLabel = (l: Pick<LaunchSummary, 'name' | 'symbol'>): string => (l.name && l.name !== l.symbol ? `${l.name} ${l.symbol}` : l.symbol);

/** One launch as a card. The whole card is one link (stretched title); Verify is a second, raised link. */
export function LaunchCard({ launch: l, now, frozenClock }: { launch: LaunchSummary; now: number; frozenClock?: boolean }) {
  const phase = phaseOf(l, now);
  const next = nextDeadline(l, now);
  const instant = l.mode === 'instant';
  const trial = !instant && phase !== 'TRADING';
  const name = `${l.symbol}, ${instant ? 'instant launch, no trial' : 'trial-verified'}, launch ${l.launch_id}, ${PHASE_LABEL[phase]}, ${instant ? '' : marginSentence(l) + ' '}${next ? ` ${next.label} ${fmtDuration(next.at - now)}` : ''}`;
  return (
    <article className="lc">
      <div className="lc-top">
        <LaunchSigil id={l.launch_id} symbol={l.symbol} />
        <div className="lc-id">
          <h3 className="lc-title"><Link href={hrefFor(l, phase)} aria-label={name} className="lc-link">{l.name && l.name !== l.symbol ? <>{l.name} <span className="lc-sym">${l.symbol}</span></> : <span className="lc-sym">${l.symbol}</span>}</Link></h3>
          <div className="sub">#{l.launch_id} by {shortAccount(l.creator)}</div>
        </div>
        <PhaseBadge phase={phase} />
      </div>
      <div className="row"><ModeBadge mode={l.mode} /></div>
      {trial
        ? <VerdictMeters l={l} />
        : (
          <dl className="kv lc-kv">
            <div><dt>Last price</dt><dd>{l.last_price != null ? `${l.last_price.toPrecision(4)} USDC` : 'no trade yet'}</dd></div>
            <div><dt>Volume 24 h</dt><dd>{l.volume_24h != null ? `${l.volume_24h.toFixed(2)} USDC` : 'unknown'}</dd></div>
            {instant
              ? <div><dt>Launch</dt><dd>{phase === 'LAUNCHING' ? 'pool not open yet' : 'no trial, no verdict'}</dd></div>
              : <div><dt>Committed at PASS</dt><dd>{fmtUsdc(l.total_active)}</dd></div>}
          </dl>
        )}
      <div className="lc-foot">
        {next && !instant ? <span className="sub"><Countdown label={next.label} at={next.at} now={now} frozen={frozenClock} /></span> : <span className="sub">{instant ? 'no backers: instant launch' : `${l.funders} backers`}</span>}
        <span className="row"><SourceBadge source={l.source} /><Link href={`/launch/${l.launch_id}/verify`} className="lc-verify">Verify</Link></span>
      </div>
    </article>
  );
}
