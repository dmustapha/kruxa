import type { PhaseId } from '@/lib/phase';
import { PHASE_LABEL, PHASE_TONE } from '@/lib/phase';
import { Badge } from './Badges';

const TONE_CLASS = { muted: 'muted', open: 'open', warn: 'closing', pass: 'pass', fail: 'fail' } as const;

export function PhaseBadge({ phase }: { phase: PhaseId }) {
  return <Badge tone={TONE_CLASS[PHASE_TONE[phase]]}>{PHASE_LABEL[phase]}</Badge>;
}
