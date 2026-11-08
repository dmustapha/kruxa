'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api/client';
import type { LaunchSummary } from '@/lib/api/types';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { PhaseBadge } from '@/components/ui/PhaseBadge';
import { phaseOf, hrefFor } from '@/lib/phase';
import { shortAccount } from '@/lib/format';

type State = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; items: LaunchSummary[] } | { status: 'error'; error: ApiError };

/** Header search: a combobox over GET /api/launches?q=&limit=8. `/` focuses it. Enter opens the top result or the full list. */
export function SearchBox() {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<State>({ status: 'idle' });
  const term = q.trim();

  useEffect(() => {
    if (!term) { setState({ status: 'idle' }); return; }
    setState({ status: 'loading' });
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.launches({ q: term.slice(0, 64), limit: 8 }).then(
        (r) => { if (!ctl.signal.aborted) { setState({ status: 'ok', items: r.items }); setActive(r.items.length ? 0 : -1); } },
        (e: unknown) => { if (!ctl.signal.aborted) setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError('unreachable', 'Search failed.') }); },
      );
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = state.status === 'ok' ? state.items : [];
  const go = (href: string) => { setOpen(false); setQ(''); router.push(href); };
  const optionId = (i: number) => `${id}-opt-${i}`;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && term) {
      e.preventDefault();
      const it = items[active];
      go(it ? hrefFor(it, phaseOf(it, Math.floor(Date.now() / 1000))) : `/?q=${encodeURIComponent(term)}`);
    }
  }

  return (
    <div className="hdr-search" role="search">
      <label htmlFor={`${id}-in`} className="sr-only">Search launches</label>
      <input ref={inputRef} id={`${id}-in`} type="search" role="combobox" aria-expanded={open && !!term} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined} placeholder="Search symbol, creator, number  ( / )" autoComplete="off" autoCapitalize="none" spellCheck={false}
        value={q} maxLength={64} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKeyDown} />
      {open && term && (
        <ul id={`${id}-list`} role="listbox" aria-label="Search results" className="sr-list">
          {state.status === 'loading' && <li className="sr-msg" role="presentation">Searching</li>}
          {state.status === 'error' && <li className="sr-msg" role="presentation">The data service did not answer. Nothing is guessed.</li>}
          {state.status === 'ok' && items.length === 0 && <li className="sr-msg" role="presentation">No launch matches. Search covers symbol, creator account and launch number.</li>}
          {items.map((l, i) => (
            <li key={l.launch_id} id={optionId(i)} role="option" aria-selected={i === active} className="sr-item" onMouseDown={(e) => { e.preventDefault(); go(hrefFor(l, phaseOf(l, Math.floor(Date.now() / 1000)))); }}>
              <LaunchSigil id={l.launch_id} symbol={l.symbol} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}><b>${l.symbol}</b> <span className="muted">#{l.launch_id} {shortAccount(l.creator)}</span></span>
              <PhaseBadge phase={phaseOf(l, Math.floor(Date.now() / 1000))} />
            </li>
          ))}
          {state.status === 'ok' && items.length > 0 && <li role="presentation"><a className="sr-msg" style={{ display: 'block' }} href={`/?q=${encodeURIComponent(term)}`} onMouseDown={(e) => { e.preventDefault(); go(`/?q=${encodeURIComponent(term)}`); }}>See all results</a></li>}
        </ul>
      )}
    </div>
  );
}
