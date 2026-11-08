'use client';
// DexScreener-style rail: 5M / 1H / 6H / 24H tabs, price change, and buys-vs-sells bars (count and USDC volume).
import { useId, useState } from 'react';
import { fmtPct, fmtUsd } from '@/lib/market/format';
import type { WindowRow } from '@/lib/market/windows';
import { WINDOWS, type WindowKey } from '@/lib/market/types';
import { Panel } from './shared';

const LABEL: Record<WindowKey, string> = { '5m': '5M', '1h': '1H', '6h': '6H', '24h': '24H' };

function Split({ label, buys, sells, fmt }: { label: string; buys: number; sells: number; fmt(n: number): string }) {
  const total = buys + sells;
  const pct = total > 0 ? (buys / total) * 100 : 50;
  return (
    <div className="mkt-split">
      <div className="mkt-split-top"><span>{label}</span><span className="mkt-mono">{fmt(buys + sells)}</span></div>
      <span className="mkt-splitbar" role="img" aria-label={`${label}: buys ${fmt(buys)}, sells ${fmt(sells)}`}>
        <span className="mkt-splitbar-buy" style={{ width: `${pct}%` }} /><span className="mkt-splitbar-sell" style={{ width: `${100 - pct}%` }} />
      </span>
      <div className="mkt-split-bot"><span className="mkt-up">Buys {fmt(buys)}</span><span className="mkt-down">Sells {fmt(sells)}</span></div>
    </div>
  );
}

export function StatsRail({ rows, partial }: { rows: WindowRow[]; partial: boolean }) {
  const [key, setKey] = useState<WindowKey>('24h');
  const id = useId();
  const row = rows.find((r) => r.key === key)!;
  const known = row.basis !== 'unknown';
  const up = (row.change_pct ?? 0) > 0; const down = (row.change_pct ?? 0) < 0;
  return (
    <Panel title="Activity" id="mkt-stats-h">
      <div role="tablist" aria-label="Time window" className="mkt-wintabs">
        {WINDOWS.map((k) => {
          const r = rows.find((x) => x.key === k)!;
          return (
            <button key={k} type="button" role="tab" id={`${id}-${k}`} aria-selected={key === k} aria-controls={`${id}-panel`} tabIndex={key === k ? 0 : -1}
              onClick={() => setKey(k)}
              onKeyDown={(e) => { const i = WINDOWS.indexOf(k); const n = e.key === 'ArrowRight' ? WINDOWS[(i + 1) % 4] : e.key === 'ArrowLeft' ? WINDOWS[(i + 3) % 4] : null; if (n) { setKey(n); document.getElementById(`${id}-${n}`)?.focus(); } }}>
              <span>{LABEL[k]}</span>
              <span className={`mkt-mono ${(r.change_pct ?? 0) > 0 ? 'mkt-up' : (r.change_pct ?? 0) < 0 ? 'mkt-down' : 'mkt-muted'}`}>{fmtPct(r.change_pct)}</span>
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${key}`}>
        {!known ? (
          <p className="mkt-note">Unknown for {LABEL[key]}: the swaps loaded do not reach back that far, and the API does not report this window yet.</p>
        ) : (
          <>
            <p className={`mkt-winchg ${up ? 'mkt-up' : down ? 'mkt-down' : 'mkt-muted'}`}><span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>{fmtPct(row.change_pct)}<span className="mkt-sr"> price change over {LABEL[key]}</span></p>
            <Split label="Transactions" buys={row.buys} sells={row.sells} fmt={(n) => String(Math.round(n))} />
            <Split label="Volume" buys={row.buyVolume} sells={row.sellVolume} fmt={(n) => fmtUsd(n)} />
            {row.unique_traders !== undefined && <p className="mkt-note">{row.unique_traders} distinct traders in this window.</p>}
          </>
        )}
      </div>
      <p className="mkt-note">{rows.some((r) => r.basis === 'api') ? 'From the indexer.' : `Derived from the latest swaps the page loaded${partial ? ' (older swaps are not included)' : ''}, as of the indexer's last block. Not an API statistic yet.`}</p>
    </Panel>
  );
}
