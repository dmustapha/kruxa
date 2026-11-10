// Degrade-to-snapshot mode. services/api/src/snapshot.ts bakes the feed, each launch page and each token page to static JSON that mirrors the
// API paths. Put that output under app/public/snapshot/ and the app serves it, labelled RECORDED, when the indexer cannot be reached.
// Only a fixed set of read paths has a snapshot; anything else still fails honestly. Nothing here is fabricated: a missing file is a miss.
import { useSyncExternalStore } from 'react';

export const SNAPSHOT_BASE = '/snapshot';

type Q = Record<string, string | number | boolean | undefined | null> | URLSearchParams;
const get = (q: Q | undefined, k: string): string | null => {
  if (!q) return null;
  const v = q instanceof URLSearchParams ? q.get(k) : q[k];
  return v === undefined || v === null || v === '' ? null : String(v);
};

/** The static file that stands in for an API read, or null when no snapshot exists for that path. */
export function snapshotFile(path: string, query?: Q): string | null {
  const clean = path.split('?')[0]!;
  if (clean === '/api/health' || clean === '/api/launches') return `${SNAPSHOT_BASE}${clean}.json`;
  if (/^\/api\/launch\/[^/]+$/.test(clean) || /^\/api\/token\/[^/]+$/.test(clean)) return `${SNAPSHOT_BASE}${clean}.json`;
  const candles = /^\/api\/token\/([^/]+)\/candles$/.exec(clean);
  if (candles && (get(query, 'interval') ?? '1h') === '1h') return `${SNAPSHOT_BASE}/api/token/${candles[1]}/candles-1h.json`;
  return null;
}

interface FeedItem { launch_id: string; symbol: string; creator: string; stage: string; mode?: string | null; has_market?: boolean; verdict?: string | null }
const TAB_TEST: Record<string, (l: FeedItem) => boolean> = {
  live: (l) => l.mode !== 'instant' && (l.stage === 'new' || l.stage === 'open'),
  walk: (l) => l.stage === 'closing',
  launching: (l) => l.mode === 'instant' && !l.has_market,
  trading: (l) => !!l.has_market,
  passed: (l) => l.stage === 'passed' && !l.has_market,
  failed: (l) => l.stage === 'failed' || l.verdict === 'FAIL',
};

/** The recorded feed holds every launch; apply the same filters the live API would, as far as the recorded fields allow. */
export function filterFeed<T extends { items: FeedItem[]; total?: number; next_cursor?: string | null }>(body: T, query?: Q): T {
  let items = body.items;
  const q = get(query, 'q')?.toLowerCase();
  if (q) items = items.filter((l) => l.symbol.toLowerCase().includes(q) || l.creator.toLowerCase().includes(q) || l.launch_id === q);
  const creator = get(query, 'creator');
  if (creator) items = items.filter((l) => l.creator === creator);
  const tab = get(query, 'tab');
  if (tab && TAB_TEST[tab]) items = items.filter(TAB_TEST[tab]!);
  const type = get(query, 'launch_type') ?? get(query, 'mode');
  if (type === 'trial' || type === 'instant') items = items.filter((l) => (l.mode ?? 'trial') === type);
  const total = items.length;
  const limit = Number(get(query, 'limit') ?? 24);
  return { ...body, items: items.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 24), total, next_cursor: null };
}

// ---- which reads were served from a snapshot (drives the RECORDED strip) ----
let served: { at: number | null } | null = null;
const listeners = new Set<() => void>();
export function markSnapshotServed(blockTime: number | null): void {
  if (served && served.at === blockTime) return;
  served = { at: blockTime };
  listeners.forEach((l) => l());
}
export function snapshotServed(): { at: number | null } | null { return served; }
export function resetSnapshotServed(): void { served = null; listeners.forEach((l) => l()); }
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSnapshotServed = (): { at: number | null } | null => useSyncExternalStore(subscribe, snapshotServed, () => null);

/** Fetches the recorded file for an API read. Returns null on any miss so the caller keeps its original, honest error. */
export async function readSnapshot(path: string, query?: Q, f: typeof fetch = fetch): Promise<unknown | null> {
  const file = snapshotFile(path, query);
  if (!file) return null;
  try {
    const res = await f(file, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    let body = (await res.json()) as Record<string, unknown>;
    if (path.split('?')[0] === '/api/launches') body = filterFeed(body as never, query) as never;
    const asOf = body.as_of as { block_time?: number | null } | undefined;
    markSnapshotServed(asOf?.block_time ?? null);
    return body;
  } catch { return null; }
}
