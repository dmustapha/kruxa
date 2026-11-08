import { describe, expect, it } from 'vitest';
import { hrefFor, phaseOf } from './phase';
import { marginSentence } from './launch';

const base = { status: 'open' as const, stage: 'open' as const, verdict: null, has_market: false, opens_at: 100, walk_end: 300 };
describe('phaseOf (APP-SPEC 2.4)', () => {
  it('walks the trial', () => {
    expect(phaseOf(base, 50)).toBe('SCHEDULED');
    expect(phaseOf(base, 150)).toBe('OPEN');
    expect(phaseOf({ ...base, stage: 'closing' }, 250)).toBe('WALK_WINDOW');
    expect(phaseOf({ ...base, stage: 'closing' }, 300)).toBe('AWAITING_SETTLE');
  });
  it('settled states', () => {
    expect(phaseOf({ ...base, status: 'passed', stage: 'passed', verdict: 'PASS' }, 999)).toBe('PASS');
    expect(phaseOf({ ...base, status: 'passed', stage: 'passed', verdict: 'PASS', has_market: true }, 999)).toBe('TRADING');
    expect(phaseOf({ ...base, status: 'failed', stage: 'failed', verdict: 'FAIL' }, 999)).toBe('FAIL');
    expect(phaseOf({ ...base, status: 'creation_failed', stage: 'failed' }, 999)).toBe('FAIL');
    expect(phaseOf({ ...base, status: 'dissolved', stage: 'failed' }, 999)).toBe('DISSOLVED');
  });
  it('uses the indexer phase when it is known, ignores unknown ones', () => {
    expect(phaseOf({ ...base, phase: 'walk_window' }, 150)).toBe('WALK_WINDOW');
    expect(phaseOf({ ...base, phase: 'weird' }, 150)).toBe('OPEN');
  });
  it('links to the trade view only when trading', () => {
    expect(hrefFor({ launch_id: '1' }, 'TRADING')).toBe('/token/1');
    expect(hrefFor({ launch_id: '1' }, 'PASS')).toBe('/launch/1');
  });
});

describe('marginSentence', () => {
  const l = (total: string, funders: number, verdict: 'PASS' | 'FAIL' | null = null) => ({ total_active: total, soft_cap: '350000000', funders, min_funders: 10, verdict });
  it('passing', () => expect(marginSentence(l('437000000', 11))).toBe('Passing by $87 and 1 backer.'));
  it('needs', () => expect(marginSentence(l('137000000', 4))).toBe('Needs $213 and 6 more backers.'));
  it('money fine, backers short', () => expect(marginSentence(l('900000000', 9))).toBe('Needs 1 more backer.'));
  it('equality passes', () => expect(marginSentence(l('350000000', 10))).toBe('Right at the line (equality passes).'));
  it('settled', () => { expect(marginSentence(l('437000000', 11, 'PASS'))).toBe('Passed by $87 and 1 backer.'); expect(marginSentence(l('100000000', 2, 'FAIL'))).toBe('Failed: short by $250 and 8 backers.'); });
  it('unknown terms are said, not guessed', () => expect(marginSentence({ total_active: '1', soft_cap: null, funders: 1, min_funders: null, verdict: null })).toMatch(/not indexed/));
});

describe('instant phases (OpenAPI 1.2.0)', () => {
  const i = { status: 'open' as const, stage: 'launching' as const, verdict: null, has_market: false, opens_at: null, walk_end: null, mode: 'instant' as const };
  it('maps the indexer phase strings', () => {
    expect(phaseOf({ ...i, phase: 'instant_pending_seed' }, 1)).toBe('LAUNCHING');
    expect(phaseOf({ ...i, phase: 'instant_open' }, 1)).toBe('TRADING');
    expect(phaseOf({ ...i, phase: 'instant_failed' }, 1)).toBe('LAUNCH_FAILED');
  });
  it('derives from status when no phase is sent', () => {
    expect(phaseOf({ ...i, status: 'token_ready' }, 1)).toBe('LAUNCHING');
    expect(phaseOf({ ...i, status: 'trading', has_market: true }, 1)).toBe('TRADING');
    expect(phaseOf({ ...i, status: 'aborted' }, 1)).toBe('LAUNCH_FAILED');
    expect(phaseOf({ ...i, status: 'abandoned' }, 1)).toBe('LAUNCH_FAILED');
  });
  it('an instant launch never shows a trial verdict phase', () => expect(phaseOf({ ...i, status: 'trading', has_market: false, stage: 'trading' }, 1)).toBe('TRADING'));
});
