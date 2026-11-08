'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { HeadlinePlaceholder } from '../HeadlinePlaceholder';
import { LaunchCard } from '../LaunchCard';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, SkeletonCards } from '@/components/ui/States';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { ModeBadge, PhaseBadge } from '@/components/ui/PhaseBadge';
import { SourceBadge } from '@/components/ui/Badges';
import { VerdictMeters } from '@/components/ui/VerdictMeters';
import { useNow } from '@/lib/clock';
import { fmtUsdc } from '@/lib/config';
import { shortAccount } from '@/lib/format';
import { hrefFor, phaseOf } from '@/lib/phase';
import { SORTS, TABS, TAB_EMPTY, TAB_LABEL, type Tab } from './streams';
import { isTab, useFeed, useTabCounts } from './useDiscover';

const LS = { hero: 'kruxa.hero.collapsed', rules: 'kruxa.rules3.dismissed', view: 'kruxa.feed.view' };
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };

function Hero() {
  const [collapsed, setCollapsed] = useState(false);
  const [rules, setRules] = useState(true);
  useEffect(() => {
    const pref = read(LS.hero);
    setCollapsed(pref === null ? (window.matchMedia?.('(max-width: 719px)').matches ?? false) : pref === '1');
    setRules(read(LS.rules) !== '1');
  }, []);
  return (
    <section className="hero-strip" aria-labelledby="hero-h">
      <div className="grow">
        <p className="eyebrow">Refundable-trial launches for NEAR and Solana</p>
        <HeadlinePlaceholder id="hero-h" />
        {!collapsed && <p className="lede">Trial launches are refundable: walk before the verdict. Instant launches trade at once, with no trial.</p>}
      </div>
      <div className="row">
        <Link className="btn btn-primary" href="/create">Create a trial</Link>
        <Link className="btn" href="/docs/how-it-works">How it works</Link>
        <button type="button" className="btn-quiet" aria-expanded={!collapsed} onClick={() => { setCollapsed(!collapsed); write(LS.hero, collapsed ? '0' : '1'); }}>{collapsed ? 'Show intro' : 'Hide intro'}</button>
      </div>
      {!collapsed && rules && (
        <div style={{ flexBasis: '100%' }}>
          <ol className="rules3" aria-label="Three rules">
            <li>In a trial launch you can Walk until the deadline and get your principal back.</li>
            <li>A trial verdict is three public numbers anyone can recompute.</li>
            <li>An instant launch has no trial, no verdict and no refund.</li>
          </ol>
          <button type="button" className="btn-quiet" onClick={() => { setRules(false); write(LS.rules, '1'); }}>Got it</button>
        </div>
      )}
    </section>
  );
}

