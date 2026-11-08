// Chart markers: creator-account sells, creator fee claims and stream draws. "Known creator accounts only": the creator and the payout
// recipient. Wallets they may control are not known to the indexer, and the legend says so.
import { INTERVAL_SECONDS, type CreatorClaim, type Interval, type Trade } from './types';

export type MarkerKind = 'creator_sell' | 'creator_claim' | 'stream_draw';
export interface ChartMarker { time: number; kind: MarkerKind; text: string; position: 'aboveBar' | 'belowBar'; label: string }

export const MARKER_LABEL: Record<MarkerKind, string> = { creator_sell: 'Creator account sold', creator_claim: 'Creator fee claim', stream_draw: 'Stream draw' };
const SHORT: Record<MarkerKind, string> = { creator_sell: 'S', creator_claim: 'C', stream_draw: 'D' };

export function buildMarkers(
  trades: Trade[], claims: CreatorClaim[], known: string[], interval: Interval, range: { from: number; to: number } | null,
): ChartMarker[] {
  if (!range) return [];
  const step = INTERVAL_SECONDS[interval];
  const bucket = (t: number) => Math.floor(t / step) * step;
  const inRange = (t: number) => t >= range.from - step && t <= range.to + step;
  const set = new Set(known);
  const out: ChartMarker[] = [];
  for (const t of trades) if (t.side === 'sell' && set.has(t.trader) && inRange(t.time)) out.push({ time: bucket(t.time), kind: 'creator_sell', text: SHORT.creator_sell, position: 'aboveBar', label: `${MARKER_LABEL.creator_sell}: ${t.trader}` });
  for (const c of claims) {
    if (!inRange(c.time)) continue;
    const kind: MarkerKind = c.kind === 'creator_claimed' ? 'creator_claim' : 'stream_draw';
    out.push({ time: bucket(c.time), kind, text: SHORT[kind], position: 'belowBar', label: MARKER_LABEL[kind] });
  }
  return out.sort((a, b) => a.time - b.time);
}
