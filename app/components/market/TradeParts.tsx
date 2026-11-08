'use client';
import { useId } from 'react';
import { fmtBps, fmtUnits } from '@/lib/market/format';
import { fmtOut, parseSlippagePct, type QuoteView, type Side } from '@/lib/market/quote';

const PRESETS = ['0.5', '1', '3'];

export function SlippageControl({ value, onChange }: { value: string; onChange(v: string): void }) {
  const id = useId();
  const bad = value !== '' && parseSlippagePct(value) === null;
  return (
    <div className="mkt-field">
      <div className="mkt-label"><label htmlFor={id}>Max slippage</label><span>sets min_out</span></div>
      <div className="mkt-quick" style={{ marginTop: 0 }}>
        {PRESETS.map((p) => <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>{p}%</button>)}
        <span className="mkt-inputwrap" style={{ flex: 1, minWidth: 96 }}>
          <input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-err` : undefined} style={{ fontSize: 14, minHeight: 44 }} />
          <span className="mkt-unit">%</span>
        </span>
      </div>
      {bad && <p id={`${id}-err`} className="mkt-error" role="alert">Use 0.1 to 50 percent, up to 2 decimals.</p>}
    </div>
  );
}

export function QuoteSummary({ side, view, openingNote }: { side: Side; view: QuoteView; openingNote: string | null }) {
  if (view.status === 'empty') return <p className="mkt-note" style={{ margin: '0 0 12px' }}>Enter an amount to see the exact result, the fee and your minimum.</p>;
  if (view.status === 'invalid') return <p className="mkt-error" role="alert" style={{ margin: '0 0 12px' }}>{view.reason}</p>;
  if (view.status === 'unavailable') return <div className="mkt-alert" data-tone="warn" role="status"><strong>No quote</strong>{view.reason}</div>;
  const q = view.quote;
  const rate = `${fmtBps(q.feeBps)}`;
  return (
    <dl className="mkt-quote" aria-live="polite" aria-label="Quote preview">
      <div className="mkt-strong"><dt>{side === 'buy' ? 'You receive (est.)' : 'You receive (est.)'}</dt><dd>{fmtOut(side, view.expectedOut)}</dd></div>
      <div><dt>Minimum accepted (min_out)</dt><dd>{fmtOut(side, view.minOut)}</dd></div>
      <div><dt>Price impact</dt><dd className={view.highImpact ? 'mkt-warn' : undefined}>{view.highImpact ? '! ' : ''}{(q.priceImpactBps / 100).toFixed(2)}%</dd></div>
      <div><dt>Fee paid in USDC</dt><dd>${fmtUnits(q.fee.total, 6, 4)} ({rate})</dd></div>
      {openingNote && <div><dt>Opening fee</dt><dd>{openingNote}</dd></div>}
    </dl>
  );
}
