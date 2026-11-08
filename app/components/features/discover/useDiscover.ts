'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api/client';
import type { AsOf, LaunchSummary, Source } from '@/lib/api/types';
import { STREAMS, TABS, compare, keepForTab, type Tab } from './streams';

export interface Counts { live?: number; walk?: number; trading?: number; pending?: number; failed?: number; all?: number }

/** Tab counts from `total` on limit=1 queries. Pending is passed minus trading (the API has no has_market=false filter). */
export function useTabCounts(q: string, mode: string | null): Counts {
  const [c, setC] = useState<Counts>({});
  useEffect(() => {
    let live = true;
    const total = (query: { stage?: string; has_market?: boolean }) => api.launches({ ...query, q: q || undefined, mode: mode || undefined, limit: 1 }).then((r) => r.total ?? 0);
    void Promise.all([total({ stage: 'new' }), total({ stage: 'open' }), total({ stage: 'closing' }), total({ stage: 'passed', has_market: true }), total({ stage: 'passed' }), total({ stage: 'failed' }), total({})])
      .then(([n, o, w, t, p, f, a]) => { if (live) setC({ live: n + o, walk: w, trading: t, pending: Math.max(0, p - t), failed: f, all: a }); }, () => { if (live) setC({}); });
    return () => { live = false; };
  }, [q, mode]);
  return c;
}

interface Stream { items: LaunchSummary[]; cursor: string | null }
export type FeedState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ok'; items: LaunchSummary[]; more: boolean; source?: Source; asOf?: AsOf };

export function useFeed(tab: Tab, q: string, sort: string, hasMarket: boolean, mode: string | null = null) {
  const [state, setState] = useState<FeedState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const streams = useRef<Stream[]>([]);
  const meta = useRef<{ source?: Source; asOf?: AsOf }>({});
  const seq = useRef(0);

  const publish = useCallback(() => {
    const seen = new Set<string>();
    const wantMode = (l: LaunchSummary): boolean => !mode || (l.mode ?? 'trial') === mode;
    const merged = streams.current.flatMap((s) => s.items).filter((l) => !seen.has(l.launch_id) && !!seen.add(l.launch_id)).filter(keepForTab(tab)).filter(wantMode).sort(compare(sort));
    setState({ status: 'ok', items: merged, more: streams.current.some((s) => s.cursor !== null), ...meta.current });
  }, [tab, sort, mode]);

  const fetchStreams = useCallback(async (append: boolean) => {
    const mine = ++seq.current;
    const defs = STREAMS[tab];
    const prev = append ? streams.current : defs.map(() => ({ items: [], cursor: null as string | null }));
    try {
      const out = await Promise.all(defs.map(async (d, i) => {
        const p = prev[i]!;
        if (append && p.cursor === null) return p;
        const r = await api.launches({ ...d, has_market: hasMarket ? true : d.has_market, q: q || undefined, mode: mode || undefined, sort: sort === 'newest' ? undefined : sort, limit: 24, cursor: append ? p.cursor ?? undefined : undefined });
        meta.current = { source: r.source, asOf: r.as_of };
        return { items: append ? [...p.items, ...r.items] : r.items, cursor: r.next_cursor };
      }));
      if (mine !== seq.current) return;
      streams.current = out;
      publish();
    } catch (e) {
      if (mine === seq.current) setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError('unreachable', 'Request failed.') });
    }
  }, [tab, q, sort, hasMarket, mode, publish]);

  useEffect(() => { setState({ status: 'loading' }); void fetchStreams(false); }, [fetchStreams]);
  const loadMore = useCallback(() => { setBusy(true); void fetchStreams(true).finally(() => setBusy(false)); }, [fetchStreams]);
  const reload = useCallback(() => { setState({ status: 'loading' }); void fetchStreams(false); }, [fetchStreams]);
  return { state, loadMore, busy, reload };
}

export const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);
