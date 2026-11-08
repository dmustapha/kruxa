'use client';
// Tabs under the chart. Desktop: Trades, Holders, Mechanics, Creator, Verify. Mobile: Trades, Holders, Info, Verify (Info stacks the rest).
import { useId, type ReactNode } from 'react';

export interface TabDef { id: string; label: string; body: ReactNode }

export function Tabs({ tabs, active, onChange, label }: { tabs: TabDef[]; active: string; onChange(id: string): void; label: string }) {
  const uid = useId();
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const move = (i: number) => { const t = tabs[(i + tabs.length) % tabs.length]!; onChange(t.id); document.getElementById(`${uid}-${t.id}`)?.focus(); };
  return (
    <div className="mkt-tabsx">
      <div role="tablist" aria-label={label} className="mkt-tablist">
        {tabs.map((t, i) => (
          <button key={t.id} type="button" role="tab" id={`${uid}-${t.id}`} aria-selected={t.id === current.id} aria-controls={`${uid}-panel`} tabIndex={t.id === current.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); } else if (e.key === 'Home') { e.preventDefault(); move(0); } else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1); } }}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${current.id}`} className="mkt-tabbody">{current.body}</div>
    </div>
  );
}
