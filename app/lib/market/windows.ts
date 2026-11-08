// DexScreener-style 5m / 1h / 6h / 24h stats. The API only has 24 h figures today (IR-A5). Until it ships `stats.windows`, these are
// derived from the swaps the UI already loaded, and a window is "unknown" when those swaps do not reach back to its start.
import { WINDOW_SECONDS, WINDOWS, type Trade, type WindowKey, type WindowStats } from './types';

export interface WindowRow extends WindowStats { key: WindowKey; basis: 'api' | 'swaps' | 'unknown'; buyVolume: number; sellVolume: number }

const quoteWhole = (t: Trade): number => Number(t.quote_amount ?? '0') / 1e6;

/** `trades` newest first (the API order). `nowSec` is the indexer's as-of time, not the browser clock. */
export function deriveWindow(trades: Trade[], nowSec: number, key: WindowKey, complete: boolean): WindowRow {
  const start = nowSec - WINDOW_SECONDS[key];
  const inside = trades.filter((t) => t.time > start && t.time <= nowSec);
  // The list reaches the window start if it holds a swap at or before it, or if the whole history is loaded.
  const oldest = trades.length ? trades[trades.length - 1]!.time : Infinity;
  const covers = complete || oldest <= start;
  if (!covers) return { key, basis: 'unknown', change_pct: null, buys: 0, sells: 0, buyVolume: 0, sellVolume: 0 };
  const buys = inside.filter((t) => t.side === 'buy');
  const sells = inside.filter((t) => t.side === 'sell');
  const before = trades.find((t) => t.time <= start);
  const first = inside.length ? inside[inside.length - 1]! : null;
  const ref = before?.price ?? first?.price ?? null;
  const last = inside.length ? inside[0]!.price : null;
  const change = ref !== null && last !== null && ref > 0 ? ((last - ref) / ref) * 100 : null;
  const bv = buys.reduce((s, t) => s + quoteWhole(t), 0);
  const sv = sells.reduce((s, t) => s + quoteWhole(t), 0);
  return { key, basis: 'swaps', change_pct: change, buys: buys.length, sells: sells.length, buyVolume: bv, sellVolume: sv, volume: bv + sv, unique_traders: new Set(inside.map((t) => t.trader)).size };
}

export function windowRows(api: Partial<Record<WindowKey, WindowStats>> | undefined, trades: Trade[], nowSec: number, complete: boolean): WindowRow[] {
  return WINDOWS.map((k) => {
    const a = api?.[k];
    if (a) return { key: k, basis: 'api' as const, ...a, buyVolume: a.buy_volume ?? 0, sellVolume: a.sell_volume ?? 0 };
    return deriveWindow(trades, nowSec, k, complete);
  });
}
