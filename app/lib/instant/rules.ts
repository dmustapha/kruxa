// LOCAL MIRROR of the instant launcher's parameter rules (docs/interfaces/INSTANT-ABI.md section 5, crates/kruxa-instant).
// Used for instant feedback and when the launcher cannot be reached. The launcher's own `preview_instant` is shown beside it and wins
// on any disagreement. Nothing here is a claim about what a deployed contract will answer.
import { RESERVED_SYMBOLS, STANDARD_FEES, USDC, validateFeeTerms, type FeeTerms, type Violation } from '../charter/rules';

export interface InstantParams {
  name: string; symbol: string; creator_alloc_bps: number; cliff_days: number; vest_days: number; seed_q: bigint; fees: FeeTerms;
  /** Announced open: seconds between the pool opening and the first accepted buy (0 to 3600, default 600). */
  trade_delay_secs: number;
}

/** `kruxa_instant::default_fees`: the standard 50/15/15/10/10 split with the opening decay (500 bps over 60 minutes). */
export const INSTANT_FEES: FeeTerms = { ...STANDARD_FEES, opening_fee_start_bps: 500, opening_decay_minutes: 60 };

export const INSTANT_DEFAULTS: InstantParams = { name: '', symbol: '', creator_alloc_bps: 500, cliff_days: 7, vest_days: 90, seed_q: 250n * USDC, fees: INSTANT_FEES, trade_delay_secs: 600 };
export const MAX_TRADE_DELAY_SECS = 3600;

export const SEED_MIN = 100n * USDC;
export const SEED_MAX = 1000n * USDC;
/** What the launcher's own `get_config` says. The launch fee, seed bounds and unit come from the launcher, never from the app's network. */
export interface LauncherLimits { launchFee: bigint | null; seedMin: bigint; seedMax: bigint; unitNs: string | null }
/** Defaults used only until the launcher answers, labelled as local. The fee is unknown (null), not assumed. */
export const LOCAL_LIMITS: LauncherLimits = { launchFee: null, seedMin: SEED_MIN, seedMax: SEED_MAX, unitNs: null };
export const DAY_NS = '86400000000000';

export type UnitKind = 'day' | 'other' | 'unknown';
export interface UnitInfo { kind: UnitKind; secs: number | null; label: string }
/** The launcher's vesting and timing unit. Days are claimed only when `unit_ns` says one unit is exactly 86,400 s. */
export function unitInfo(unitNs: string | null | undefined): UnitInfo {
  if (!unitNs || !/^\d+$/.test(unitNs)) return { kind: 'unknown', secs: null, label: 'unit (length not known)' };
  if (unitNs === DAY_NS) return { kind: 'day', secs: 86_400, label: 'day' };
  const secs = Number(BigInt(unitNs) / 1_000_000_000n);
  return { kind: 'other', secs, label: `unit of ${secs} s (not a day: a demo clock)` };
}
/** "7 days" only on a day profile; otherwise "7 units" with the unit stated. Never "days" for a unit that is not a day. */
export function termWord(n: number, u: UnitInfo): string {
  return u.kind === 'day' ? `${n} ${n === 1 ? 'day' : 'days'}` : `${n} ${n === 1 ? 'unit' : 'units'}${u.kind === 'other' ? ` (${u.secs} s each)` : ' (length not known)'}`;
}
export const TOTAL_SUPPLY = 1_000_000_000n * 1_000_000n;
export const DAY_SECS = 86_400;

export interface InstantDerived { nTotal: bigint; nAlloc: bigint; nPool: bigint; poolSeed: bigint; launchFee: bigint; openPriceUsdc: number | null }