export function Discover() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'live';
  const sort = params.get('sort') ?? 'newest';
  const q = params.get('q') ?? '';
  const hasMarket = params.get('has_market') === 'true';
  const modeParam = params.get('mode');
  const mode = modeParam === 'trial' || modeParam === 'instant' ? modeParam : null;
  const [view, setView] = useState<'grid' | 'list'>('grid');
  useEffect(() => { if (read(LS.view) === 'list' || params.get('view') === 'list') setView('list'); }, [params]);

  const setParam = useCallback((k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v); else next.delete(k);
    router.replace(`${path}${next.size ? `?${next}` : ''}`, { scroll: false });
  }, [params, path, router]);

  const counts = useTabCounts(q, mode);
  const feed = useFeed(tab, q, sort, hasMarket, mode);
  const ok = feed.state.status === 'ok' ? feed.state : null;
  const now = useNow(ok?.source, ok?.asOf);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setParam('tab', next === 'live' ? null : next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <>
      <Hero />
      <div role="tablist" aria-label="Lifecycle" className="tabs">
        {TABS.map((t, i) => (
          <button key={t} id={`tab-${t}`} role="tab" type="button" className="tab" aria-selected={tab === t} aria-controls="feed" tabIndex={tab === t ? 0 : -1}
            onClick={() => setParam('tab', t === 'live' ? null : t)} onKeyDown={(e) => onTabKey(e, i)}>
            {TAB_LABEL[t]}<span className="cnt" aria-label={counts[t] !== undefined ? `${counts[t]} launches` : 'count unknown'}>{counts[t] ?? '-'}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <label className="sr-only" htmlFor="sort">Sort by</label>
        <select id="sort" value={sort} onChange={(e) => setParam('sort', e.target.value === 'newest' ? null : e.target.value)}>{SORTS.map((s) => <option key={s.v} value={s.v}>Sort: {s.l}</option>)}</select>
        <div className="seg" role="group" aria-label="Launch type">
          {([[null, 'All'], ['trial', 'Trial-verified'], ['instant', 'Instant']] as const).map(([m, label]) => (
            <button key={label} type="button" aria-pressed={mode === m} onClick={() => setParam('mode', m)}>{label}</button>
          ))}
        </div>
        {(tab === 'all' || tab === 'pending') && <label className="inline"><input type="checkbox" checked={hasMarket} onChange={(e) => setParam('has_market', e.target.checked ? 'true' : null)} /> Pool open</label>}
        <div className="toggle-view" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => { setView('grid'); write(LS.view, null); }}>Grid</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => { setView('list'); write(LS.view, 'list'); }}>List</button>
        </div>
        {q && <span className="chip">Search: {q}<button type="button" aria-label="Clear search" onClick={() => setParam('q', null)}>x</button></span>}
        {ok && <span style={{ marginLeft: 'auto' }}><Freshness source={ok.source} asOf={ok.asOf} /></span>}
      </div>

      <div id="feed" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-live="polite">
        {feed.state.status === 'loading' && <SkeletonCards />}
        {feed.state.status === 'error' && <ErrorState error={feed.state.error} what="launches" onRetry={feed.reload} />}
        {ok && ok.source === 'fixture' && <div className="callout"><p><b>Fixture data.</b> These launches come from the offline fixture generator, not a chain. Countdowns are frozen at the indexed time.</p></div>}
        {ok && ok.items.length === 0 && (
          <EmptyState title={q || hasMarket ? 'No launch matches these filters' : `Nothing in ${TAB_LABEL[tab]}`} action={tab === 'live' && !q ? <Link className="btn btn-primary" href="/create">Create a trial</Link> : q ? <button type="button" onClick={() => setParam('q', null)}>Clear search</button> : undefined}>
            {q ? 'Search covers symbol, creator account and launch number.' : TAB_EMPTY[tab]}
          </EmptyState>
        )}
        {ok && ok.items.length > 0 && view === 'grid' && <div className="grid grid-cards">{ok.items.map((l) => <LaunchCard key={l.launch_id} launch={l} now={now} frozenClock={l.source === 'fixture'} />)}</div>}
        {ok && ok.items.length > 0 && view === 'list' && (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Launch</th><th>Phase</th><th>Type</th><th>Margin</th><th className="n">Committed</th><th className="n">Backers</th><th>Source</th></tr></thead>
            <tbody>{ok.items.map((l) => {
              const phase = phaseOf(l, now);
              return (
                <tr key={l.launch_id}>
                  <td><span className="row" style={{ flexWrap: 'nowrap' }}><LaunchSigil id={l.launch_id} symbol={l.symbol} size={28} /><span><Link href={hrefFor(l, phase)}><b>${l.symbol}</b></Link><div className="hint">#{l.launch_id} {shortAccount(l.creator)}</div></span></span></td>
                  <td><PhaseBadge phase={phase} /></td><td><ModeBadge mode={l.mode} /></td><td style={{ minWidth: 200 }}>{l.mode === 'instant' ? <span className="hint">No verdict: instant launch</span> : <VerdictMeters l={l} />}</td>
                  <td className="n">{fmtUsdc(l.total_active)}</td><td className="n">{l.funders}</td><td><SourceBadge source={l.source} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {ok?.more && <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}><button type="button" disabled={feed.busy} onClick={feed.loadMore}>{feed.busy ? 'Loading' : 'Load more'}</button></div>}
      </div>
    </>
  );
}
