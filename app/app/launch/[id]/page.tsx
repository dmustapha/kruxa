import type { Metadata } from 'next';
import { InstantLaunchView } from '@/components/features/instant/InstantLaunchView';
import { TrialView } from '@/components/features/trial/TrialView';
import { isInstantId } from '@/lib/instant/preview';

export const metadata: Metadata = { title: 'Launch' };

/** Instant launches use ids at or above 1,000,000,000 (INSTANT-ABI); everything below is a trial. */
export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return isInstantId(id) ? <InstantLaunchView /> : <TrialView />;
}
