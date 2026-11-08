import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CreateStudio } from '@/components/features/create/CreateStudio';

export const metadata: Metadata = { title: 'Create a trial' };

export default function CreatePage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Studio</p>
        <h1>Open a trial, or watch a hostile one get refused.</h1>
        <p className="lede">Pick a preset and edit it. Every rule code appears before any signature. This page works with no wallet; you connect only when you press Create.</p>
      </header>
      <Suspense fallback={null}><CreateStudio /></Suspense>
    </>
  );
}
