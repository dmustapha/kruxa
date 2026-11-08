// Instant launch facts (CHANGE-ORDER-7, INSTANT-ABI). Everything here is derived from API fields or chain views; a fact that is
// not logged is `unknown`. Nothing claims a trial, a verdict, a refund, a Solana mint or "locked" liquidity.
import { fmtBps, fmtUnits } from './format';
import type { InstantInfo, SafetyIndicator, VestingView } from './types';
import { termWord, unitInfo } from '../instant/rules';
import { cliffSharePct } from '../instant/summary';

const NS = 1_000_000_000n;
const big = (v: string | number | bigint | null | undefined): bigint | null => { try { return v === null || v === undefined || v === '' ? null : BigInt(v); } catch { return null; } };

/** kruxa_math::linear_unlocked: floor(total * elapsed / duration), the whole amount at or after the end. */
export function linearUnlocked(total: bigint, startNs: bigint, durationNs: bigint, nowNs: bigint): bigint {
  if (durationNs <= 0n || nowNs >= startNs + durationNs) return total;
  if (nowNs <= startNs) return 0n;
  return (total * (nowNs - startNs)) / durationNs;
}

export interface VestSchedule {
  allocated: bigint | null; unlocked: bigint | null; claimed: bigint | null; claimable: bigint | null;
  cliffEndSec: number | null; vestEndSec: number | null;
  phase: 'before_open' | 'cliff' | 'vesting' | 'done' | 'unknown';
  /** Human line for "next unlock". The unlock is continuous (linear) after the cliff, so the next event is the cliff or the end. */
  next: string;
  basis: 'contract view' | 'api' | 'schedule estimate' | 'unknown';
}

/**
 * Prefer the launcher's `get_vesting` (authoritative), then the API's copy, then an estimate from the schedule (n_alloc, opened_at,
 * cliff_days, vest_days) with the integer formula. The estimate is labelled as such.
 */
export function vestSchedule(info: InstantInfo | null | undefined, vesting: VestingView | null | undefined, nowSec: number, unitSeconds: number | null = null): VestSchedule {
  const v = vesting ?? info?.vesting ?? null;
  const alloc = big(v?.total) ?? big(info?.n_alloc);
  const openedNs = big(info?.opened_at_ns);
  let cliffEnd = big(v?.cliff_end_ns);
  let vestEnd = big(v?.vest_end_ns);
  // Without the launcher's unit_ns the length of a "day" is not known, so the schedule is never estimated from cliff_days and vest_days.
  if (unitSeconds !== null && openedNs !== null && info?.cliff_days !== undefined && cliffEnd === null) cliffEnd = openedNs + BigInt(info.cliff_days) * BigInt(unitSeconds) * NS;
  if (unitSeconds !== null && openedNs !== null && info?.vest_days !== undefined && vestEnd === null) vestEnd = openedNs + BigInt(info.vest_days) * BigInt(unitSeconds) * NS;
  const out: VestSchedule = {
    allocated: alloc, unlocked: big(v?.unlocked), claimed: big(v?.claimed) ?? big(info?.alloc_claimed), claimable: big(v?.claimable),
    cliffEndSec: cliffEnd === null ? null : Number(cliffEnd / NS), vestEndSec: vestEnd === null ? null : Number(vestEnd / NS),
    phase: 'unknown', next: 'unknown', basis: v ? (vesting ? 'contract view' : 'api') : 'unknown',
  };
  if (openedNs === null && !v) return { ...out, phase: 'before_open', next: 'The schedule starts when the pool opens.' };
  const now = BigInt(nowSec) * NS;
  if (!v && alloc !== null && openedNs !== null && cliffEnd !== null && vestEnd !== null) {
    out.basis = 'schedule estimate';
    out.unlocked = now < cliffEnd ? 0n : linearUnlocked(alloc, openedNs, vestEnd - openedNs, now);
    out.claimable = out.claimed !== null && out.unlocked >= out.claimed ? out.unlocked - out.claimed : null;
  }
  if (cliffEnd !== null && vestEnd !== null) {
    out.phase = now < cliffEnd ? 'cliff' : now >= vestEnd ? 'done' : 'vesting';
    out.next = out.phase === 'cliff' ? `Cliff ends ${utc(Number(cliffEnd / NS))}. Nothing is claimable before it.`
      : out.phase === 'vesting' ? `Unlocks continuously until ${utc(Number(vestEnd / NS))}.`
      : 'Fully unlocked.';
  }
  return out;
}

