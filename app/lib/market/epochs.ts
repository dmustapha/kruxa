// Fee epochs (24 h from pool open, MARKET-ABI) folded from the swaps the indexer returned. This is a display derivation from
// a bounded window of events, never the contract's FeeLedger; callers must label it that way.
import type { Trade } from './types';

export const EPOCH_SECONDS = 86_400;
export interface EpochRow { epoch: number; startsAt: number; trades: number; volumeQuote: bigint; feeTotal: bigint; creatorSlice: bigint | null }

export function foldEpochs(trades: Trade[], openedAtSec: number): EpochRow[] {
  const rows = new Map<number, EpochRow>();
  for (const t of trades) {
    if (t.time < openedAtSec) continue;
    const e = Math.floor((t.time - openedAtSec) / EPOCH_SECONDS);
    const row = rows.get(e) ?? { epoch: e, startsAt: openedAtSec + e * EPOCH_SECONDS, trades: 0, volumeQuote: 0n, feeTotal: 0n, creatorSlice: 0n };
    row.trades += 1;
    row.volumeQuote += BigInt(t.quote_amount ?? '0');
    row.feeTotal += BigInt(t.fee_total);
    row.creatorSlice = row.creatorSlice !== null && t.fee_slices?.creator !== undefined ? row.creatorSlice + BigInt(t.fee_slices.creator) : null;
    rows.set(e, row);
  }
  return [...rows.values()].sort((a, b) => b.epoch - a.epoch);
}
