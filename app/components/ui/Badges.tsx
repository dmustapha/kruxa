import type { ReactNode } from 'react';
import type { LaunchStatus, Source, Stage } from '@/lib/api/types';

export function Badge({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return <span className={`badge b-${tone}`} title={title}>{children}</span>;
}

/** Labels where a number came from. Fixture numbers must always say so (indexer API convention). */
export function SourceBadge({ source }: { source: Source | undefined }) {
  if (!source) return null;
  return source === 'fixture'
    ? <Badge tone="fixture" title="Every number here came from the offline fixture generator, not from a NEAR block.">Fixture data</Badge>
    : <Badge tone="chain" title="Every contributing event came from a NEAR block.">Chain data</Badge>;
}

const STAGE_TONE: Record<Stage, string> = { new: 'new', open: 'open', closing: 'closing', passed: 'pass', failed: 'fail' };
export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONE[stage]}>{stage === 'failed' ? 'Failed' : stage}</Badge>;
}

export function VerdictBadge({ verdict, status }: { verdict?: 'PASS' | 'FAIL' | null; status?: LaunchStatus }) {
  if (verdict) return <Badge tone={verdict === 'PASS' ? 'pass' : 'fail'}>{verdict}</Badge>;
  if (status === 'dissolved' || status === 'creation_failed') return <Badge tone="fail">{status === 'dissolved' ? 'Dissolved' : 'Creation failed'}</Badge>;
  return <Badge tone="muted">No verdict yet</Badge>;
}

export function ProofBadge({ status }: { status: 'PROVEN' | 'SOURCE-READ' | 'UNPROVEN' | 'RECORDED' | 'DRY QUOTE' | 'UNPROVEN PATH' }) {
  const tone = status === 'PROVEN' ? 'proven' : status === 'SOURCE-READ' ? 'source' : status === 'RECORDED' || status === 'DRY QUOTE' ? 'recorded' : 'unproven';
  return <Badge tone={tone}>{status}</Badge>;
}
