import type { Metadata } from 'next';
import { OpsLogView } from '@/components/features/ops/OpsLogView';

export const metadata: Metadata = { title: 'Operations log', description: 'Every operator power in Kruxa, what bounds it, what is queued now, and what the contracts logged.' };
export default function OpsLogPage() { return <OpsLogView />; }
