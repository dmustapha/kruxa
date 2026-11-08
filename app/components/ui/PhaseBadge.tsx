import type { PhaseId } from '@/lib/phase';
import { PHASE_LABEL, PHASE_TONE } from '@/lib/phase';
import { Badge } from './Badges';

const TONE_CLASS = { muted: 'muted', open: 'open', warn: 'closing', pass: 'pass', fail: 'fail' } as const;

export function PhaseBadge({ phase }: { phase: PhaseId }) {
  return <Badge tone={TONE_CLASS[PHASE_TONE[phase]]}>{PHASE_LABEL[phase]}</Badge>;
}

/** The only two launch-type badges. Trial-verified marks a launch that went through the refundable trial; Instant (no trial) marks one that did not. */
export function ModeBadge({ mode }: { mode?: 'trial' | 'instant' | null }) {
  return mode === 'instant'
    ? <Badge tone="warn" title="Launched instantly: no trial, no verdict, no Walk, no refund for buyers. Higher risk.">Instant (no trial)</Badge>
    : <Badge tone="source" title="This launch went through the refundable trial: a verdict anyone can recompute, and Walk before it.">Trial-verified</Badge>;
}
