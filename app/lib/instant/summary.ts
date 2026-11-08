// Plain-language Summary lines for the instant form (APP-SPEC section 9 copy rules: no banned words, qualified creator maximum).
// Every number here comes from the parameters, the launcher's own config (launch fee, unit) or the contract's formula. Where the launcher
// has not said (fee, unit), the sentence says so instead of assuming.
import { fmtUsdc } from '../config';
import { deriveInstant, termWord, unitInfo, type InstantParams } from './rules';

const pct = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;
const tokens = (base: bigint): string => (base / 1_000_000n).toLocaleString('en-US');

export function summarizeSeed(p: InstantParams, launchFee: bigint | null): string {
  const d = deriveInstant(p, launchFee);
  const fee = launchFee === null ? ' The launch fee comes from the launcher, which has not answered yet.'
    : launchFee > 0n ? ` A flat ${fmtUsdc(launchFee)} launch fee comes out of the seed, so the pool opens with ${fmtUsdc(d.poolSeed)}.` : ' This launcher charges no launch fee.';
  return `You put ${fmtUsdc(p.seed_q)} into the pool as its opening reserve. It stays there for good: no method can withdraw it.${fee}`;
}

/** Vesting is linear from the pool opening, with nothing claimable before the cliff (INSTANT-ABI section 6): at the cliff the share vested so far unlocks at once. */
export function cliffSharePct(p: Pick<InstantParams, 'cliff_days' | 'vest_days'>): string {
  return p.vest_days > 0 ? `${Number(((Math.min(p.cliff_days, p.vest_days) / p.vest_days) * 100).toFixed(1))}%` : 'n/a';
}

export function summarizeAllocation(p: InstantParams, unitNs: string | null): string {
  const d = deriveInstant(p, null);
  if (p.creator_alloc_bps === 0) return 'You keep no allocation: the whole supply goes into the pool.';
  const u = unitInfo(unitNs);
  return `${pct(p.creator_alloc_bps)} of the supply (${tokens(d.nAlloc)} tokens) is yours. Nothing unlocks for ${termWord(p.cliff_days, u)}. At the cliff ${cliffSharePct(p)} of it unlocks at once, then it unlocks evenly until ${termWord(p.vest_days, u)} after the pool opens. The other ${pct(10_000 - p.creator_alloc_bps)} goes into the pool.`;
}

export function summarizeOpenPrice(p: InstantParams, launchFee: bigint | null): string {
  const d = deriveInstant(p, launchFee);
  const f = p.fees;
  const open = f.opening_fee_start_bps > 0 ? ` The first trades pay an opening fee of ${pct(f.opening_fee_start_bps)} that falls to the base fee over ${f.opening_decay_minutes} minutes; the extra goes to liquidity.` : '';
  return d.openPriceUsdc === null ? 'The opening price needs a valid seed.' : `The pool opens at about ${d.openPriceUsdc.toPrecision(3)} USDC per token (an estimate; the launcher's own figure is shown when it answers).${open}`;
}
