// Lifecycle vocabulary (APP-SPEC 2.4). Used by the badge and by the token-page state machine. IR-A10 asks the API for a computed
// `phase`; until it ships, this derives the same words from `status`, `stage`, `verdict`, `has_market` and the deadlines.
import { launchMode } from './mode';
import type { LaunchSummary, TokenPageData } from './types';

export type Phase = 'LAUNCHING' | 'LAUNCH_FAILED' | 'SCHEDULED' | 'OPEN' | 'WALK_WINDOW' | 'AWAITING_SETTLE' | 'PASS' | 'TRADING' | 'FAIL' | 'DISSOLVED' | 'UNKNOWN';
export const PHASE_LABEL: Record<Phase, string> = {
  LAUNCHING: 'Launching', LAUNCH_FAILED: 'Launch failed',
  SCHEDULED: 'Scheduled', OPEN: 'Open', WALK_WINDOW: 'Walk window', AWAITING_SETTLE: 'Awaiting settle', PASS: 'Passed', TRADING: 'Trading',
  FAIL: 'Failed, refunds open', DISSOLVED: 'Dissolved', UNKNOWN: 'Unknown',
};
export type PhaseTone = 'neutral' | 'live' | 'warn' | 'ok' | 'bad' | 'muted';
export const PHASE_TONE: Record<Phase, PhaseTone> = { LAUNCHING: 'neutral', LAUNCH_FAILED: 'bad', SCHEDULED: 'neutral', OPEN: 'live', WALK_WINDOW: 'warn', AWAITING_SETTLE: 'neutral', PASS: 'ok', TRADING: 'ok', FAIL: 'bad', DISSOLVED: 'muted', UNKNOWN: 'muted' };

const API_PHASES = new Set<string>(['SCHEDULED', 'OPEN', 'WALK_WINDOW', 'AWAITING_SETTLE', 'PASS', 'TRADING', 'FAIL', 'DISSOLVED']);

const INSTANT_FAILED = new Set(['creation_failed', 'abandoned', 'aborted', 'launch_failed']);

export function phaseOf(l: LaunchSummary, nowSec: number, poolOpen?: boolean): Phase {
  if (launchMode(l) === 'instant') {
    if (INSTANT_FAILED.has(l.status.toLowerCase())) return 'LAUNCH_FAILED';
    return poolOpen || l.has_market || l.status === 'trading' ? 'TRADING' : 'LAUNCHING';
  }
  if (l.phase && API_PHASES.has(l.phase)) return l.phase as Phase;
  if (l.status === 'dissolved') return 'DISSOLVED';
  if (l.verdict === 'FAIL' || l.status === 'creation_failed' || l.status === 'failed' || l.stage === 'failed') return 'FAIL';
  if (l.verdict === 'PASS' || l.status === 'passed' || l.stage === 'passed') return l.has_market ? 'TRADING' : 'PASS';
  if (l.status === 'open' || l.stage === 'new' || l.stage === 'open' || l.stage === 'closing') {
    if (l.opens_at && l.opens_at > nowSec) return 'SCHEDULED';
    if (l.walk_end && nowSec >= l.walk_end) return 'AWAITING_SETTLE';
    if (l.stage === 'closing') return 'WALK_WINDOW';
    return 'OPEN';
  }
  return 'UNKNOWN';
}

/** What the token page renders (APP-SPEC 5.5). `halted` keeps sells and claims open; only buys stop. */
export type TokenState = 'trial' | 'failed' | 'genesis' | 'launching' | 'trading' | 'halted';

export function tokenState(page: Pick<TokenPageData, 'launch' | 'pool'>, nowSec: number): TokenState {
  const phase = phaseOf(page.launch, nowSec, page.pool.open);
  if (phase === 'FAIL' || phase === 'DISSOLVED' || phase === 'LAUNCH_FAILED') return 'failed';
  if (page.pool.open) return page.pool.paused ? 'halted' : 'trading';
  if (phase === 'LAUNCHING') return 'launching';
  if (phase === 'PASS' || phase === 'TRADING') return 'genesis';
  return 'trial';
}
