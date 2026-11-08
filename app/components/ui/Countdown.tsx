import { fmtDuration } from '@/lib/format';

/** Presentational: the caller owns the clock (see lib/clock.ts), so fixture data never counts against the wall clock. */
export function Countdown({ label, at, now, frozen }: { label: string; at: number; now: number; frozen?: boolean }) {
  return (
    <span className="num">
      {label} <b>{fmtDuration(at - now)}</b>
      {frozen && <span className="muted"> (fixture clock, frozen at the indexed time)</span>}
    </span>
  );
}
