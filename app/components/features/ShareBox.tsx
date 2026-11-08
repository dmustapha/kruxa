'use client';
import { CopyButton } from '@/components/ui/CopyButton';
import { fmtDate } from '@/lib/format';
import { fmtUsdc } from '@/lib/config';
import type { LaunchSummary } from '@/lib/api/types';

/** Share text per APP-SPEC 9.10. Recorded facts only: no price talk, no promises. */
export function shareText(l: Pick<LaunchSummary, 'symbol' | 'total_active' | 'soft_cap' | 'funders' | 'min_funders' | 'walk_end'>, url: string): string {
  const of = l.soft_cap ? ` of ${fmtUsdc(l.soft_cap)}` : '';
  const backers = l.min_funders != null ? `${l.funders} backers of ${l.min_funders}` : `${l.funders} backers`;
  return `$${l.symbol} is in its trial on Kruxa: ${fmtUsdc(l.total_active)} committed${of}, ${backers}.${l.walk_end ? ` Walk window closes ${fmtDate(l.walk_end)}.` : ''} ${url}`;
}

export function ShareBox({ launch, url }: { launch: LaunchSummary; url: string }) {
  const text = shareText(launch, url);
  return (
    <div className="row">
      <a className="btn" style={{ minHeight: 40 }} href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer noopener">Share on X<span className="sr-only"> (opens in a new tab)</span></a>
      <CopyButton text={url} label="Copy link" />
    </div>
  );
}
