import { describe, expect, it } from 'vitest';
import { foldEpochs } from './epochs';
import type { Trade } from './types';

const t = (time: number, creator: string | undefined, id: string): Trade => ({ launch_id: '1', side: 'buy', trader: 'a', amount_in: '1', amount_out: '1', price: 1, quote_amount: '1000000', fee_total: '10000', fee_slices: creator === undefined ? undefined : { creator }, block_height: 1, receipt_id: id, time, source: 'fixture' });

describe('foldEpochs', () => {
  it('buckets by 24 h from open, newest first', () => {
    const rows = foldEpochs([t(1000, '5000', 'a'), t(1000 + 86_400, '5000', 'b'), t(1500, '5000', 'c'), t(900, '5000', 'old')], 1000);
    expect(rows.map((r) => [r.epoch, r.trades, r.creatorSlice])).toEqual([[1, 1, 5000n], [0, 2, 10000n]]);
    expect(rows[1]!.volumeQuote).toBe(2_000_000n);
  });
  it('reports the creator slice as unknown when a swap did not log it', () => {
    expect(foldEpochs([t(1000, undefined, 'a')], 1000)[0]!.creatorSlice).toBeNull();
  });
});
