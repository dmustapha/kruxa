import { OG_SIZE, OG_TYPE, launchCard } from '@/lib/og';

export const alt = 'A Kruxa launch: its symbol, launch type, phase and margin to PASS';
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  return launchCard((await params).id);
}
