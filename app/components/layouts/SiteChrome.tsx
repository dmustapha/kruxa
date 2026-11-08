'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NetworkBadge, WalletStatus } from '@/components/wallet';

const NAV = [
  { href: '/launches', label: 'Launches' },
  { href: '/create', label: 'Create' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/creator', label: 'Creator' },
];

/** The honesty strip sits on every page and links to /charter. The limits are above the fold, not in a footer. */
export function StatusStrip() {
  return (
    <div className="strip" role="region" aria-label="Status and limits">
      <div className="strip-in">
        <b>Testnet and devnet rehearsal</b>
        <span>No independent audit. One-person reserve in the demo. Unproven Intents legs are labelled.</span>
        <Link href="/charter">Read the limits</Link>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const path = usePathname() ?? '/';
  const current = (href: string): boolean => path === href || path.startsWith(href + '/');
  return (
    <header className="site-header">
      <div className="hdr-in">
        <Link href="/" className="brand" aria-label="Kruxa home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M7.5 12.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Kruxa
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={current(n.href) ? 'page' : undefined}>{n.label}</Link>)}
        </nav>
        <div className="hdr-wallet"><WalletStatus /></div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="in">
        <Link href="/charter">Charter and disclosures</Link>
        <span>Read-only until you press an action. Browsing and verifying never ask for a wallet.</span>
        <NetworkBadge />
      </div>
    </footer>
  );
}
