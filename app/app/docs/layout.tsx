import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs/DocsNav';
import { docNav } from '@/content/docs';
import '@/components/docs/docs.css';

export default function DocsLayout({ children }: { children: ReactNode }) {
  const items = [{ href: '/docs', title: 'Docs home', group: 'Start' as const }, ...docNav()];
  return (
    <div className="kx-docs">
      <DocsNav items={items} label="Documentation" />
      <article className="kx-article">{children}</article>
    </div>
  );
}
