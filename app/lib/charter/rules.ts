// LOCAL MIRROR of crates/kruxa-logic/src/rules.rs `validate_all` (ladder profile and the labelled demo clock).
// It exists so the Studio can show every rule code instantly and with no RPC. It is never the authority: the contract's own
// answer is shown beside it whenever the contract is reachable (see preview.ts), and a disagreement is printed, not hidden.

export const USDC = 1_000_000n;

export interface FeeTerms {
  total_fee_bps: number; creator_bps: number; platform_bps: number; holders_bps: number; lp_bps: number; referral_bps: number;
  opening_fee_start_bps: number; opening_decay_minutes: number; fee_vest_bps: number; fee_vest_days: number;
}

export interface TrialParams {
  symbol: string; name: string; total_supply_whole: number;
  sale_bps: number; lp_bps: number; creator_bps: number; backer_bps: number;
  hard_cap: bigint; soft_cap: bigint; min_buy: bigint; wallet_bps: number; min_funders: number;
  open_delay_secs: number; commit_secs: number; tail_secs: number; stream_days: number; fees: FeeTerms;
}

export type RuleCode =
  | 'R_SYMBOL' | 'R_SUPPLY' | 'R_BUCKETS' | 'R_ALLOC' | 'R_HARD_CAP' | 'R_SOFT_CAP' | 'R_MIN_BUY' | 'R_WALLET_CAP' | 'R_FUNDERS' | 'R_PASSABLE'
  | 'R_WINDOW' | 'R_STREAM' | 'R_CAP_GLOBAL' | 'R_FEE_TOTAL' | 'R_CREATOR_SHARE' | 'R_CREATOR_TAKE' | 'R_PLATFORM_FLOOR' | 'R_PLATFORM_FIXED'
  | 'R_HOLDER_RANGE' | 'R_LP_RANGE' | 'R_HOLDER_LP_FLOOR' | 'R_REFERRAL' | 'R_SPLIT_SUM' | 'R_FEE_VEST' | 'R_OPENING'
  | 'R_VEST' | 'R_SEED_RANGE' | 'R_SYMBOL_RESERVED' | 'R_RATE_LIMIT' | 'R_CREATOR_GATE' | 'R_ACTIVE_TRIAL';

export interface Violation { code: RuleCode; field: string; got: string; limit: string }

export interface Rules {
  minSupply: number; maxSupply: number; minSaleBps: number; maxSaleBps: number; minLpBps: number; maxLpBps: number;
  maxCreatorBps: number; maxBackerBps: number; maxCreatorPlusBackerBps: number;
  minHardCap: bigint; maxHardCap: bigint; minSoftAbs: bigint; minSoftPctBps: number; minBuyAbs: bigint; minBuyDivisor: bigint;
  walletBpsMin: number; walletBpsMax: number; fundersMin: number; fundersMax: number;
  minCommitSecs: number; maxCommitSecs: number; minTailSecs: number; maxTailSecs: number; maxOpenDelaySecs: number;
  minStreamDaysSmall: number; minStreamDaysLarge: number; maxStreamDays: number; streamLargeThreshold: bigint;
  minTotalFeeBps: number; maxTotalFeeBps: number; maxCreatorShareBps: number; maxCreatorTakeBps: number; platformBps: number; minPlatformBps: number;
  minHoldersBps: number; maxHoldersBps: number; minLpFeeBps: number; maxLpFeeBps: number; minHoldersPlusLpBps: number; maxReferralBps: number;
  minFeeVestBps: number; minFeeVestDays: number; maxFeeVestDays: number; maxOpeningFeeStartBps: number; maxOpeningDecayMinutes: number;
  maxHolders: number;
}

