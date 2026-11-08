// TypeScript mirror of kruxa-logic (verdict, allocation, per-position settlement). Kept byte-identical by lib/verdict.test.ts,
// which pins the hashes printed by `kruxa-sim verdict`. The demo page uses this so a browser can re-derive the verdict with no trust in our UI.
import { sha256 } from '@noble/hashes/sha2.js';

export const BELOW_SOFT_CAP = 1;
export const BELOW_MIN_FUNDERS = 2;
export const CANCELLED = 4;

export interface VerdictInputs {
  launch_id: string;
  charter_hash: number[];
  total_active: string;
  active_funders: number;
  soft_cap: string;
  min_funders: number;
  cancelled: boolean;
}

export type Outcome = { pass: true } | { pass: false; reasons: number };

export function verdict(i: VerdictInputs): Outcome {
  let reasons = 0;
  if (i.cancelled) reasons |= CANCELLED;
  if (BigInt(i.total_active) < BigInt(i.soft_cap)) reasons |= BELOW_SOFT_CAP;
  if (i.active_funders < i.min_funders) reasons |= BELOW_MIN_FUNDERS;
  return reasons === 0 ? { pass: true } : { pass: false, reasons };
}

const le = (n: bigint, bytes: number): number[] => Array.from({ length: bytes }, (_, k) => Number((n >> BigInt(8 * k)) & 0xffn));

export function encodeInputs(i: VerdictInputs): Uint8Array {
  return Uint8Array.from([
    ...le(BigInt(i.launch_id), 8),
    ...i.charter_hash,
    ...le(BigInt(i.total_active), 16),
    ...le(BigInt(i.active_funders), 4),
    ...le(BigInt(i.soft_cap), 16),
    ...le(BigInt(i.min_funders), 4),
    i.cancelled ? 1 : 0,
  ]);
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const inputsHash = (i: VerdictInputs): string => toHex(sha256(encodeInputs(i)));

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export interface Rules {
  launchFeeBps: bigint;
  maxLaunchFeeBps: bigint;
  launchFeeMin: bigint;
  launchFeeMax: bigint;
}

export const LADDER: Rules = { launchFeeBps: 150n, maxLaunchFeeBps: 300n, launchFeeMin: 10_000_000n, launchFeeMax: 2_500_000_000n };

export function launchFee(accepted: bigint, r: Rules = LADDER): bigint {
  const rate = ceilDiv(accepted * r.launchFeeBps, 10_000n);
  const ceiling = (accepted * r.maxLaunchFeeBps) / 10_000n;
  const candidate = rate > r.launchFeeMin ? rate : r.launchFeeMin;
  return [r.launchFeeMax, ceiling, candidate].reduce((a, b) => (a < b ? a : b));
}

export interface Allocation {
  accepted: bigint;
  launchFee: bigint;
  lpQuote: bigint;
  stream: bigint;
  excessPool: bigint;
}

export function allocate(totalActive: bigint, hardCap: bigint, saleBps: bigint, lpBps: bigint, r: Rules = LADDER): Allocation {
  const accepted = totalActive < hardCap ? totalActive : hardCap;
  const fee = launchFee(accepted, r);
  const lpQuote = (accepted * lpBps) / saleBps;
  return { accepted, launchFee: fee, lpQuote, stream: accepted - fee - lpQuote, excessPool: totalActive - accepted };
}

export function settlePosition(commit: bigint, total: bigint, accepted: bigint, nSale: bigint, nBacker: bigint) {
  const spend = ceilDiv(commit * accepted, total);
  return { spend, refund: commit - spend, tokens: (commit * nSale) / total, bonus: (commit * nBacker) / total };
}
