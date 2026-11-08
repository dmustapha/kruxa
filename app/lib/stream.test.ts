import { describe, expect, it } from 'vitest';
import { drawOutcome, unlockedBps } from './stream';

describe('stream draw outcome (payout.rs draw)', () => {
  const s = { total: '9000000', cap: '38229', drawn: '0', inflight: '0', drawable: '38229' };
  it('withdraw-all above the cap reverts with STREAM_CAP and the contract wording', () => {
    expect(drawOutcome(s, 9_000_000n)).toEqual({ wouldRevert: true, message: 'STREAM_CAP: requested 9000000 > drawable 38229' });
  });
  it('drawing exactly what is drawable succeeds', () => expect(drawOutcome(s, null)).toEqual({ wouldRevert: false, amount: '38229' }));
  it('one unit over reverts', () => expect(drawOutcome(s, 38_230n).wouldRevert).toBe(true));
  it('nothing drawable reverts with R_NOTHING_FREE', () => expect(drawOutcome({ drawable: '0' }, null)).toMatchObject({ wouldRevert: true, message: expect.stringContaining('R_NOTHING_FREE') }));
  it('unlocked fraction in bps', () => { expect(unlockedBps({ total: '10000', cap: '2500' })).toBe(2500); expect(unlockedBps({ total: '0', cap: '0' })).toBe(0); });
});
