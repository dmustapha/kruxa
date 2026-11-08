import { notFound } from 'next/navigation';
import { TokenView } from '@/components/market/index';

export const metadata = { title: 'Token | Kruxa', description: 'Price, candles, trades and the buy and sell panel for a Kruxa launch.' };

// Launch ids are u64 decimals (api.openapi.yaml). Anything else is a 404 before any request is made.
export default async function TokenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,20}$/.test(id)) notFound();
  return <TokenView id={id} />;
}
