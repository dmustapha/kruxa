import { INSTANT_NOTICE_BODY, INSTANT_NOTICE_TITLE, MODE_LABEL, RISK_PAGE } from '@/lib/market/mode';
import type { LaunchMode } from '@/lib/market/types';

/** One of exactly two labels: Trial-verified or Instant (no trial). */
export function ModeBadge({ mode }: { mode: LaunchMode }) {
  return <span className={`mkt-chip ${mode === 'instant' ? 'mkt-chip-warn' : 'mkt-chip-chain'}`} data-mode={mode}>{MODE_LABEL[mode]}</span>;
}

/** Not dismissible. Says what an instant launch does not have. */
export function InstantNotice() {
  return (
    <aside className="mkt-instant-notice" role="note" aria-labelledby="mkt-instant-h">
      <strong id="mkt-instant-h">{INSTANT_NOTICE_TITLE}</strong>
      <span>{INSTANT_NOTICE_BODY} <a href={RISK_PAGE}>Read the risks</a></span>
    </aside>
  );
}
