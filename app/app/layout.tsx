import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { WalletProvider } from '@/components/wallet';
import { SiteFooter, SiteHeader, StatusStrip } from '@/components/layouts/SiteChrome';
import { BottomTabs } from '@/components/layouts/BottomTabs';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? '';
export const metadata: Metadata = {
  ...(SITE ? { metadataBase: new URL(SITE) } : {}),
  title: { default: 'Kruxa', template: '%s | Kruxa' },
  description: 'A token launch that is a refundable trial first. The verdict is a rule anyone can recompute.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <WalletProvider>
          <StatusStrip />
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
          <BottomTabs />
        </WalletProvider>
      </body>
    </html>
  );
}
