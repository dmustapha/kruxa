import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs/DocsNav';
import { DraftBanner } from '@/components/docs/DraftBanner';
import { legalNav } from '@/content/legal';
import '@/components/docs/docs.css';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kx-docs">
      <DocsNav items={legalNav()} label="Legal (drafts)" />
      <article className="kx-article">
        <DraftBanner />
        {children}
      </article>
    </div>
  );
}
