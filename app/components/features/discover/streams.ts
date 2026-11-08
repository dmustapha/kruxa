// Lifecycle tabs (APP-SPEC 4.1) expressed as indexer queries. A tab may need more than one stream (Live trials is `new` plus `open`);
// the streams are merged client-side with the literal sort the user chose.
import type { LaunchSummary } from '@/lib/api/types';

export const TABS = ['live', 'walk', 'launching', 'trading', 'pending', 'failed', 'all'] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { live: 'Live trials', walk: 'Walk window', launching: 'Launching', trading: 'Trading', pending: 'Passed, market pending', failed: 'Failed and refunded', all: 'All' };
export const TAB_EMPTY: Record<Tab, string> = {
  live: 'No trial is open right now. Trials appear here a few blocks after a creator opens one.',
  walk: 'No launch is in its Walk window. Commits have closed on none of them.',
  launching: 'No instant launch is between token creation and an open pool.',
  trading: 'No token is trading on a Kruxa pool yet.',
  pending: 'No passed launch is waiting for its pool.',
  failed: 'No launch has failed yet.',
  all: 'The indexer has not read any launch yet.',
};

/** One indexer query per tab (OpenAPI 1.2.0 `tab`). The API tabs are exclusive: every launch is in exactly one. `pending` is the API's `passed` tab. */
export interface StreamQuery { tab?: string; has_market?: boolean }
const API_TAB: Record<Tab, string | undefined> = { live: 'live', walk: 'walk', launching: 'launching', trading: 'trading', pending: 'passed', failed: 'failed', all: undefined };
export const STREAMS: Record<Tab, StreamQuery[]> = Object.fromEntries(TABS.map((t) => [t, [{ tab: API_TAB[t] }]])) as Record<Tab, StreamQuery[]>;

export const SORTS = [
  { v: 'newest', l: 'Newest' }, { v: 'ending_soon', l: 'Ending soon' }, { v: 'raised', l: 'Most committed' }, { v: 'funders', l: 'Most backers' }, { v: 'volume_24h', l: 'Volume 24 h' },
] as const;


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
