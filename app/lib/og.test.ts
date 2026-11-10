import { describe, expect, it } from 'vitest';
import type { LaunchSummary } from './api/types';
import { cardText } from './og';

const l = (over: Partial<LaunchSummary> = {}): LaunchSummary => ({
  launch_id: '3', symbol: 'CHARLIE', creator: 'c.testnet', payout_recipient: 'c.testnet', status: 'open', stage: 'open', opens_at: 100, commit_end: 5000, walk_end: 9000,
  total_active: '437000000', funders: 11, soft_cap: '350000000', min_funders: 10, verdict: null, source: 'chain', ...over,
});

describe('share card text', () => {
  it('a trial says refundable until the Walk deadline, the phase and the margin sentence', () => {
    const c = cardText(l(), '3', 200);
    expect(c).toMatchObject({ title: '$CHARLIE', phase: 'Open', line: 'Passing by $87 and 1 backer.' });
    expect(c.kind).toMatch(/refundable until the Walk deadline/);
  });
  it('an instant launch says no trial and no refund, and never a verdict', () => {
    const c = cardText(l({ mode: 'instant', stage: 'trading', has_market: true }), '1000000001', 200);
    expect(c.kind).toMatch(/no trial, no refund/);
    expect(c.line).toMatch(/No verdict/);
  });
  it('without live data it says so instead of guessing', () => {
    expect(cardText(null, '9', 1)).toEqual({ title: 'Launch #9', kind: 'Kruxa', phase: 'Live data unavailable', line: 'Open the page for the current state.' });
  });
  it('uses no dashes and no banned words', () => {
    for (const c of [cardText(l(), '3', 200), cardText(null, '3', 1)]) expect(Object.values(c).join(' ')).not.toMatch(/[\u2013\u2014]|\b(safe|audited|guaranteed|yield)\b/i);
  });
});
