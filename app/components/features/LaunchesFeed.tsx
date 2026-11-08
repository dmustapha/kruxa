'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api/client';
import type { AsOf, LaunchSummary, Source } from '@/lib/api/types';
import { useNow } from '@/lib/clock';
import { STAGES, STAGE_LABEL, type StageFilter } from '@/lib/launch';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/States';
import { LaunchCard } from './LaunchCard';

const SORTS = [
  { v: 'newest', l: 'Newest' }, { v: 'raised', l: 'Most committed' }, { v: 'funders', l: 'Most backers' },
  { v: 'ending_soon', l: 'Ending soon' }, { v: 'volume_24h', l: 'Volume 24 h' },
] as const;

interface Page { items: LaunchSummary[]; cursor: string | null; total?: number; asOf?: AsOf; source?: Source }
type Load = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ok' };

export function LaunchesFeed() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const stage = (STAGES.includes(params.get('stage') as StageFilter) ? params.get('stage') : 'all') as StageFilter;
  const sort = params.get('sort') ?? 'newest';
  const urlQ = params.get('q') ?? '';
  const hasMarket = params.get('has_market') === 'true';
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState<Page>({ items: [], cursor: null });
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const setParam = useCallback((k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v); else next.delete(k);
    router.replace(`${path}${next.size ? `?${next}` : ''}`, { scroll: false });
  }, [params, path, router]);

  useEffect(() => { const t = setTimeout(() => { if (q !== urlQ) setParam('q', q.trim() || null); }, 300); return () => clearTimeout(t); }, [q, urlQ, setParam]);

  const fetchPage = useCallback((cursor?: string) => {
    const mine = ++seq.current;
    return api.launches({ stage: stage === 'all' ? undefined : stage, q: urlQ || undefined, sort, has_market: hasMarket || undefined, limit: 24, cursor }).then(
      (r) => { if (mine === seq.current) { setPage((p) => ({ items: cursor ? [...p.items, ...r.items] : r.items, cursor: r.next_cursor, total: r.total, asOf: r.as_of, source: r.source })); setLoad({ status: 'ok' }); } },
      (e: unknown) => { if (mine === seq.current) setLoad({ status: 'error', error: e instanceof ApiError ? e : new ApiError('unreachable', 'Request failed.') }); },
    );
  }, [stage, urlQ, sort, hasMarket]);

  useEffect(() => { setLoad({ status: 'loading' }); void fetchPage(); }, [fetchPage]);
  const now = useNow(page.source, page.asOf);
  const filtered = stage !== 'all' || urlQ !== '' || hasMarket;

  return (
    <div>
      <form className="card" role="search" aria-label="Filter launches" onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <label htmlFor="q" style={{ marginTop: 0 }}>Search symbol, creator or launch number</label>
            <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ALPHA, alice.testnet, 3" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="sort" style={{ marginTop: 0 }}>Sort</label>
            <select id="sort" value={sort} onChange={(e) => setParam('sort', e.target.value === 'newest' ? null : e.target.value)}>
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
        </div>
        <div className="row between" style={{ marginTop: 12 }}>
          <div className="seg" role="group" aria-label="Stage">
            {STAGES.map((s) => <button key={s} type="button" aria-pressed={stage === s} onClick={() => setParam('stage', s === 'all' ? null : s)}>{s === 'all' ? 'All' : STAGE_LABEL[s]}</button>)}
          </div>
          <label className="inline"><input type="checkbox" checked={hasMarket} onChange={(e) => setParam('has_market', e.target.checked ? 'true' : null)} /> Pool open</label>
        </div>
      </form>

      <div className="row between" style={{ margin: '16px 0' }} aria-live="polite">
        <span className="muted num">{load.status === 'ok' ? `${page.total ?? page.items.length} launch${(page.total ?? page.items.length) === 1 ? '' : 'es'}` : ' '}</span>
        {load.status === 'ok' && <Freshness source={page.source} asOf={page.asOf} />}
      </div>

      {load.status === 'loading' && <SkeletonCards />}
      {load.status === 'error' && <ErrorState error={load.error} what="launches" onRetry={() => { setLoad({ status: 'loading' }); void fetchPage(); }} />}
      {load.status === 'ok' && page.items.length === 0 && (
        filtered
          ? <EmptyState title="No launch matches these filters" action={<button type="button" onClick={() => { setQ(''); router.replace(path); }}>Clear filters</button>}>Failed and passed launches are included when the stage is All.</EmptyState>
          : <EmptyState title="No launches indexed yet">When a creator opens a trial it appears here within a few blocks. Nothing is shown that the indexer has not read from events.</EmptyState>
      )}
      {load.status === 'ok' && page.items.length > 0 && (
        <>
          <div className="grid grid-cards">{page.items.map((l) => <LaunchCard key={l.launch_id} launch={l} now={now} frozenClock={l.source === 'fixture'} />)}</div>
          {page.cursor && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
              <button type="button" disabled={more} onClick={() => { setMore(true); void fetchPage(page.cursor ?? undefined).finally(() => setMore(false)); }}>{more ? 'Loading' : 'Load more'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
