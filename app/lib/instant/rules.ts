// LOCAL MIRROR of the instant launcher's parameter rules (docs/interfaces/INSTANT-ABI.md section 5, crates/kruxa-instant).
// Used for instant feedback and when the launcher cannot be reached. The launcher's own `preview_instant` is shown beside it and wins
// on any disagreement. Nothing here is a claim about what a deployed contract will answer.
import { RESERVED_SYMBOLS, STANDARD_FEES, USDC, validateFeeTerms, type FeeTerms, type Violation } from '../charter/rules';

export interface InstantParams {
  name: string; symbol: string; creator_alloc_bps: number; cliff_days: number; vest_days: number; seed_q: bigint; fees: FeeTerms;
}

export const INSTANT_DEFAULTS: InstantParams = { name: '', symbol: '', creator_alloc_bps: 500, cliff_days: 7, vest_days: 90, seed_q: 250n * USDC, fees: STANDARD_FEES };

export const SEED_MIN = 100n * USDC;
export const SEED_MAX = 1000n * USDC;
/** Flat launch fee taken from the seed: $10 on mainnet, none elsewhere (ABI section 3). */
export const launchFeeFor = (network: string): bigint => (network === 'mainnet' ? 10n * USDC : 0n);
/** Deposit components from the ABI (0.06 factory + 0.02 record + 0.00125 token registration + 0.05 market pool storage), yocto. */
export const DEPOSIT_ESTIMATE_YOCTO = 131_250_000_000_000_000_000_000n;
export const TOTAL_SUPPLY = 1_000_000_000n * 1_000_000n;
export const DAY_SECS = 86_400;

export interface InstantDerived { nTotal: bigint; nAlloc: bigint; nPool: bigint; poolSeed: bigint; launchFee: bigint; openPriceUsdc: number | null }

export function deriveInstant(p: InstantParams, network = 'testnet'): InstantDerived {
  const nAlloc = (TOTAL_SUPPLY * BigInt(p.creator_alloc_bps)) / 10_000n;
  const nPool = TOTAL_SUPPLY - nAlloc;
  const launchFee = launchFeeFor(network);
  const poolSeed = p.seed_q > launchFee ? p.seed_q - launchFee : 0n;
  const wholeTokens = Number(nPool) / 1e6;
  return { nTotal: TOTAL_SUPPLY, nAlloc, nPool, poolSeed, launchFee, openPriceUsdc: wholeTokens > 0 ? Number(poolSeed) / 1e6 / wholeTokens : null };
}

const v = (code: Violation['code'], field: string, got: unknown, limit: string): Violation => ({ code, field, got: String(got), limit });

export function validateInstant(p: InstantParams, network = 'testnet'): Violation[] {
  const out: Violation[] = [];
  if (!/^[A-Z0-9]{2,12}$/.test(p.symbol)) out.push(v('R_SYMBOL', 'symbol', p.symbol, '2..=12 of [A-Z0-9]'));
  else if (RESERVED_SYMBOLS.includes(p.symbol)) out.push(v('R_SYMBOL_RESERVED', 'symbol', p.symbol, 'not a reserved symbol'));
  if (p.name.length === 0 || p.name.length > 32 || !/^[\x20-\x7e]+$/.test(p.name)) out.push(v('R_SYMBOL', 'name', p.name, '1..=32 printable ASCII'));
  if (p.creator_alloc_bps < 0 || p.creator_alloc_bps > 1000) out.push(v('R_ALLOC', 'creator_alloc_bps', p.creator_alloc_bps, '0..=1000'));
  if (p.vest_days < 30 || p.vest_days > 365) out.push(v('R_VEST', 'vest_days', p.vest_days, '30..=365'));
  if (p.cliff_days < 7 || p.cliff_days > 30 || p.cliff_days > p.vest_days) out.push(v('R_VEST', 'cliff_days', p.cliff_days, '7..=30 and at most vest_days'));
  const fee = launchFeeFor(network);
  if (p.seed_q < SEED_MIN || p.seed_q > SEED_MAX || p.seed_q <= fee) out.push(v('R_SEED_RANGE', 'seed_q', p.seed_q, `${SEED_MIN}..=${SEED_MAX} and above the launch fee`));
  const feeV = validateFeeTerms(p.fees);
  if (feeV) out.push(feeV);
  return out;
}

export const toInstantJson = (p: InstantParams): Record<string, unknown> => ({ ...p, seed_q: p.seed_q.toString() });

/** One launch per account per 24 h (R_RATE_LIMIT). `createdAt` are unix seconds of the account's instant launches. */
export function rateLimited(createdAt: number[], now: number): boolean {
  return createdAt.some((t) => now - t < DAY_SECS);
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
