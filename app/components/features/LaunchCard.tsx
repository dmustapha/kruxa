import Link from 'next/link';
import { Countdown } from '@/components/ui/Countdown';
import { SourceBadge, StageBadge, VerdictBadge } from '@/components/ui/Badges';
import { MarginMeter } from '@/components/ui/Meter';
import { MarginBadge } from './MarginBadge';
import { fmtUsdc } from '@/lib/config';
import { shortAccount } from '@/lib/format';
import { nextDeadline } from '@/lib/launch';
import type { LaunchSummary } from '@/lib/api/types';

export function LaunchCard({ launch, now, frozenClock }: { launch: LaunchSummary; now: number; frozenClock?: boolean }) {
  const next = nextDeadline(launch, now);
  return (
    <Link href={`/launch/${launch.launch_id}`} className="lcard" aria-label={`Launch ${launch.launch_id}, ${launch.symbol}`}>
      <div className="row between">
        <span className="sym">{launch.symbol}</span>
        <span className="row"><StageBadge stage={launch.stage} /><VerdictBadge verdict={launch.verdict} status={launch.status} /></span>
      </div>
      <div className="sub">#{launch.launch_id} by {shortAccount(launch.creator)}</div>
      <MarginMeter totalActive={launch.total_active} softCap={launch.soft_cap} progressBps={launch.progress_bps} />
      <div className="row"><MarginBadge launch={launch} /></div>
      <div className="row between sub">
        <span className="num">{launch.funders} backers · {fmtUsdc(launch.total_active)}</span>
        <SourceBadge source={launch.source} />
      </div>
      {next && <div className="sub"><Countdown label={next.label} at={next.at} now={now} frozen={frozenClock} /></div>}
    </Link>
  );
}
