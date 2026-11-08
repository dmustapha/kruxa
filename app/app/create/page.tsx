import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CreateRoot } from '@/components/features/create/CreateRoot';

export const metadata: Metadata = { title: 'Create' };

export default function CreatePage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Studio</p>
        <h1>Open a trial, or watch a hostile one get refused.</h1>
        <p className="lede">Choose how to launch. Every rule code appears before any signature. This page works with no wallet; you connect only when you press a step.</p>
      </header>
      <Suspense fallback={null}><CreateRoot /></Suspense>
    </>
  );
}
