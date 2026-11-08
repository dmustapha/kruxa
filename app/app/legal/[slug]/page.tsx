import { notFound } from 'next/navigation';
import { DocRenderer } from '@/components/docs/DocRenderer';
import { LEGAL_PAGES, legalBySlug } from '@/content/legal';

export const dynamicParams = false;
export const generateStaticParams = () => LEGAL_PAGES.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = legalBySlug((await params).slug);
  return p ? { title: `${p.title} | Kruxa`, description: p.summary } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = legalBySlug((await params).slug);
  if (!page) notFound();
  return (
    <>
      <h1>{page.title}</h1>
      <p className="kx-lede">{page.summary}</p>
      <DocRenderer blocks={page.blocks} />
    </>
  );
}
