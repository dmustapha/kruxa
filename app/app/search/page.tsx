import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchView } from '@/components/features/search/SearchView';

export const metadata: Metadata = { title: 'Search', description: 'Search launches by symbol, creator account or launch number.' };
export default function SearchPage() { return <Suspense fallback={null}><SearchView /></Suspense>; }