export const LADDER_RULES: Rules = {
  minSupply: 10_000_000, maxSupply: 1_000_000_000_000, minSaleBps: 5000, maxSaleBps: 8000, minLpBps: 1500, maxLpBps: 4000,
  maxCreatorBps: 2000, maxBackerBps: 1000, maxCreatorPlusBackerBps: 2500,
  minHardCap: 500n * USDC, maxHardCap: 1000n * USDC, minSoftAbs: 350n * USDC, minSoftPctBps: 2000, minBuyAbs: 20n * USDC, minBuyDivisor: 500n,
  walletBpsMin: 50, walletBpsMax: 500, fundersMin: 10, fundersMax: 500,
  minCommitSecs: 43_200, maxCommitSecs: 2_592_000, minTailSecs: 3_600, maxTailSecs: 172_800, maxOpenDelaySecs: 604_800,
  minStreamDaysSmall: 30, minStreamDaysLarge: 90, maxStreamDays: 365, streamLargeThreshold: 25_000n * USDC,
  minTotalFeeBps: 30, maxTotalFeeBps: 200, maxCreatorShareBps: 6000, maxCreatorTakeBps: 100, platformBps: 1500, minPlatformBps: 1500,
  minHoldersBps: 1000, maxHoldersBps: 3000, minLpFeeBps: 500, maxLpFeeBps: 3000, minHoldersPlusLpBps: 2000, maxReferralBps: 2000,
  minFeeVestBps: 2500, minFeeVestDays: 30, maxFeeVestDays: 365, maxOpeningFeeStartBps: 1000, maxOpeningDecayMinutes: 120,
  maxHolders: 500,
};

/** The labelled demo profile: same wasm, clock compressed (minimum commit 90 s, minimum tail 30 s). Hostile checks unchanged. */
export const DEMO_RULES: Rules = { ...LADDER_RULES, minCommitSecs: 90, minTailSecs: 30 };

export const STANDARD_FEES: FeeTerms = {
  total_fee_bps: 100, creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000,
  opening_fee_start_bps: 0, opening_decay_minutes: 0, fee_vest_bps: 5000, fee_vest_days: 90,
};

export const RESERVED_SYMBOLS = ['KRUXA', 'USDC', 'USDT', 'NEAR', 'WNEAR', 'SOL', 'ETH', 'BTC', 'DAI'];
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

type Check = Violation | null;
const v = (code: RuleCode, field: string, got: unknown, limit: unknown): Violation => ({ code, field, got: String(got), limit: String(limit) });
const within = (code: RuleCode, field: string, x: number | bigint, lo: number | bigint, hi: number | bigint): Check =>
  x < lo || x > hi ? v(code, field, x, `${lo}..=${hi}`) : null;
const first = (...checks: Check[]): Check => checks.find((c) => c !== null) ?? null;

function checkText(p: TrialParams): Check {
  const symOk = /^[A-Z0-9]{2,12}$/.test(p.symbol);
  if (!symOk || RESERVED_SYMBOLS.includes(p.symbol)) return v('R_SYMBOL', 'symbol', p.symbol, '2..=12 of [A-Z0-9], not reserved');
  if (p.name.length === 0 || p.name.length > 32 || !/^[\x20-\x7e]+$/.test(p.name)) return v('R_SYMBOL', 'name', p.name, '1..=32 printable ASCII');
  return null;
}

function checkBuckets(p: TrialParams, r: Rules): Check {
  const sum = p.sale_bps + p.lp_bps + p.creator_bps + p.backer_bps;
  const cb = p.creator_bps + p.backer_bps;
  return first(
    within('R_SUPPLY', 'total_supply_whole', p.total_supply_whole, r.minSupply, r.maxSupply),
    within('R_BUCKETS', 'sale_bps', p.sale_bps, r.minSaleBps, r.maxSaleBps),
    within('R_BUCKETS', 'lp_bps', p.lp_bps, r.minLpBps, r.maxLpBps),
    within('R_BUCKETS', 'creator_bps', p.creator_bps, 0, r.maxCreatorBps),
    within('R_BUCKETS', 'backer_bps', p.backer_bps, 0, r.maxBackerBps),
    sum !== 10_000 ? v('R_BUCKETS', 'bucket sum', sum, '== 10000') : null,
    cb > r.maxCreatorPlusBackerBps ? v('R_ALLOC', 'creator+backer bps', cb, r.maxCreatorPlusBackerBps) : null,
  );
}

