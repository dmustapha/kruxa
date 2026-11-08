// Lifecycle tabs (APP-SPEC 4.1) expressed as indexer queries. A tab may need more than one stream (Live trials is `new` plus `open`);
// the streams are merged client-side with the literal sort the user chose.
import type { LaunchSummary } from '@/lib/api/types';

export const TABS = ['live', 'walk', 'trading', 'pending', 'failed', 'all'] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { live: 'Live trials', walk: 'Walk window', trading: 'Trading', pending: 'Passed, market pending', failed: 'Failed and refunded', all: 'All' };
export const TAB_EMPTY: Record<Tab, string> = {
  live: 'No trial is open right now. Trials appear here a few blocks after a creator opens one.',
  walk: 'No launch is in its Walk window. Commits have closed on none of them.',
  trading: 'No token is trading on a Kruxa pool yet.',
  pending: 'No passed launch is waiting for its pool.',
  failed: 'No launch has failed yet.',
  all: 'The indexer has not read any launch yet.',
};

export interface StreamQuery { stage?: string; has_market?: boolean }

export const STREAMS: Record<Tab, StreamQuery[]> = {
  live: [{ stage: 'new' }, { stage: 'open' }], walk: [{ stage: 'closing' }], trading: [{ stage: 'passed', has_market: true }],
  pending: [{ stage: 'passed' }], failed: [{ stage: 'failed' }], all: [{}],
};

export const SORTS = [
  { v: 'newest', l: 'Newest' }, { v: 'ending_soon', l: 'Ending soon' }, { v: 'raised', l: 'Most committed' }, { v: 'funders', l: 'Most backers' }, { v: 'volume_24h', l: 'Volume 24 h' },
] as const;

export const keepForTab = (tab: Tab) => (l: LaunchSummary): boolean => (tab === 'pending' ? !l.has_market : true);

const big = (s: string): bigint => BigInt(s);
const deadline = (l: LaunchSummary): number => l.walk_end ?? l.commit_end ?? Number.MAX_SAFE_INTEGER;

export function compare(sort: string): (a: LaunchSummary, b: LaunchSummary) => number {
  switch (sort) {
    case 'raised': return (a, b) => (big(b.total_active) > big(a.total_active) ? 1 : big(b.total_active) < big(a.total_active) ? -1 : 0);
    case 'funders': return (a, b) => b.funders - a.funders;
    case 'ending_soon': return (a, b) => deadline(a) - deadline(b);
    case 'volume_24h': return (a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0);
    default: return (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || Number(big(b.launch_id) - big(a.launch_id));
  }
}
