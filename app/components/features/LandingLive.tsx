'use client';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import type { LaunchSummary } from '@/lib/api/types';
import { useNow } from '@/lib/clock';
import { Freshness } from '@/components/ui/Freshness';
import { ErrorState, SkeletonCards, EmptyState } from '@/components/ui/States';
import { LaunchCard } from './LaunchCard';

/** Prefer a launch that already has a verdict: it is the one a stranger can fully recompute. */
export function pickFeatured(items: LaunchSummary[]): LaunchSummary | null {
  return items.find((l) => l.verdict) ?? items[0] ?? null;
}

export function HeroActionsAndCard() {
  const s = useApi(() => api.launches({ limit: 12 }), 'landing-launches');
  const items = s.status === 'ok' ? s.data.items : [];
  const featured = pickFeatured(items);
  const now = useNow(s.status === 'ok' ? s.data.source : undefined, s.status === 'ok' ? s.data.as_of : undefined);
  const verifyId = featured?.launch_id ?? '1';
  return (
    <>
      <div className="cta">
        <Link className="btn btn-primary" href={`/launch/${verifyId}/verify`}>Check a launch yourself</Link>
        <Link className="btn" href="/create?preset=hostile">Try the dry run</Link>
      </div>
      <p className="hint">No wallet and no funds. The check recomputes the verdict in your browser from public chain reads{featured ? ` for launch #${featured.launch_id}` : ''}.</p>
      <h2 style={{ marginTop: 40 }}>A launch you can open right now</h2>
      {s.status === 'loading' && <SkeletonCards n={1} />}
      {s.status === 'error' && <ErrorState error={s.error} what="the live launch" onRetry={s.reload} />}
      {s.status === 'ok' && !featured && <EmptyState title="No launch indexed yet">The indexer is reachable but has not read a launch. Nothing is shown in its place.</EmptyState>}
      {s.status === 'ok' && featured && (
        <div className="stack" style={{ maxWidth: 420 }}>
          <LaunchCard launch={featured} now={now} frozenClock={featured.source === 'fixture'} />
          <Freshness source={s.data.source} asOf={s.data.as_of} />
        </div>
      )}
    </>
  );
}