function checkFees(p: TrialParams, r: Rules): Check {
  const f = p.fees;
  const take = f.total_fee_bps * f.creator_bps;
  const sum = f.creator_bps + f.platform_bps + f.holders_bps + f.lp_bps + f.referral_bps;
  const { opening_fee_start_bps: start, opening_decay_minutes: decay } = f;
  const openingBad = (start === 0) !== (decay === 0) || (start !== 0 && (start < f.total_fee_bps || start > r.maxOpeningFeeStartBps || decay > r.maxOpeningDecayMinutes));
  return first(
    within('R_FEE_TOTAL', 'total_fee_bps', f.total_fee_bps, r.minTotalFeeBps, r.maxTotalFeeBps),
    within('R_CREATOR_SHARE', 'creator_bps', f.creator_bps, 0, r.maxCreatorShareBps),
    take > r.maxCreatorTakeBps * 10_000 ? v('R_CREATOR_TAKE', 'total_fee_bps*creator_bps', take, `<= ${r.maxCreatorTakeBps * 10_000}`) : null,
    f.platform_bps < r.minPlatformBps ? v('R_PLATFORM_FLOOR', 'platform_bps', f.platform_bps, `>= ${r.minPlatformBps}`) : null,
    f.platform_bps !== r.platformBps ? v('R_PLATFORM_FIXED', 'platform_bps', f.platform_bps, `== ${r.platformBps}`) : null,
    within('R_HOLDER_RANGE', 'holders_bps', f.holders_bps, r.minHoldersBps, r.maxHoldersBps),
    within('R_LP_RANGE', 'lp_bps', f.lp_bps, r.minLpFeeBps, r.maxLpFeeBps),
    f.holders_bps + f.lp_bps < r.minHoldersPlusLpBps ? v('R_HOLDER_LP_FLOOR', 'holders_bps+lp_bps', f.holders_bps + f.lp_bps, `>= ${r.minHoldersPlusLpBps}`) : null,
    within('R_REFERRAL', 'referral_bps', f.referral_bps, 0, r.maxReferralBps),
    sum !== 10_000 ? v('R_SPLIT_SUM', 'fee split sum', sum, '== 10000') : null,
    within('R_FEE_VEST', 'fee_vest_bps', f.fee_vest_bps, r.minFeeVestBps, 10_000),
    within('R_FEE_VEST', 'fee_vest_days', f.fee_vest_days, r.minFeeVestDays, r.maxFeeVestDays),
    openingBad ? v('R_OPENING', 'opening fee', `${start} bps over ${decay} min`, 'both zero, or start in total..=max over <= max minutes') : null,
  );
}

function checkRaise(p: TrialParams, r: Rules): Check {
  const hard = within('R_HARD_CAP', 'hard_cap', p.hard_cap, r.minHardCap, r.maxHardCap);
  if (hard) return hard;
  const pct = ceilDiv(p.hard_cap * BigInt(r.minSoftPctBps), 10_000n);
  const softFloor = r.minSoftAbs > pct ? r.minSoftAbs : pct;
  const div = ceilDiv(p.hard_cap, r.minBuyDivisor);
  const buyFloor = r.minBuyAbs > div ? r.minBuyAbs : div;
  return first(
    p.soft_cap < softFloor || p.soft_cap > p.hard_cap ? v('R_SOFT_CAP', 'soft_cap', p.soft_cap, `${softFloor}..=${p.hard_cap}`) : null,
    p.min_buy < buyFloor || p.min_buy > p.soft_cap ? v('R_MIN_BUY', 'min_buy', p.min_buy, `>= ${buyFloor}`) : null,
    within('R_WALLET_CAP', 'wallet_bps', p.wallet_bps, r.walletBpsMin, r.walletBpsMax),
    within('R_FUNDERS', 'min_funders', p.min_funders, r.fundersMin, r.fundersMax),
    BigInt(p.min_funders) * p.min_buy > p.soft_cap ? v('R_PASSABLE', 'min_funders*min_buy', BigInt(p.min_funders) * p.min_buy, `<= soft_cap ${p.soft_cap}`) : null,
  );
}

