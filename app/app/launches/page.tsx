import { redirect } from 'next/navigation';

// The feed moved to `/`. Old query parameters carry over; the old `stage` filter maps to the nearest lifecycle tab.
const TAB: Record<string, string> = { new: 'live', open: 'live', closing: 'walk', passed: 'trading', failed: 'failed' };

export default async function Launches({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (!val) continue;
    if (k === 'stage') { const t = TAB[val]; if (t && t !== 'live') out.set('tab', t); else if (val === 'all') out.set('tab', 'all'); } else out.set(k, val);
  }
  redirect(`/${out.size ? `?${out}` : ''}`);
}
