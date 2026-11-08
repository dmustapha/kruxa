'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const icon = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const TABS = [
  { href: '/', label: 'Discover', d: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { href: '/create', label: 'Create', d: 'M12 5v14M5 12h14' },
  { href: '/portfolio', label: 'Portfolio', d: 'M3 7h18v13H3zM8 7V4h8v3' },
];
export const MORE = [
  { href: '/creator', label: 'Creator desk' }, { href: '/docs', label: 'Docs and help' }, { href: '/docs/faq', label: 'FAQ' }, { href: '/docs/security', label: 'Security and threat model' },
  { href: '/charter', label: 'Disclosures' }, { href: '/legal/terms', label: 'Terms' }, { href: '/legal/privacy', label: 'Privacy' }, { href: '/legal/risk', label: 'Risk disclosures' },
];

/** Pages that carry their own sticky action bar (trial and token): the tab bar steps aside so the thumb zone holds the action. */
export const hasOwnActionBar = (path: string): boolean => /^\/(launch|token)\/[^/]+\/?$/.test(path);

export function BottomTabs() {
  const path = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  if (hasOwnActionBar(path)) return null;
  const cur = (h: string): boolean => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  return (
    <>
      <nav className="tabbar" aria-label="Primary">
        {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={cur(t.href) ? 'page' : undefined}>{icon(t.d)}{t.label}</Link>)}
        <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{icon('M5 12h.01M12 12h.01M19 12h.01')}More</button>
      </nav>
      {open && (
        <>
          <div className="sheet-back" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
            <div className="row between"><h2 style={{ margin: 0, fontSize: '1.1rem' }}>More</h2><button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close menu">Close</button></div>
            <nav aria-label="More pages">{MORE.map((m) => <Link key={m.href} href={m.href} onClick={() => setOpen(false)}>{m.label}</Link>)}</nav>
          </div>
        </>
      )}
    </>
  );
}
