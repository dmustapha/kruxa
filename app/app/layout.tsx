import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'Kruxa', description: 'A token launch that is a refundable trial first. Verdict by rule, refunds by pull.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Kruxa</Link>
          <Link href="/create">Create a trial</Link>
          <Link href="/demo">Verify (no wallet)</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
