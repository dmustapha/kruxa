import Link from 'next/link';
import { DOC_PAGES } from '@/content/docs';

export const metadata = { title: 'Docs | Kruxa', description: 'How Kruxa trials, the Walk, the verdict and the fees work, and how to check them yourself.' };

export default function DocsHome() {
  return (
    <>
      <h1>Kruxa docs</h1>
      <p className="kx-lede">
        Plain language first, the correct term second. Every number on these pages comes from the contract rules or a
        project document, and anything unproven is labelled.
      </p>
      <aside className="kx-note kx-note-warn" role="note">
        <strong>Read this first</strong>
        <p>
          Kruxa has had no independent audit. Launches are capped at $1,000 each and $3,000 in total. Tokens can lose
          all of their value. See <Link href="/docs/security">Security and trust</Link> and{' '}
          <Link href="/legal/risk">Risk disclosure (draft)</Link>.
        </p>
      </aside>
      <div className="kx-cards">
        {DOC_PAGES.map((p) => (
          <Link key={p.slug} href={`/docs/${p.slug}`}>
            <strong>{p.title}</strong>
            <span>{p.summary}</span>
          </Link>
        ))}
        <Link href="/legal/terms"><strong>Legal (drafts)</strong><span>Terms, privacy and risk pages, clearly marked as drafts for the owner to complete.</span></Link>
      </div>
    </>
  );
}
