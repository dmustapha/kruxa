'use client';
// Candlestick chart on Kruxa's own candles (GET /api/token/{id}/candles), TradingView Lightweight Charts 5.2.1 (Apache-2.0).
// The library draws to a canvas, so it is imported on the client only. The "TradingView" attribution logo stays on
// (layout.attributionLogo) and a text link is printed under the chart, as the licence NOTICE requires.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { fmtPrice, fmtUsd } from '@/lib/market/format';
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
}

const LIVE_TEXT: Record<StreamState, string> = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', unsupported: 'Live updates unavailable' };

export function PriceChart({ candles, interval, onInterval, stream, onRetry, symbol }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const painted = useRef<{ key: string; n: number }>({ key: '', n: 0 });
  const [ready, setReady] = useState(false);
  const data = candles.status === 'ready' ? candles.data : null;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let mq: MediaQueryList | undefined;
    let onTheme: (() => void) | undefined;
    void import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
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
      const v = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', color: withAlpha(p.muted, 0.35) });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      chart.current = c; price.current = s; volume.current = v;
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
      chart.current = null; price.current = null; volume.current = null; painted.current = { key: '', n: 0 };
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !data || !price.current || !volume.current) return;
    const toBar = (c: Candle) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });
    const toVol = (c: Candle) => ({ time: c.t as UTCTimestamp, value: c.v, color: withAlpha(c.c >= c.o ? readPalette(host.current!).up : readPalette(host.current!).down, 0.4) });
    const key = `${interval}:${data[0]?.t ?? 0}`;
    const prev = painted.current;
    if (key !== prev.key || data.length < prev.n) {
      price.current.setData(data.map(toBar));
      volume.current.setData(data.map(toVol));
      chart.current?.timeScale().fitContent();
    } else {
      for (const c of data.slice(Math.max(0, prev.n - 1))) { price.current.update(toBar(c)); volume.current.update(toVol(c)); }
    }
    painted.current = { key, n: data.length };
  }, [data, interval, ready]);

  const last = data && data.length ? data[data.length - 1]! : null;
  const label = useMemo(() => (last ? `${symbol} price chart, ${interval} candles. Last close ${fmtPrice(last.c)} USDC, ${data!.length} candles.` : `${symbol} price chart, no candles yet.`), [last, symbol, interval, data]);

  return (
    <Panel title="Price" id="mkt-chart-h" right={<span className="mkt-live" data-state={stream} role="status"><span className="mkt-dot" aria-hidden="true" />{LIVE_TEXT[stream]}</span>}>
      <div className="mkt-chart-bar">
        <div className="mkt-seg" role="group" aria-label="Candle interval">
          {INTERVALS.map((i) => <button key={i} type="button" aria-pressed={interval === i} onClick={() => onInterval(i)}>{i}</button>)}
        </div>
        {last && <span className="mkt-muted mkt-mono" style={{ fontSize: 12 }}>O {fmtPrice(last.o)} H {fmtPrice(last.h)} L {fmtPrice(last.l)} C {fmtPrice(last.c)}</span>}
      </div>
      {candles.status === 'error' && <SectionError message={candles.message} onRetry={onRetry} />}
      <div className="mkt-chart" role="img" aria-label={label}>
        <div ref={host} style={{ position: 'absolute', inset: 0 }} />
        {candles.status === 'loading' && <div className="mkt-chart-empty"><Skeleton lines={4} height={28} /></div>}
        {data && data.length === 0 && <div className="mkt-chart-empty"><span>No trades have been indexed for this {interval} range yet, so there are no candles to draw.</span></div>}
      </div>
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
