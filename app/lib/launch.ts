// Pure helpers over launch summaries: the PASS margin, the phase line and the next deadline.
import type { LaunchSummary } from './api/types';

export interface Margin {
  /** total_active minus soft_cap, micro-USDC (signed). Null when the soft cap is not known. */
  usdc: bigint | null;
  /** funders minus min_funders. Null when unknown. */
  funders: number | null;
  /** True when both known margins are at or above zero. Null when neither is known. */
  clears: boolean | null;
}

export function marginOf(l: Pick<LaunchSummary, 'total_active' | 'soft_cap' | 'funders' | 'min_funders'>): Margin {
  const usdc = l.soft_cap ? BigInt(l.total_active) - BigInt(l.soft_cap) : null;
  const funders = l.min_funders !== null && l.min_funders !== undefined ? l.funders - l.min_funders : null;
  const known = [usdc !== null ? usdc >= 0n : null, funders !== null ? funders >= 0 : null].filter((x): x is boolean => x !== null);
  return { usdc, funders, clears: known.length ? known.every(Boolean) : null };
}

export const STAGE_LABEL: Record<string, string> = { new: 'New', open: 'Open', closing: 'Closing', passed: 'Passed', failed: 'Failed or refunded' };
export const STAGES = ['all', 'new', 'open', 'closing', 'passed', 'failed'] as const;
export type StageFilter = (typeof STAGES)[number];

/** The next clock event for a launch still in its trial, with a plain label. */
export function nextDeadline(l: Pick<LaunchSummary, 'status' | 'commit_end' | 'walk_end' | 'opens_at'>, now: number): { label: string; at: number } | null {
  if (l.status !== 'open') return null;
  if (l.opens_at && now < l.opens_at) return { label: 'Opens in', at: l.opens_at };
  if (l.commit_end && now < l.commit_end) return { label: 'Commits close in', at: l.commit_end };
  if (l.walk_end && now < l.walk_end) return { label: 'Walk closes in', at: l.walk_end };
  return null;
}

export function phaseText(stage: string, verdict?: string | null): string {
  if (stage === 'passed' || verdict === 'PASS') return 'Verdict PASS. Sale tokens can be claimed.';
  if (stage === 'failed' || verdict === 'FAIL') return 'Verdict FAIL or dissolved. Principal is refundable.';
  if (stage === 'closing') return 'Commits are closed or closing. Walk stays open until the tail ends: the book can only shrink.';
  if (stage === 'new') return 'Just opened. Commit and Walk are open.';
  return 'Open. Commit and Walk are open.';
}
