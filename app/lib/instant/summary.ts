// Plain-language Summary lines for the instant form (APP-SPEC section 9 copy rules: no banned words, qualified creator maximum).
import { fmtUsdc } from '../config';
import { deriveInstant, type InstantParams } from './rules';

const pct = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;
const tokens = (base: bigint): string => (base / 1_000_000n).toLocaleString('en-US');

export function summarizeSeed(p: InstantParams, network = 'testnet'): string {
  const d = deriveInstant(p, network);
  const fee = d.launchFee > 0n ? ` A flat ${fmtUsdc(d.launchFee)} launch fee comes out of the seed, so the pool opens with ${fmtUsdc(d.poolSeed)}.` : ' There is no launch fee on testnet.';
  return `You put ${fmtUsdc(p.seed_q)} into the pool as its opening reserve. It stays there for good: no method can withdraw it.${fee}`;
}

export function summarizeAllocation(p: InstantParams): string {
  const d = deriveInstant(p);
  if (p.creator_alloc_bps === 0) return 'You keep no allocation: the whole supply goes into the pool.';
  return `${pct(p.creator_alloc_bps)} of the supply (${tokens(d.nAlloc)} tokens) is yours. Nothing unlocks for ${p.cliff_days} days, then it unlocks evenly until day ${p.vest_days}. The other ${pct(10_000 - p.creator_alloc_bps)} goes into the pool.`;
}

export function summarizeOpenPrice(p: InstantParams, network = 'testnet'): string {
  const d = deriveInstant(p, network);
  return d.openPriceUsdc === null ? 'The opening price needs a valid seed.' : `The pool opens at about ${d.openPriceUsdc.toPrecision(3)} USDC per token. The first trades pay an opening fee of 5% that falls to the base fee over 60 minutes; the extra goes to liquidity.`;
}
