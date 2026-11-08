// Pure helpers that keep the candle series, trade list and header in step with SSE events.
import { INTERVAL_SECONDS, type Candle, type Interval, type Trade } from './types';

/** Insert or replace a candle keyed by bucket start. Keeps ascending order and returns a new array. */
export function upsertCandle(series: Candle[], c: Candle): Candle[] {
  const last = series[series.length - 1];
  if (!last || c.t > last.t) return [...series, c];
  const i = series.findIndex((x) => x.t === c.t);
  if (i === -1) return [...series, c].sort((a, b) => a.t - b.t);
  const next = series.slice();
  next[i] = c;
  return next;
}

/**
 * Fold one trade into the candle of `interval`. The SSE stream sends 1m candles; for other intervals the open candle is
 * extended from the trade itself so the chart moves without a refetch.
 */
export function applyTradeToSeries(series: Candle[], trade: Trade, interval: Interval): Candle[] {
  const step = INTERVAL_SECONDS[interval];
  const bucket = Math.floor(trade.time / step) * step;
  const quoteWhole = Number(trade.quote_amount ?? '0') / 1e6;
  const existing = series.find((x) => x.t === bucket);
  if (!existing) {
    const prevClose = series.length ? series[series.length - 1]!.c : trade.price;
    return upsertCandle(series, { t: bucket, o: prevClose, h: Math.max(prevClose, trade.price), l: Math.min(prevClose, trade.price), c: trade.price, v: quoteWhole, n: 1, source: trade.source });
  }
  return upsertCandle(series, { ...existing, h: Math.max(existing.h, trade.price), l: Math.min(existing.l, trade.price), c: trade.price, v: existing.v + quoteWhole, n: (existing.n ?? 0) + 1, filled: false });
}

/** Prepend a new trade, dropping a duplicate receipt, bounded length. */
export function prependTrade(list: Trade[], t: Trade, max = 50): Trade[] {
  if (list.some((x) => x.receipt_id === t.receipt_id && x.time === t.time && x.side === t.side && x.trader === t.trader)) return list;
  return [t, ...list].slice(0, max);
}
