import type { Metadata } from 'next';
import { VerifyView } from '@/components/features/trial/VerifyView';

export const metadata: Metadata = { title: 'Verify a launch' };
export default function VerifyPage() { return <VerifyView />; }
