// Share cards (Open Graph images) for a launch and a token. Rendered on the server by next/og. They state facts only: the symbol, the launch
// type, the phase and the margin sentence. If the indexer cannot be reached the card says "Launch #id" and nothing else; it never guesses.
import { ImageResponse } from 'next/og';
import type { LaunchSummary } from './api/types';
import { CONFIG } from './config';
import { marginSentence } from './launch';
import { PHASE_LABEL, phaseOf } from './phase';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = 'image/png';

/** What the card says, as data (tested): no network, no JSX. */
export function cardText(l: LaunchSummary | null, id: string, now: number): { title: string; kind: string; phase: string; line: string } {
  if (!l) return { title: `Launch #${id}`, kind: 'Kruxa', phase: 'Live data unavailable', line: 'Open the page for the current state.' };
  const instant = l.mode === 'instant';
  return {
    title: `$${l.symbol}`,
    kind: instant ? 'Instant launch, no trial, no refund' : 'Trial launch, refundable until the Walk deadline',
    phase: PHASE_LABEL[phaseOf(l, now)],
    line: instant ? 'No verdict and no Walk. Higher risk.' : marginSentence(l),
  };
}

async function loadLaunch(id: string): Promise<LaunchSummary | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(`${CONFIG.api}/api/launch/${encodeURIComponent(id)}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    clearTimeout(t);
    return res.ok ? ((await res.json()) as LaunchSummary) : null;
  } catch { return null; }
}

export async function launchCard(id: string): Promise<ImageResponse> {
  const l = /^[0-9]{1,20}$/.test(id) ? await loadLaunch(id) : null;
  const c = cardText(l, id, Math.floor(Date.now() / 1000));
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0e100f', color: '#ece9df', padding: 64 }}>
        <div style={{ display: 'flex', fontSize: 30, color: '#6fe3b5' }}>Kruxa</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 112, fontWeight: 700 }}>{c.title}</div>
          <div style={{ display: 'flex', fontSize: 38, color: '#a29d90', marginTop: 8 }}>{c.kind}</div>
          <div style={{ display: 'flex', fontSize: 44, marginTop: 32 }}>{c.phase}</div>
          <div style={{ display: 'flex', fontSize: 34, color: '#a29d90', marginTop: 8 }}>{c.line}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#e6b450' }}>Testnet rehearsal. No independent audit. Not investment advice.</div>
      </div>
    ),
    OG_SIZE,
  );
}
