import { describe, expect, it } from 'vitest';
import { applyTradeToSeries, prependTrade, upsertCandle } from './series';
import type { Candle, Trade } from './types';

const c = (t: number, o: number, h: number, l: number, cl: number): Candle => ({ t, o, h, l, c: cl, v: 1 });
const trade = (time: number, price: number, id = 'r1'): Trade => ({ launch_id: '1', side: 'buy', trader: 'a', amount_in: '1', amount_out: '1', price, quote_amount: '2000000', fee_total: '1', block_height: 1, receipt_id: id, time, source: 'fixture' });

describe('series', () => {
  it('upsertCandle appends, replaces and keeps order', () => {
    let s = upsertCandle([], c(60, 1, 1, 1, 1));
    s = upsertCandle(s, c(120, 1, 2, 1, 2));
    s = upsertCandle(s, c(120, 1, 3, 1, 3));
    s = upsertCandle(s, c(0, 1, 1, 1, 1));
    expect(s.map((x) => x.t)).toEqual([0, 60, 120]);
    expect(s[2]!.h).toBe(3);
  });
  it('folds a trade into the open bucket of any interval', () => {
    const s = applyTradeToSeries([c(3600, 1, 1.5, 0.9, 1.2)], trade(3700, 2), '1h');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ h: 2, c: 2, l: 0.9, o: 1, v: 3, n: 1 });
  });
  it('opens a new bucket from the previous close', () => {
    const s = applyTradeToSeries([c(0, 1, 1, 1, 1.1)], trade(65, 1.3), '1m');
    expect(s[1]).toMatchObject({ t: 60, o: 1.1, c: 1.3, h: 1.3, l: 1.1 });
  });
  it('prependTrade ignores duplicates and bounds length', () => {
    const a = trade(1, 1, 'x');
    expect(prependTrade([a], a)).toHaveLength(1);
    let l: Trade[] = [];
    for (let i = 0; i < 10; i++) l = prependTrade(l, trade(i, 1, `r${i}`), 5);
    expect(l).toHaveLength(5);
    expect(l[0]!.receipt_id).toBe('r9');
  });
});
