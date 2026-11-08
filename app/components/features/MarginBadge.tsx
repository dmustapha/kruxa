import { Badge } from '@/components/ui/Badges';
import { fmtSignedUsdc } from '@/lib/format';
import { marginOf } from '@/lib/launch';
import type { LaunchSummary } from '@/lib/api/types';

/** The verdict margin in plain words: how far each of the two live inputs is from the PASS line. */
export function MarginBadge({ launch }: { launch: Pick<LaunchSummary, 'total_active' | 'soft_cap' | 'funders' | 'min_funders' | 'verdict'> }) {
  const m = marginOf(launch);
  if (m.clears === null) return <Badge tone="muted">Margin unknown</Badge>;
  const parts = [
    m.usdc !== null ? `${fmtSignedUsdc(m.usdc)} vs soft cap` : null,
    m.funders !== null ? `${m.funders >= 0 ? '+' : ''}${m.funders} backers vs minimum` : null,
  ].filter(Boolean);
  return <Badge tone={m.clears ? 'pass' : 'warn'} title="total committed minus soft cap, and backers minus minimum backers">{m.clears ? 'Clears' : 'Short'} · {parts.join(' · ')}</Badge>;
}
