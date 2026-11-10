import type { Metadata } from 'next';
import { StatusView } from '@/components/features/status/StatusView';

export const metadata: Metadata = { title: 'Status', description: 'Indexer health, NEAR RPC reachability and contract pause flags.' };
export default function StatusPage() { return <StatusView />; }
