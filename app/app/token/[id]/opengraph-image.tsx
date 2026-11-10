import { OG_SIZE, OG_TYPE, launchCard } from '@/lib/og';

export const alt = 'A Kruxa token: its symbol, launch type and phase';
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  return launchCard((await params).id);
}
