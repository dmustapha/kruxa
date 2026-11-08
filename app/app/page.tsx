import { Suspense } from 'react';
import { Discover } from '@/components/features/discover/Discover';

export default function Home() {
  return <Suspense fallback={null}><Discover /></Suspense>;
}
