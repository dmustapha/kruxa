import type { Metadata } from 'next';
import { TrialView } from '@/components/features/trial/TrialView';

export const metadata: Metadata = { title: 'Trial' };
export default function TrialPage() { return <TrialView />; }
