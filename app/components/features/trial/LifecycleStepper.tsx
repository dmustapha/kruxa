import type { EventRef } from '@/lib/api/types';
import type { PhaseId } from '@/lib/phase';
import { fmtDate } from '@/lib/format';

const STEPS = [
  { id: 'scheduled', label: 'Scheduled', ev: null }, { id: 'open', label: 'Open', ev: 'trial_opened' }, { id: 'walk', label: 'Walk window', ev: null },
  { id: 'settle', label: 'Settle', ev: null }, { id: 'verdict', label: 'Verdict', ev: 'verdict' }, { id: 'genesis', label: 'Genesis on Solana', ev: null }, { id: 'trading', label: 'Trading', ev: 'pool_opened' },
] as const;

const CURRENT: Record<PhaseId, number> = { SCHEDULED: 0, OPEN: 1, WALK_WINDOW: 2, AWAITING_SETTLE: 3, PASS: 5, TRADING: 6, FAIL: 4, DISSOLVED: 4, LAUNCHING: 1, LAUNCH_FAILED: 4 };

export function LifecycleStepper({ phase, events, deadline }: { phase: PhaseId; events?: EventRef[]; deadline?: string }) {
  const cur = CURRENT[phase];
  const failed = phase === 'FAIL' || phase === 'DISSOLVED';
  return (
    <ol className="stepper" aria-label="Lifecycle">
      {STEPS.map((s, i) => {
        const ev = s.ev ? events?.find((e) => e.event === s.ev) : undefined;
        const state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
        const skipped = failed && i > 4;
        return (
          <li key={s.id} className={`st st-${skipped ? 'skip' : state}${failed && i === 4 ? ' st-fail' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="st-dot" aria-hidden="true" />
            <span className="st-label">{failed && i === 4 ? (phase === 'FAIL' ? 'Verdict: FAIL' : 'Dissolved') : s.label}</span>
            <span className="st-sub">{state === 'current' && deadline ? deadline : ev?.time ? fmtDate(ev.time) : skipped ? 'not reached' : ''}</span>
            {ev && <span className="st-sub mono" title={ev.receipt_id}>receipt {ev.receipt_id.slice(0, 8)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
