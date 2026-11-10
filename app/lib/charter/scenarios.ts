// "What happens" raise scenarios, computed in the browser with the TypeScript port of the contract's allocation rules (verdict.ts, pinned to
// the Rust output by tests). A model of the Charter's own terms, not a forecast of what will be raised.
import { allocate, settlePosition, verdict } from '../verdict';
import { derive, type Rules, type TrialParams, LADDER_RULES } from './rules';

export interface Scenario {
  label: string; committed: bigint; backers: number; verdict: 'PASS' | 'FAIL'; accepted: bigint; launchFee: bigint; lpSeed: bigint; stream: bigint;
  streamPerDay: bigint; refundPool: bigint; sample: { spend: bigint; refund: bigint; tokens: bigint };
}

export const SAMPLE_COMMIT = 100_000_000n;

export function scenarios(p: TrialParams, r: Rules = LADDER_RULES): Scenario[] | null {
  const d = derive(p, r);
  if (!d || p.soft_cap <= 0n || p.hard_cap < p.soft_cap || p.stream_days <= 0 || p.sale_bps <= 0) return null;
  const rows: [string, bigint, number][] = [
    ['Below soft cap', p.soft_cap / 2n, p.min_funders], ['At soft cap', p.soft_cap, p.min_funders],
    ['At hard cap', p.hard_cap, Math.max(p.min_funders, 1)], ['2x oversubscribed', p.hard_cap * 2n, Math.max(p.min_funders, 1)],
  ];
  return rows.map(([label, committed, backers]) => {
    const v = verdict({ launch_id: '0', charter_hash: Array<number>(32).fill(0), total_active: committed.toString(), active_funders: backers, soft_cap: p.soft_cap.toString(), min_funders: p.min_funders, cancelled: false });
    if (!v.pass) {
      return { label, committed, backers, verdict: 'FAIL' as const, accepted: 0n, launchFee: 0n, lpSeed: 0n, stream: 0n, streamPerDay: 0n, refundPool: committed, sample: { spend: 0n, refund: SAMPLE_COMMIT, tokens: 0n } };
    }
    const a = allocate(committed, p.hard_cap, BigInt(p.sale_bps), BigInt(p.lp_bps));
    const s = settlePosition(SAMPLE_COMMIT, committed, a.accepted, d.nSale, d.nBacker);
    return { label, committed, backers, verdict: 'PASS' as const, accepted: a.accepted, launchFee: a.launchFee, lpSeed: a.lpQuote, stream: a.stream, streamPerDay: a.stream / BigInt(p.stream_days), refundPool: a.excessPool, sample: { spend: s.spend, refund: s.refund, tokens: s.tokens + s.bonus } };
  });
}

// ---- trading volume scenarios (APP-SPEC 4.3, 5.4) ----
/** The slice of a fee each party gets, in the order the contract states them. Holders and referral slices go to liquidity in this release. */
export interface VolumeRow {
  volume: bigint; fee: bigint; creator: bigint; platform: bigint; liquidity: bigint;
  /** Part of the creator slice that is claimable at once, and the part that vests (fee_vest_bps). */
  creatorNow: bigint; creatorVesting: bigint;
}

export const VOLUME_STEPS: bigint[] = [1_000_000_000n, 10_000_000_000n, 100_000_000_000n]; // $1,000, $10,000, $100,000

type FeeShape = { total_fee_bps: number; creator_bps: number; platform_bps: number; fee_vest_bps: number };

/** Integer arithmetic only: amounts in micro-USDC, shares in bps. Rounds down per slice; the remainder goes to liquidity, as in the market. */
export function volumeScenarios(f: FeeShape, volumes: bigint[] = VOLUME_STEPS): VolumeRow[] {
  return volumes.map((volume) => {
    const fee = (volume * BigInt(f.total_fee_bps)) / 10_000n;
    const creator = (fee * BigInt(f.creator_bps)) / 10_000n;
    const platform = (fee * BigInt(f.platform_bps)) / 10_000n;
    const creatorVesting = (creator * BigInt(f.fee_vest_bps)) / 10_000n;
    return { volume, fee, creator, platform, liquidity: fee - creator - platform, creatorNow: creator - creatorVesting, creatorVesting };
  });
}