export const utc = (sec: number): string => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** Why claim_vested cannot be sent right now, or null. `account` is the connected NEAR account, if any. */
export function claimVestedBlock(s: VestSchedule, recipient: string, account: string | null, signingEnabled: boolean, lockReason?: string): string | null {
  if (!signingEnabled) return lockReason ?? 'Signing is locked on this network.';
  if (account && account !== recipient) return `Connected as ${account}. Only the payout recipient can claim the allocation.`;
  if (s.phase === 'before_open') return 'The pool has not opened, so nothing has started to vest.';
  if (s.phase === 'cliff') return s.next;
  if (s.claimable === null) return 'The claimable amount is unknown, so claiming is disabled.';
  if (s.claimable <= 0n) return 'Nothing is claimable right now: everything unlocked has been claimed.';
  return null;
}

export interface ContractFact { id: string; label: string; value: string; status: 'pass' | 'info' | 'unknown'; basis: string; detail?: string }

const indicator = (rows: SafetyIndicator[], id: string): SafetyIndicator | undefined => rows.find((r) => r.id === id);

/** "Contract facts" for an instant token: what the contracts and the logs say, with the basis of each. */
export function contractFacts(a: {
  totalSupply: string | null; info: InstantInfo | null | undefined; sched: VestSchedule; safety: SafetyIndicator[];
  feeTotalBps: number | null; payout: string; token: string | null; market: string;
  /** The launcher's `unit_ns` from `get_config`; null or absent means the unit is not known and no number of days is claimed. */
  unitNs?: string | null;
}): ContractFact[] {
  const lp = indicator(a.safety, 'lp_in_pool');
  const nAlloc = a.sched.allocated;
  const pct = a.info?.creator_alloc_bps !== undefined ? fmtBps(a.info.creator_alloc_bps) : null;
  return [
    { id: 'supply', label: 'Total supply', value: a.totalSupply ? `${fmtUnits(a.totalSupply, 6, 0)} tokens` : 'unknown', status: a.totalSupply ? 'info' : 'unknown', basis: a.totalSupply ? 'event' : 'not logged', detail: 'Fixed when the token is created: the launcher has no mint method. The token is a factory token; its publisher key is disclosed in the Charter.' },
    { id: 'pool', label: 'Pool liquidity', value: lp && lp.status === 'pass' && lp.basis !== 'not_indexed' ? 'Seeded; the market has no LP withdrawal method' : 'unknown', status: lp && lp.status === 'pass' && lp.basis !== 'not_indexed' ? 'pass' : 'unknown', basis: lp && lp.basis !== 'not_indexed' ? lp.basis : 'not logged', detail: 'A property of the unreviewed market contract, which the phase-0 key can upgrade. Not an audit.' },
    { id: 'alloc', label: 'Creator allocation', value: nAlloc !== null ? `${fmtUnits(nAlloc, 6, 0)} tokens${pct ? ` (${pct})` : ''}` : 'unknown', status: nAlloc !== null ? 'info' : 'unknown', basis: nAlloc !== null ? 'contract' : 'not logged', detail: 'Held by the launcher, never in the pool. It reaches the payout recipient only through claim_vested.' },
    { id: 'vest', label: 'Vesting', value: a.info?.cliff_days !== undefined && a.info?.vest_days !== undefined ? `${termWord(a.info.cliff_days, unitInfo(a.unitNs))} cliff, then ${cliffSharePct({ cliff_days: a.info.cliff_days, vest_days: a.info.vest_days })} unlocks at once and the rest linearly until ${termWord(a.info.vest_days, unitInfo(a.unitNs))} after the pool opens` : 'unknown', status: a.info?.vest_days !== undefined ? 'info' : 'unknown', basis: a.info?.vest_days !== undefined ? 'contract' : 'not logged' },
    { id: 'payout', label: 'Payout recipient', value: a.payout, status: 'info', basis: 'event', detail: 'Fixed at launch: no method changes it.' },
    { id: 'fees', label: 'Base trading fee', value: a.feeTotalBps !== null ? `${fmtBps(a.feeTotalBps)} of each trade, in USDC` : 'unknown', status: a.feeTotalBps !== null ? 'info' : 'unknown', basis: a.feeTotalBps !== null ? 'event' : 'not logged', detail: 'Holders and referral slices go to liquidity in this release.' },
    { id: 'solana', label: 'Solana mint', value: 'None. This token lives on NEAR only.', status: 'info', basis: 'launcher ABI' },
    { id: 'authorities', label: 'Mint and freeze authority', value: 'unknown', status: 'unknown', basis: 'not applicable', detail: 'There is no Solana mint, so no authority is logged. The NEAR token has no mint method in the launcher.' },
  ];
}

