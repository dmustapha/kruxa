'use client';
// Candlestick chart on Kruxa's own candles (GET /api/token/{id}/candles), TradingView Lightweight Charts 5.2.1 (Apache-2.0).
// The library draws to a canvas, so it is imported on the client only. The "TradingView" attribution logo stays on
// (layout.attributionLogo) and a text link is printed under the chart, as the licence NOTICE requires.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time, UTCTimestamp } from 'lightweight-charts';
import { MARKER_LABEL, type ChartMarker, type MarkerKind } from '@/lib/market/markers';
import { fmtCompact, fmtPrice, fmtUsd } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { StreamState } from '@/lib/market/stream';
import { INTERVALS, type Candle, type Interval } from '@/lib/market/types';
import { Panel, Skeleton, SectionError } from './shared';

interface Palette { fg: string; muted: string; line: string; up: string; down: string; bg: string }
function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { fg: v('--fg', '#e8eaed'), muted: v('--muted', '#8b93a1'), line: v('--line', '#232830'), up: v('--ok', '#7cf0c9'), down: v('--bad', '#ff6b6b'), bg: v('--bg', '#0b0d10') };
}
const withAlpha = (hex: string, a: number): string => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex);

interface Props {
  candles: Section<Candle[]>;
  interval: Interval;
  onInterval(i: Interval): void;
  stream: StreamState;
  onRetry(): void;
  symbol: string;
  /** Price (USDC per token) or market cap (price x total supply). The same series, rescaled. */
  mode: 'price' | 'mc';
  onMode(m: 'price' | 'mc'): void;
  /** Whole tokens; null when the API does not report total supply, which disables the market cap view. */
  supply: number | null;
  markers: ChartMarker[];
}
const fmtAxis = (mode: 'price' | 'mc') => (x: number): string => (mode === 'mc' ? `$${fmtCompact(x)}` : fmtPrice(x));
const MARK_STYLE: Record<MarkerKind, { shape: 'arrowDown' | 'circle' | 'square'; color: string }> = {
  creator_sell: { shape: 'arrowDown', color: '#ff8f85' }, creator_claim: { shape: 'circle', color: '#e6b450' }, stream_draw: { shape: 'square', color: '#8fb2ee' },
};

const LIVE_TEXT: Record<StreamState, string> = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', unsupported: 'Live updates unavailable' };

