import { describe, expect, it } from 'vitest';
import { referenceNow } from './clock';

describe('referenceNow', () => {
  it('fixture data counts against the indexed time, not the wall clock', () => expect(referenceNow('fixture', { block_height: 1, block_time: 1_800_000_000 }, 5)).toBe(1_800_000_000));
  it('chain data uses the wall clock', () => expect(referenceNow('chain', { block_height: 1, block_time: 1_800_000_000 }, 5)).toBe(5));
  it('a fixture with no block time falls back to the wall clock', () => expect(referenceNow('fixture', { block_height: null, block_time: null }, 7)).toBe(7));
});