/** Safety tiles for an instant token (CO-7 4.3). The "authorities null" tile does not appear. */
export function instantTiles(a: { totalSupply: string | null; info: InstantInfo | null | undefined; sched: VestSchedule; safety: SafetyIndicator[]; payout: string; openingNow: string | null; top10Bps: number | null }): import('./tiles').SafetyTile[] {
  const lp = indicator(a.safety, 'lp_in_pool');
  const lpOk = !!lp && lp.status === 'pass' && lp.basis !== 'not_indexed';
  const pct = a.info?.creator_alloc_bps !== undefined ? fmtBps(a.info.creator_alloc_bps) : null;
  const s = a.sched;
  return [
    lpOk ? { id: 'lp', label: 'Liquidity', value: 'Seeded; no LP withdrawal method', status: 'pass', basis: lp!.basis, detail: 'A property of the unreviewed market contract, not an audit.' }
      : { id: 'lp', label: 'Liquidity', value: 'unknown', status: 'unknown', basis: 'not logged' },
    a.totalSupply ? { id: 'supply', label: 'Fixed supply', value: `${fmtUnits(a.totalSupply, 6, 0)} tokens`, status: 'info', basis: 'contract ABI', detail: 'The launcher has no mint method. The factory publisher key is disclosed.' }
      : { id: 'supply', label: 'Fixed supply', value: 'unknown', status: 'unknown', basis: 'not logged' },
    s.allocated !== null
      ? { id: 'alloc', label: 'Creator allocation', value: `${pct ?? ''}${pct ? ', ' : ''}unlocked ${s.unlocked !== null ? fmtUnits(s.unlocked, 6, 0) : 'unknown'}, claimed ${s.claimed !== null ? fmtUnits(s.claimed, 6, 0) : 'unknown'}`, status: 'info', basis: s.basis, detail: s.next }
      : { id: 'alloc', label: 'Creator allocation', value: 'unknown', status: 'unknown', basis: 'not logged' },
    { id: 'payout', label: 'Payout recipient', value: a.payout, status: 'info', basis: 'event', detail: 'Fixed at launch.' },
    a.openingNow ? { id: 'opening', label: 'Opening fee', value: a.openingNow, status: 'info', basis: 'event' } : { id: 'opening', label: 'Opening fee', value: 'unknown', status: 'unknown', basis: 'terms not logged' },
    { id: 'solana', label: 'Solana mint', value: 'None (NEAR only)', status: 'info', basis: 'launcher ABI' },
    a.top10Bps === null ? { id: 'top10', label: 'Top 10 holders', value: 'unknown', status: 'unknown', basis: 'not loaded' }
      : { id: 'top10', label: 'Top 10 holders', value: fmtBps(a.top10Bps), status: 'info', basis: 'indexed estimate', detail: 'Excludes the liquidity pool and may include the creator.' },
  ];
}

export interface LaunchStep { id: string; label: string; state: 'done' | 'current' | 'pending' | 'unknown'; receipt?: string; note?: string }

/** Instant launches have three steps, not a trial lifecycle: Created, Seeded, Trading. Receipts come from the launcher's events. */
export function instantSteps(a: { poolOpen: boolean; status: string; timeline?: { event: string; receipt_id: string }[]; info: InstantInfo | null | undefined }): LaunchStep[] {
  const ev = (n: string) => a.timeline?.find((e) => e.event === n);
  const st = a.status.toLowerCase();
  const known = !!a.info || !!a.timeline?.length || a.poolOpen || st !== '';
  const created = !!ev('instant_created') || !!a.info || a.poolOpen || ['launching', 'trading', 'seeded', 'tokenready', 'handoff'].includes(st);
  const seeded = !!ev('instant_seeded') || a.poolOpen || ['seeded', 'handoff', 'trading'].includes(st) || a.info?.seeded_at_ns !== undefined && a.info.seeded_at_ns !== null && a.info.seeded_at_ns !== 0 && a.info.seeded_at_ns !== '0';
  const steps: LaunchStep[] = [
    { id: 'created', label: 'Created', state: created ? 'done' : known ? 'pending' : 'unknown', receipt: ev('instant_created')?.receipt_id, note: created ? 'The token exists with its whole supply.' : undefined },
    { id: 'seeded', label: 'Seeded', state: seeded ? 'done' : known ? 'pending' : 'unknown', receipt: ev('instant_seeded')?.receipt_id, note: seeded ? 'The creator put USDC in as the starting liquidity.' : 'Waiting for the creator to seed the pool.' },
    { id: 'trading', label: 'Trading', state: a.poolOpen ? 'done' : known ? 'pending' : 'unknown', receipt: ev('instant_opened')?.receipt_id },
  ];
  const i = steps.findIndex((s) => s.state === 'pending');
  if (i >= 0) steps[i] = { ...steps[i]!, state: 'current' };
  return steps;
}
