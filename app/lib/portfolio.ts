// Portfolio grouping (APP-SPEC 4.7): cards ordered by the action each one needs first. Pure, so it is tested without a DOM.
import type { PortfolioPosition } from './api/types';

export type PositionGroup = 'walk' | 'refund' | 'tokens' | 'awaiting' | 'trading' | 'closed';

export const GROUP_ORDER: PositionGroup[] = ['walk', 'refund', 'tokens', 'awaiting', 'trading', 'closed'];
export const GROUP_TITLE: Record<PositionGroup, string> = {
  walk: 'Walk available', refund: 'Refund to claim', tokens: 'Tokens to claim', awaiting: 'Awaiting verdict', trading: 'Trading', closed: 'Closed',
};
export const GROUP_HINT: Record<PositionGroup, string> = {
  walk: 'The trial is open and you still have money in it. You can leave with your principal until the Walk deadline.',
  refund: 'The trial failed or you walked. Claim the refund.',
  tokens: 'The trial passed. Claim your tokens.',
  awaiting: 'Commits are closed or the Walk window is running. The verdict is not final yet.',
  trading: 'You hold tokens that trade on a Kruxa pool.',
  closed: 'Nothing left to do here.',
};

/** Walk is possible from the first commit until the Walk deadline, so a closing trial still counts. */
const canWalk = (p: PortfolioPosition, now: number): boolean => p.launch.mode !== 'instant' && p.launch.status === 'open' && (p.launch.walk_end == null || now < p.launch.walk_end);
const active = (p: PortfolioPosition): boolean => BigInt(p.active ?? '0') > 0n;

/** The one group a position belongs to. The first matching rule wins. */
export function groupOf(p: PortfolioPosition, now: number = Math.floor(Date.now() / 1000)): PositionGroup {
  if (p.status === 'refundable') return 'refund';
  if (p.status === 'claimable') return 'tokens';
  if (p.status === 'market_only') return 'trading';
  if (p.status === 'awaiting_settle') return 'awaiting';
  if (p.status === 'active') {
    if (p.launch.mode === 'instant') return 'trading';
    if (canWalk(p, now) && active(p)) return 'walk';
    if (p.launch.status === 'open') return 'awaiting';
    return 'closed';
  }
  return 'closed';
}

export function groupPositions(positions: PortfolioPosition[], now: number = Math.floor(Date.now() / 1000)): { group: PositionGroup; items: PortfolioPosition[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: positions.filter((p) => groupOf(p, now) === group) })).filter((g) => g.items.length > 0);
}
