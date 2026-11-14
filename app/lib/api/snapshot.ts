// Degrade-to-snapshot mode. services/api/src/snapshot.ts bakes the feed, each launch page and each token page to static JSON that mirrors the
// API paths. Put that output under app/public/snapshot/ and the app serves it, labelled RECORDED, when the indexer cannot be reached.
// With NEXT_PUBLIC_SNAPSHOT_BASE_URL set the same files are read from that remote base first (GitHub Pages, baked by .github/workflows/snapshot.yml).
// Only a fixed set of read paths has a snapshot; anything else still fails honestly. Nothing here is fabricated: a missing file is a miss.
import { useSyncExternalStore } from 'react';
import { CONFIG } from '../config';

export const SNAPSHOT_BASE = '/snapshot';

type Q = Record<string, string | number | boolean | undefined | null> | URLSearchParams;
const get = (q: Q | undefined, k: string): string | null => {
  if (!q) return null;
  const v = q instanceof URLSearchParams ? q.get(k) : q[k];
  return v === undefined || v === null || v === '' ? null : String(v);
};

const INTERVALS = ['1m', '5m', '1h', '1d'];
const OPS_PAGES = ['status', 'upgrades', 'halts', 'force-resolves', 'solvency', 'owed'];
const OPS_SCOPES = ['core', 'market', 'launcher'];
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;

/** The query a caller meant: the one passed alongside plus any `?a=b` written into the path string (the token page does that). */
function mergedQuery(path: string, query?: Q): URLSearchParams {
  const merged = new URLSearchParams(path.split('?')[1] ?? '');
  const extra = query instanceof URLSearchParams ? Object.fromEntries(query) : (query ?? {});
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') merged.set(k, String(v));
  return merged;
}

/** The baked page for a per-account read, or null for an id that could not have been baked. */
function accountFile(kind: 'creator' | 'portfolio', raw: string): string | null {
  let account: string;
  try { account = decodeURIComponent(raw).replace(/^near:/, ''); } catch { return null; }
  return ACCOUNT.test(account) ? `/api/${kind}/${account}.json` : null;
}

/** The static file that stands in for an API read, or null when no snapshot exists for that path. `base` is the snapshot root (local or remote). */
export function snapshotFile(path: string, query?: Q, base: string = SNAPSHOT_BASE): string | null {
  const rel = snapshotRelative(path.split('?')[0]!, mergedQuery(path, query));
  return rel === null ? null : `${base}${rel}`;
}

/** Only the unfiltered log and the three scope views are baked; a cursor or any other filter is a miss. */
function opsLogFile(q: URLSearchParams): string | null {
  if (q.has('before') || q.has('category') || q.has('launch_id')) return null;
  const scope = q.get('scope');
  if (scope === null) return '/api/ops-log.json';
  return OPS_SCOPES.includes(scope) ? `/api/ops-log-${scope}.json` : null;
}

function snapshotRelative(clean: string, q: URLSearchParams): string | null {
  if (clean === '/api/health' || clean === '/api/launches' || clean === '/api/stats') return `${clean}.json`;
  if (clean === '/api/ops-log') return opsLogFile(q);
  const ops = /^\/api\/ops\/([a-z-]+)$/.exec(clean);
  if (ops) return OPS_PAGES.includes(ops[1]!) ? `${clean}.json` : null;
  if (/^\/api\/(launch|token|verify)\/[0-9]+$/.test(clean) || /^\/api\/launch\/[0-9]+\/(custody|genesis)$/.test(clean) || /^\/api\/token\/[0-9]+\/depth$/.test(clean)) return `${clean}.json`;
  const list = /^\/api\/token\/([0-9]+)\/(trades|holders)$/.exec(clean);
  if (list) return q.has('before') || q.has('trader') ? null : `${clean}.json`;
  const candles = /^\/api\/token\/([0-9]+)\/candles$/.exec(clean);
  if (candles) return INTERVALS.includes(q.get('interval') ?? '1m') && !q.has('from') && !q.has('to') && !q.has('fill') ? `/api/token/${candles[1]}/candles-${q.get('interval') ?? '1m'}.json` : null;
  const person = /^\/api\/(creator|portfolio)\/([^/]+)$/.exec(clean);
  return person ? accountFile(person[1] as 'creator' | 'portfolio', person[2]!) : null;
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

/** Where recorded files are looked up, in order: the remote snapshot when NEXT_PUBLIC_SNAPSHOT_BASE_URL is set, then the app's own /snapshot. */
export const snapshotBases = (remote: string = CONFIG.snapshotBase): string[] => (remote ? [remote, SNAPSHOT_BASE] : [SNAPSHOT_BASE]);

/** A recorded page holds more rows than one request asked for and cannot be paged; cut lists to the asked limit and drop the cursor. */
function shape(path: string, body: Record<string, unknown>, query?: Q): Record<string, unknown> {
  const clean = path.split('?')[0]!;
  if (clean === '/api/launches') return filterFeed(body as never, query) as never;
  const limit = Number(mergedQuery(path, query).get('limit'));
  const items = body.items;
  if (/\/(trades|holders)$/.test(clean) && Array.isArray(items) && Number.isFinite(limit) && limit > 0) return { ...body, items: items.slice(0, limit), next_cursor: null };
  return 'next_cursor' in body ? { ...body, next_cursor: null } : body;
}

/** Fetches the recorded file for an API read. Returns null on any miss so the caller keeps its original, honest error. */
export async function readSnapshot(path: string, query?: Q, f: typeof fetch = fetch, bases: string[] = snapshotBases()): Promise<unknown | null> {
  for (const base of bases) {
    const file = snapshotFile(path, query, base);
    if (!file) return null;
    const body = await fetchRecorded(file, base !== SNAPSHOT_BASE, f);
    if (body === null) continue;
    const shaped = shape(path, body, query);
    const asOf = shaped.as_of as { block_time?: number | null } | undefined;
    markSnapshotServed(asOf?.block_time ?? null);
    return shaped;
  }
  return null;
}

async function fetchRecorded(file: string, remote: boolean, f: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    // A remote snapshot is republished every few minutes; revalidate instead of trusting a cached copy for the host's max-age.
    const res = await f(file, { headers: { accept: 'application/json' }, ...(remote ? { cache: 'no-cache' as const } : {}) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch { return null; }
}
