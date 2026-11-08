import { PHASE_LABEL, PHASE_TONE, type Phase } from '@/lib/market/phase';

const CLASS = { neutral: 'mkt-chip-chain', live: 'mkt-chip-ok', warn: 'mkt-chip-warn', ok: 'mkt-chip-ok', bad: 'mkt-chip-bad', muted: 'mkt-chip-unknown' } as const;

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={`mkt-chip ${CLASS[PHASE_TONE[phase]]}`} data-phase={phase}>{PHASE_LABEL[phase]}</span>;
}
