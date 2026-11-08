import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocRenderer } from '@/components/docs/DocRenderer';
import { DOC_PAGES, docBySlug, neighbours } from '@/content/docs';

export const dynamicParams = false;
export const generateStaticParams = () => DOC_PAGES.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = docBySlug((await params).slug);
  return p ? { title: `${p.title} | Kruxa docs`, description: p.summary } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) notFound();
  const { prev, next } = neighbours(slug);
  return (
    <>
      <h1>{page.title}</h1>
      <p className="kx-lede">{page.summary}</p>
      <DocRenderer blocks={page.blocks} />
      <div className="kx-pager">
        {prev ? <Link href={`/docs/${prev.slug}`}>Previous: {prev.title}</Link> : <span />}
        {next ? <Link href={`/docs/${next.slug}`}>Next: {next.title}</Link> : <span />}
      </div>
    </>
  );
}
