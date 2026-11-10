'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import type { LaunchList } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { useNow } from '@/lib/clock';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/States';
import { LaunchCard } from '../LaunchCard';

/** Full search results (APP-SPEC 4.2). The header box handles quick jumps; this page lists everything the indexer matches. */
export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const q = (params.get('q') ?? '').trim().slice(0, 64);
  const [draft, setDraft] = useState(q);
  const s = useApi<LaunchList>(q ? () => api.launches({ q, limit: 24 }) : null, `search-${q}`);
  const ok = s.status === 'ok' ? s.data : null;
  const now = useNow(ok?.source, ok?.as_of);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Search</p>
        <h1>{q ? `Results for "${q}"` : 'Search launches'}</h1>
        <p className="lede">Search covers symbol, creator account and launch number.</p>
      </header>
      <form role="search" className="row" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); router.replace(t ? `${path}?q=${encodeURIComponent(t)}` : path); }}>
        <label htmlFor="search-q" className="sr-only">Search launches</label>
        <input id="search-q" type="search" maxLength={64} style={{ flex: '1 1 260px', width: 'auto' }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="symbol, creator, number" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <button type="submit" disabled={!draft.trim()}>Search</button>
      </form>
      <div aria-live="polite" style={{ marginTop: 16 }}>
        {!q && <EmptyState title="Type something to search">Try a symbol such as ALPHA, a creator account, or a launch number.</EmptyState>}
        {s.status === 'loading' && <SkeletonCards n={3} />}
        {s.status === 'error' && <ErrorState error={s.error} what="search results" onRetry={s.reload} />}
        {ok && (
          <>
            <div style={{ margin: '0 0 12px' }}><Freshness source={ok.source} asOf={ok.as_of} /></div>
            {ok.items.length === 0
              ? <EmptyState title="No launch matches.">Search covers symbol, creator account and launch number.</EmptyState>
              : <>
                  <p className="hint">{ok.total ?? ok.items.length} match{(ok.total ?? ok.items.length) === 1 ? '' : 'es'}{ok.next_cursor ? `, showing the first ${ok.items.length}` : ''}.</p>
                  <div className="grid grid-cards">{ok.items.map((l) => <LaunchCard key={l.launch_id} launch={l} now={now} frozenClock={l.source === 'fixture'} />)}</div>
                </>}
          </>
        )}
      </div>
    </>
  );
}