function checkWindow(p: TrialParams, r: Rules): Check {
  const need = p.hard_cap <= r.streamLargeThreshold ? r.minStreamDaysSmall : r.minStreamDaysLarge;
  return first(
    within('R_WINDOW', 'commit_secs', p.commit_secs, r.minCommitSecs, r.maxCommitSecs),
    within('R_WINDOW', 'tail_secs', p.tail_secs, r.minTailSecs, r.maxTailSecs),
    within('R_WINDOW', 'open_delay_secs', p.open_delay_secs, 0, r.maxOpenDelaySecs),
    within('R_STREAM', 'stream_days', p.stream_days, need, r.maxStreamDays),
  );
}

/** Every stage's first violation, in the contract's fixed order: text, buckets, fees, raise, window and stream, global cap. */
export function validateAll(p: TrialParams, r: Rules = LADDER_RULES, globalHeadroom: bigint = 3000n * USDC): Violation[] {
  const out = [checkText(p), checkBuckets(p, r), checkFees(p, r), checkRaise(p, r), checkWindow(p, r)].filter((c): c is Violation => c !== null);
  if (p.hard_cap > globalHeadroom) out.push(v('R_CAP_GLOBAL', 'hard_cap', p.hard_cap, `global headroom ${globalHeadroom}`));
  return out;
}

export interface DerivedView { maxHolders: number; walletCap: bigint; nSale: bigint; nLp: bigint; nCreator: bigint; nBacker: bigint }

/** Display-only derived numbers (same integer rules as the contract). Null when the raise inputs are not usable. */
export function derive(p: TrialParams, r: Rules = LADDER_RULES): DerivedView | null {
  if (p.min_buy <= 0n || p.hard_cap <= 0n) return null;
  const total = BigInt(p.total_supply_whole) * 10n ** 6n;
  const part = (bps: number): bigint => (total * BigInt(bps)) / 10_000n;
  const nSale = part(p.sale_bps); const nCreator = part(p.creator_bps); const nBacker = part(p.backer_bps);
  const byBps = ceilDiv(p.hard_cap * BigInt(p.wallet_bps), 10_000n);
  const floor = p.min_buy * 5n;
  const byMath = ceilDiv(2n * p.hard_cap, p.min_buy);
  const maxHolders = Number(byMath < BigInt(r.maxHolders) ? byMath : BigInt(r.maxHolders));
  return { maxHolders, walletCap: byBps > floor ? byBps : floor, nSale, nCreator, nBacker, nLp: total - nSale - nCreator - nBacker };
}

/** Storage bond part of the creator deposit: (max_holders x 330 + 3000 bytes) x 1e19 yocto. The factory deposit is added by the contract. */
export const bondRequired = (maxHolders: number): bigint => (BigInt(maxHolders) * 330n + 3000n) * 10n ** 19n;

export function toContractJson(p: TrialParams): Record<string, unknown> {
  return {
    ...p, hard_cap: p.hard_cap.toString(), soft_cap: p.soft_cap.toString(), min_buy: p.min_buy.toString(),
  };
}

/** The fee-term checks alone, for launch modes that share them (instant launch). */
export const validateFeeTerms = (fees: FeeTerms, r: Rules = LADDER_RULES): Violation | null => checkFees({ fees } as TrialParams, r);
