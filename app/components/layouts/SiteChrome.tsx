'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NetworkBadge, WalletStatus } from '@/components/wallet';
import { SearchBox } from './SearchBox';

const NAV = [
  { href: '/', label: 'Discover' }, { href: '/create', label: 'Create' }, { href: '/portfolio', label: 'Portfolio' },
  { href: '/creator', label: 'Creator' }, { href: '/docs', label: 'Docs' },
];

const MAINTENANCE = process.env.NEXT_PUBLIC_MAINTENANCE ?? '';

/** One line on every page: the network and the limits. A maintenance message turns it amber and says the contracts still decide. */
export function StatusStrip() {
  return (
    <div className="strip" role="region" aria-label="Status and limits">
      <div className="strip-in">
        {MAINTENANCE
          ? <><b>Maintenance</b><span>{MAINTENANCE} Contracts, not this site, decide every action.</span></>
          : <><b>Testnet and devnet rehearsal</b><span>No independent audit. Unproven paths are labelled.</span></>}
        <Link href="/charter">Read the limits</Link>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const path = usePathname() ?? '/';
  const current = (href: string): boolean => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
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
        <SearchBox />
      </div>
    </header>
  );
}

const FOOT = [
  { href: '/docs', label: 'Docs' }, { href: '/docs/faq', label: 'FAQ' }, { href: '/docs/security', label: 'Security' }, { href: '/charter', label: 'Disclosures' },
  { href: '/legal/terms', label: 'Terms' }, { href: '/legal/privacy', label: 'Privacy' }, { href: '/legal/risk', label: 'Risk' }, { href: '/docs/api', label: 'API' },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="in">
        <nav aria-label="Footer" className="row" style={{ gap: '0 16px' }}>{FOOT.map((f) => <Link key={f.href} href={f.href} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{f.label}</Link>)}</nav>
        <span>Charts by TradingView Lightweight Charts. Browsing and verifying never ask for a wallet.</span>
        <NetworkBadge />
      </div>
    </footer>
  );
}