export function PriceChart({ candles, interval, onInterval, stream, onRetry, symbol, mode, onMode, supply, markers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const painted = useRef<{ key: string; n: number }>({ key: '', n: 0 });
  const [ready, setReady] = useState(false);
  const data = candles.status === 'ready' ? candles.data : null;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let mq: MediaQueryList | undefined;
    let onTheme: (() => void) | undefined;
    void import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, ColorType, createSeriesMarkers }) => {
      if (disposed || !host.current) return;
      const p = readPalette(el);
      const c = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: p.muted, attributionLogo: true, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 },
        grid: { vertLines: { color: withAlpha(p.line, 0.5) }, horzLines: { color: withAlpha(p.line, 0.5) } },
        rightPriceScale: { borderColor: p.line, scaleMargins: { top: 0.08, bottom: 0.25 } },
        timeScale: { borderColor: p.line, timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
        localization: { priceFormatter: (x: number) => fmtPrice(x) },
      });
      const s = c.addSeries(CandlestickSeries, {
        upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down,
        priceFormat: { type: 'custom', formatter: (x: number) => fmtPrice(x).replace('$', ''), minMove: 1e-10 },
      });
      const v = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', color: withAlpha(p.muted, 0.35), lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      chart.current = c; price.current = s; volume.current = v; markerApi.current = createSeriesMarkers(s, []);
      mq = window.matchMedia('(prefers-color-scheme: light)');
      onTheme = () => {
        const q = readPalette(el);
        c.applyOptions({ layout: { textColor: q.muted }, grid: { vertLines: { color: withAlpha(q.line, 0.5) }, horzLines: { color: withAlpha(q.line, 0.5) } }, rightPriceScale: { borderColor: q.line }, timeScale: { borderColor: q.line } });
        s.applyOptions({ upColor: q.up, downColor: q.down, borderUpColor: q.up, borderDownColor: q.down, wickUpColor: q.up, wickDownColor: q.down });
      };
      mq.addEventListener('change', onTheme);
      setReady(true);
    });
    return () => {
      disposed = true;
      if (mq && onTheme) mq.removeEventListener('change', onTheme);
      chart.current?.remove();
      chart.current = null; price.current = null; volume.current = null; markerApi.current = null; painted.current = { key: '', n: 0 };
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !data || !price.current || !volume.current) return;
    const k = mode === 'mc' && supply ? supply : 1;
    price.current.applyOptions({ priceFormat: { type: 'custom', formatter: (x: number) => (mode === 'mc' ? fmtCompact(x) : fmtPrice(x).replace('$', '')), minMove: mode === 'mc' ? 0.01 : 1e-10 } });
    chart.current?.applyOptions({ localization: { priceFormatter: fmtAxis(mode) } });
    const toBar = (c: Candle) => ({ time: c.t as UTCTimestamp, open: c.o * k, high: c.h * k, low: c.l * k, close: c.c * k });
    const toVol = (c: Candle) => ({ time: c.t as UTCTimestamp, value: c.v, color: withAlpha(c.c >= c.o ? readPalette(host.current!).up : readPalette(host.current!).down, 0.4) });
    const key = `${interval}:${mode}:${data[0]?.t ?? 0}`;
    const prev = painted.current;
    if (key !== prev.key || data.length < prev.n) {
      price.current.setData(data.map(toBar));
      volume.current.setData(data.map(toVol));
      chart.current?.timeScale().fitContent();
    } else {
      for (const c of data.slice(Math.max(0, prev.n - 1))) { price.current.update(toBar(c)); volume.current.update(toVol(c)); }
    }
    painted.current = { key, n: data.length };
  }, [data, interval, ready, mode, supply]);

  useEffect(() => {
    if (!ready || !markerApi.current) return;
    markerApi.current.setMarkers(markers.map((m) => ({ time: m.time as UTCTimestamp, position: m.position, shape: MARK_STYLE[m.kind].shape, color: MARK_STYLE[m.kind].color, text: m.text })));
  }, [markers, ready]);

  const last = data && data.length ? data[data.length - 1]! : null;
  const label = useMemo(() => (last ? `${symbol} price chart, ${interval} candles. Last close ${fmtPrice(last.c)} USDC, ${data!.length} candles.` : `${symbol} price chart, no candles yet.`), [last, symbol, interval, data]);

  return (
    <Panel title="Price" id="mkt-chart-h" right={<span className="mkt-live" data-state={stream} role="status"><span className="mkt-dot" aria-hidden="true" />{LIVE_TEXT[stream]}</span>}>
      <div className="mkt-chart-bar">
        <div className="mkt-seg" role="group" aria-label="Candle interval">
          {INTERVALS.map((i) => <button key={i} type="button" aria-pressed={interval === i} onClick={() => onInterval(i)}>{i}</button>)}
        </div>
        <div className="mkt-seg" role="group" aria-label="Chart value">
          <button type="button" aria-pressed={mode === 'price'} onClick={() => onMode('price')}>Price</button>
          <button type="button" aria-pressed={mode === 'mc'} disabled={!supply} onClick={() => onMode('mc')} title={supply ? undefined : 'Total supply is not reported by the API, so market cap is unknown.'}>Market cap</button>
        </div>
        {last && <span className="mkt-muted mkt-mono" style={{ fontSize: 12 }}>{(['O', 'H', 'L', 'C'] as const).map((l) => `${l} ${fmtAxis(mode)(last[l.toLowerCase() as 'o' | 'h' | 'l' | 'c'] * (mode === 'mc' && supply ? supply : 1))}`).join(' ')}</span>}
      </div>
      {candles.status === 'error' && <SectionError message={candles.message} onRetry={onRetry} />}
      <div className="mkt-chart" role="img" aria-label={label}>
        <div ref={host} style={{ position: 'absolute', inset: 0 }} />
        {candles.status === 'loading' && <div className="mkt-chart-empty"><Skeleton lines={4} height={28} /></div>}
        {data && data.length === 0 && <div className="mkt-chart-empty"><span>No trades have been indexed for this {interval} range yet, so there are no candles to draw.</span></div>}
      </div>
      {markers.length > 0 && (
        <p className="mkt-legend" aria-label="Chart markers">
          {([...new Set(markers.map((m) => m.kind))] as MarkerKind[]).map((k) => <span key={k}><span className="mkt-legend-key">{k === 'creator_sell' ? 'S' : k === 'creator_claim' ? 'C' : 'D'}</span> {MARKER_LABEL[k]}</span>)}
          <span className="mkt-muted"> Known creator accounts only, not wallets they may control.</span>
        </p>
      )}
      <p className="mkt-attrib">Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts</a> (Apache-2.0). Candles are Kruxa&apos;s own, built from this pool&apos;s swap events; volume is in USDC.</p>
      {data && data.length > 0 && (
        <details>
          <summary>View the latest candles as a table</summary>
          <div className="mkt-tablewrap">
            <table className="mkt-table">
              <caption className="mkt-sr">Latest {interval} candles</caption>
              <thead><tr><th scope="col">Start (UTC)</th><th scope="col" className="num">Open</th><th scope="col" className="num">High</th><th scope="col" className="num">Low</th><th scope="col" className="num">Close</th><th scope="col" className="num">Volume</th></tr></thead>
              <tbody>
                {data.slice(-10).reverse().map((c) => (
                  <tr key={c.t}><td>{new Date(c.t * 1000).toISOString().replace('T', ' ').slice(0, 16)}</td><td className="num">{fmtPrice(c.o)}</td><td className="num">{fmtPrice(c.h)}</td><td className="num">{fmtPrice(c.l)}</td><td className="num">{fmtPrice(c.c)}</td><td className="num">{fmtUsd(c.v)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Panel>
  );
}
