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

const dollars = (micro: bigint): string => {
  const abs = micro < 0n ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `$${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
};
const backers = (n: number): string => `${n} ${n === 1 ? 'backer' : 'backers'}`;

/** The margin to the PASS line as one plain sentence. Equality passes (the verdict uses >=), so zero margin clears. */
export function marginSentence(l: Pick<LaunchSummary, 'total_active' | 'soft_cap' | 'funders' | 'min_funders' | 'verdict'>): string {
  const m = marginOf(l);
  if (m.clears === null) return 'Terms not indexed, so no margin is shown.';
  const settled = l.verdict === 'PASS' ? 'Passed by' : 'Passing by';
  if (l.verdict === 'FAIL') {
    const parts = [m.usdc !== null && m.usdc < 0n ? dollars(-m.usdc) : null, m.funders !== null && m.funders < 0 ? backers(-m.funders) : null].filter(Boolean);
    return parts.length ? `Failed: short by ${parts.join(' and ')}.` : 'Failed.';
  }
  if (m.clears) {
    if ((m.usdc ?? 0n) === 0n && (m.funders ?? 0) === 0) return 'Right at the line (equality passes).';
    const parts = [m.usdc !== null ? dollars(m.usdc) : null, m.funders !== null ? backers(m.funders) : null].filter(Boolean);
    return `${settled} ${parts.join(' and ')}.`;
  }
  const need = [
    m.usdc !== null && m.usdc < 0n ? dollars(-m.usdc) : null,
    m.funders !== null && m.funders < 0 ? `${-m.funders} more ${-m.funders === 1 ? 'backer' : 'backers'}` : null,
  ].filter(Boolean);
  return `Needs ${need.join(' and ')}.`;
}