export function deriveInstant(p: InstantParams, launchFee: bigint | null): InstantDerived {
  const nAlloc = (TOTAL_SUPPLY * BigInt(p.creator_alloc_bps)) / 10_000n;
  const nPool = TOTAL_SUPPLY - nAlloc;
  const fee = launchFee ?? 0n;
  const poolSeed = p.seed_q > fee ? p.seed_q - fee : 0n;
  const wholeTokens = Number(nPool) / 1e6;
  return { nTotal: TOTAL_SUPPLY, nAlloc, nPool, poolSeed, launchFee: fee, openPriceUsdc: wholeTokens > 0 ? Number(poolSeed) / 1e6 / wholeTokens : null };
}

const v = (code: Violation['code'], field: string, got: unknown, limit: string): Violation => ({ code, field, got: String(got), limit });

export function validateInstant(p: InstantParams, limits: LauncherLimits = LOCAL_LIMITS): Violation[] {
  const out: Violation[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(p.symbol)) out.push(v('R_SYMBOL', 'symbol', p.symbol, '2..=12 of [A-Z0-9]'));
  else if (RESERVED_SYMBOLS.includes(p.symbol)) out.push(v('R_SYMBOL_RESERVED', 'symbol', p.symbol, 'not a reserved symbol'));
  if (p.name.length === 0 || p.name.length > 32 || !/^[\x20-\x7e]+$/.test(p.name)) out.push(v('R_SYMBOL', 'name', p.name, '1..=32 printable ASCII'));
  if (p.creator_alloc_bps < 0 || p.creator_alloc_bps > 1000) out.push(v('R_ALLOC', 'creator_alloc_bps', p.creator_alloc_bps, '0..=1000'));
  if (p.vest_days < 30 || p.vest_days > 365) out.push(v('R_VEST', 'vest_days', p.vest_days, '30..=365'));
  if (p.cliff_days < 7 || p.cliff_days > 30 || p.cliff_days > p.vest_days) out.push(v('R_VEST', 'cliff_days', p.cliff_days, '7..=30 and at most vest_days'));
  if (!Number.isInteger(p.trade_delay_secs) || p.trade_delay_secs < 0 || p.trade_delay_secs > MAX_TRADE_DELAY_SECS) out.push(v('R_TRADE_DELAY', 'trade_delay_secs', p.trade_delay_secs, `0..=${MAX_TRADE_DELAY_SECS}`));
  const fee = limits.launchFee ?? 0n;
  if (p.seed_q < limits.seedMin || p.seed_q > limits.seedMax || p.seed_q <= fee) out.push(v('R_SEED_RANGE', 'seed_q', p.seed_q, `${limits.seedMin}..=${limits.seedMax} and above the launch fee`));
  const feeV = validateFeeTerms(p.fees);
  if (feeV) out.push(feeV);
  return out;
}

export const toInstantJson = (p: InstantParams): Record<string, unknown> => ({ ...p, seed_q: p.seed_q.toString() });

/** One launch per account per unit (R_RATE_LIMIT, `RATE_LIMIT_UNITS = 1`). Null when the unit is not known: the launcher's preview decides then. */
export function rateLimited(createdAt: number[], now: number, unit: UnitInfo): boolean | null {
  if (unit.secs === null) return null;
  return createdAt.some((t) => now - t < unit.secs!);
}

export interface VestInput { nAlloc: bigint; openedAt: number; cliffDays: number; vestDays: number; unitSecs?: number }

/** unlocked(t): 0 before opened_at + cliff, then linear (floor) to nAlloc at opened_at + vest (INSTANT-ABI section 6, IL-5). */
export function unlockedAt(i: VestInput, t: number): bigint {
  const unit = i.unitSecs ?? DAY_SECS;
  if (t < i.openedAt + i.cliffDays * unit) return 0n;
  const vest = BigInt(i.vestDays * unit);
  const elapsed = BigInt(Math.min(t - i.openedAt, i.vestDays * unit));
  return (i.nAlloc * elapsed) / vest;
}

export const cliffEnd = (i: VestInput): number => i.openedAt + i.cliffDays * (i.unitSecs ?? DAY_SECS);
export const vestEnd = (i: VestInput): number => i.openedAt + i.vestDays * (i.unitSecs ?? DAY_SECS);
