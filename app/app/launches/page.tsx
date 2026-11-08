import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LaunchesFeed } from '@/components/features/LaunchesFeed';

export const metadata: Metadata = { title: 'Launches' };

export default function LaunchesPage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Verdict board</p>
        <h1>Every launch, including the ones that failed.</h1>
        <p className="lede">Failed and refunded launches stay visible. Each card shows how far the live inputs are from the PASS line, and whether the numbers came from a NEAR block or from the offline fixture.</p>
      </header>
      <Suspense fallback={null}><LaunchesFeed /></Suspense>
    </>
  );
}
