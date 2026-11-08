import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyView } from '@/components/features/trial/VerifyView';
import { isInstantId } from '@/lib/instant/preview';

export const metadata: Metadata = { title: 'Verify a launch' };

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isInstantId(id)) {
    return (
      <>
        <header className="page-head"><p className="eyebrow">Launch #{id} · verification</p><h1>An instant launch has no verdict to recompute.</h1></header>
        <div className="callout"><p>There was no trial, so there is no verdict, no margin and no Walk to check. What can be read is the launcher&apos;s own record of the supply, the seed and the allocation schedule on the <Link href={`/launch/${id}`}>launch page</Link>.</p></div>
      </>
    );
  }
  return <VerifyView />;
}
