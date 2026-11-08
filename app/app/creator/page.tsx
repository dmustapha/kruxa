import type { Metadata } from 'next';
import { CreatorView } from '@/components/features/creator/CreatorView';

export const metadata: Metadata = { title: 'Creator Desk' };
export default function CreatorPage() { return <CreatorView />; }
