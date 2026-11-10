import { describe, expect, it } from 'vitest';
import type { PortfolioPosition } from './api/types';
import { groupOf, groupPositions } from './portfolio';

const pos = (status: PortfolioPosition['status'], over: Partial<PortfolioPosition['launch']> = {}, active = '0'): PortfolioPosition => ({
  launch: { launch_id: '1', symbol: 'A', creator: 'c.testnet', payout_recipient: 'c.testnet', status: 'open', stage: 'open', total_active: '0', funders: 0, source: 'chain', walk_end: 1000, ...over },
  contributed: '100', walked: '0', active, status,
});

describe('groupOf', () => {
  it('Walk available: an open trial with money still in it, until the Walk deadline', () => {
    expect(groupOf(pos('active', {}, '50'), 500)).toBe('walk');
    expect(groupOf(pos('active', { stage: 'closing' }, '50'), 500)).toBe('walk');
    expect(groupOf(pos('active', {}, '50'), 1000)).toBe('awaiting');
  });
  it('maps the other statuses to the action they need', () => {
    expect(groupOf(pos('refundable'), 0)).toBe('refund');
    expect(groupOf(pos('claimable'), 0)).toBe('tokens');
    expect(groupOf(pos('awaiting_settle'), 0)).toBe('awaiting');
    expect(groupOf(pos('market_only'), 0)).toBe('trading');
    expect(groupOf(pos('claimed'), 0)).toBe('closed');
    expect(groupOf(pos('walked'), 0)).toBe('closed');
  });
  it('an instant launch has no Walk: a held position is Trading', () => {
    expect(groupOf(pos('active', { mode: 'instant' }, '50'), 0)).toBe('trading');
  });
});

describe('groupPositions', () => {
  it('orders groups by the action needed and drops empty ones', () => {
    const g = groupPositions([pos('claimed'), pos('claimable'), pos('active', {}, '5'), pos('refundable')], 10);
    expect(g.map((x) => x.group)).toEqual(['walk', 'refund', 'tokens', 'closed']);
  });
});
