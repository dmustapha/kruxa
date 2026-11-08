// The one lifecycle vocabulary (APP-SPEC 2.4). Every card and page derives its badge here so nothing is derived twice.
import type { LaunchSummary } from './api/types';

export type PhaseId = 'SCHEDULED' | 'OPEN' | 'WALK_WINDOW' | 'AWAITING_SETTLE' | 'PASS' | 'TRADING' | 'FAIL' | 'DISSOLVED';
export type PhaseTone = 'muted' | 'open' | 'warn' | 'pass' | 'fail';

export const PHASE_LABEL: Record<PhaseId, string> = {
  SCHEDULED: 'Scheduled', OPEN: 'Open', WALK_WINDOW: 'Walk window', AWAITING_SETTLE: 'Awaiting settle', PASS: 'Pass', TRADING: 'Trading', FAIL: 'Fail, refunds open', DISSOLVED: 'Dissolved',
};
export const PHASE_TONE: Record<PhaseId, PhaseTone> = {
  SCHEDULED: 'muted', OPEN: 'open', WALK_WINDOW: 'warn', AWAITING_SETTLE: 'muted', PASS: 'pass', TRADING: 'pass', FAIL: 'fail', DISSOLVED: 'muted',
};

type PhaseInput = Pick<LaunchSummary, 'status' | 'stage' | 'verdict' | 'has_market' | 'opens_at' | 'walk_end' | 'phase'>;

/** Prefers the indexer's own `phase` (IR-A10) when it is one we know; otherwise derives it from status, stage and times. */
export function phaseOf(l: PhaseInput, now: number): PhaseId {
  const given = l.phase?.toUpperCase().replace(/ /g, '_');
  if (given && given in PHASE_LABEL) return given as PhaseId;
  if (l.status === 'dissolved') return 'DISSOLVED';
  if (l.verdict === 'FAIL' || l.status === 'failed' || l.status === 'creation_failed') return 'FAIL';
  if (l.verdict === 'PASS' || l.status === 'passed') return l.has_market ? 'TRADING' : 'PASS';
  if (l.opens_at && now < l.opens_at) return 'SCHEDULED';
  if (l.walk_end && now >= l.walk_end) return 'AWAITING_SETTLE';
  if (l.stage === 'closing') return 'WALK_WINDOW';
  return 'OPEN';
}

/** Where a card should send you: the trade view once there is a pool, the trial page otherwise. */
export const hrefFor = (l: Pick<LaunchSummary, 'launch_id'>, phase: PhaseId): string => (phase === 'TRADING' ? `/token/${l.launch_id}` : `/launch/${l.launch_id}`);
