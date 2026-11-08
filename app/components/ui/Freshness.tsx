import type { AsOf, Source } from '@/lib/api/types';
import { fmtDate } from '@/lib/format';
import { SourceBadge } from './Badges';

/** Source badge plus the indexed block, so staleness is visible on every data view. */
export function Freshness({ source, asOf }: { source: Source | undefined; asOf: AsOf | undefined }) {
  return (
    <div className="row" style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
      <SourceBadge source={source} />
      <span className="num">{asOf?.block_height != null ? `indexed to block ${asOf.block_height}` : 'nothing indexed yet'}{asOf?.block_time ? ` · ${fmtDate(asOf.block_time)}` : ''}</span>
    </div>
  );
}
