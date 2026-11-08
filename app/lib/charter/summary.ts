// Plain-language "Summary:" sentence under each Studio control (meme.cooking pattern, APP-SPEC 4.3). Pure; copy follows APP-SPEC section 9.
import { fmtUsdc } from '../config';
import type { TrialParams } from './rules';

const hours = (secs: number): string => (secs % 86400 === 0 && secs >= 172800 ? `${secs / 86400} days` : secs < 3600 ? `${secs} seconds` : `${Number((secs / 3600).toFixed(2))} h`);
const pct = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;

export function summarizeRaise(p: TrialParams): string {
  return `If ${fmtUsdc(p.soft_cap)} or more is committed by at least ${p.min_funders} backers when the Walk window ends, the trial passes. Otherwise every backer gets a refund.`;
}

export function summarizeTime(p: TrialParams): string {
  const delay = p.open_delay_secs > 0 ? `${hours(p.open_delay_secs)} after you create it` : 'as soon as you create it';
  return `The trial opens ${delay}. Commits close ${hours(p.commit_secs)} later. Backers can still Walk for ${hours(p.tail_secs)} after that.`;
}

export function summarizeBuckets(p: TrialParams): string {
  return `${pct(p.sale_bps)} of the supply is for sale, ${pct(p.lp_bps)} seeds liquidity, ${pct(p.creator_bps)} is the creator allocation and ${pct(p.backer_bps)} is a backer bonus.`;
}

export function summarizeStream(p: TrialParams): string {
  return `After a pass you can draw at most 1/${p.stream_days} of the proceeds stream per day. A Withdraw all is refused by the contract with STREAM_CAP.`;
}

/** Creator-maximum wording with its qualifier (INVARIANTS MUST NOT CLAIM). Never the bare "at most 1%". */
export function summarizeFees(p: TrialParams): string {
  const take = (p.fees.total_fee_bps * p.fees.creator_bps) / 10_000 / 100;
  return `Your declared fee slice is ${take.toFixed(2)}% of trade volume; the contract caps it at 1.00% of volume. Wallets you control could capture up to 80% of the fee in the worst legal setup (75% at the default split).`;
}

export function summarizeOpening(p: TrialParams): string {
  const f = p.fees;
  return f.opening_fee_start_bps === 0
    ? 'No opening surcharge: the trading fee is flat from the first trade.'
    : `Trading opens at ${pct(f.opening_fee_start_bps)} and falls to ${pct(f.total_fee_bps)} over ${f.opening_decay_minutes} minutes; the extra goes to liquidity.`;
}
