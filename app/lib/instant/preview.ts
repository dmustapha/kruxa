// Asks the launcher what it thinks of an instant Charter (`preview_instant`, INSTANT-ABI section 7). If the launcher is not deployed or not
// reachable the answer is "unreachable" or "not_deployed" and the caller shows the local mirror, labelled as such.
import { CONFIG } from '../config';
import { view as nearView } from '../near';
import { toInstantJson, type InstantParams } from './rules';

export interface LauncherViolation { code: string; field?: string; got?: string; limit?: string }
export type LauncherAnswer =
  | { kind: 'ok'; deposit: string | null; poolSeed: string | null; openPrice: string | null }
  | { kind: 'refused'; violations: LauncherViolation[] }
  | { kind: 'not_deployed'; message: string }
  | { kind: 'unreachable'; message: string };

type View = (method: string, args?: Record<string, unknown>, contractId?: string) => Promise<unknown>;
const first = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'unknown error';

export async function askLauncher(p: InstantParams, creator: string | null, payout: string | null, view: View = nearView as View): Promise<LauncherAnswer> {
  try {
    const out = (await view('preview_instant', { params: toInstantJson(p), creator, payout_recipient: payout }, CONFIG.instant)) as {
      ok?: boolean; violations?: LauncherViolation[]; required_deposit?: string; pool_seed_q?: string; open_price_micro_per_token?: string;
    } | null;
    if (!out || typeof out.ok !== 'boolean') return { kind: 'unreachable', message: 'The launcher returned an unexpected answer.' };
    if (out.ok) return { kind: 'ok', deposit: out.required_deposit ?? null, poolSeed: out.pool_seed_q ?? null, openPrice: out.open_price_micro_per_token ?? null };
    return { kind: 'refused', violations: out.violations ?? [] };
  } catch (e) {
    const m = first(e);
    return /does not exist|CodeDoesNotExist|AccountDoesNotExist|MethodNotFound|no such method/i.test(m) ? { kind: 'not_deployed', message: m } : { kind: 'unreachable', message: m };
  }
}

export interface LauncherConfig { creator_gate?: boolean; paused?: string; profile?: string; launch_fee?: string }
export async function launcherConfig(view: View = nearView as View): Promise<{ kind: 'ok'; config: LauncherConfig } | { kind: 'not_deployed' | 'unreachable'; message: string }> {
  try { return { kind: 'ok', config: (await view('get_config', {}, CONFIG.instant)) as LauncherConfig }; } catch (e) {
    const m = first(e);
    return { kind: /does not exist|CodeDoesNotExist|AccountDoesNotExist|MethodNotFound/i.test(m) ? 'not_deployed' : 'unreachable', message: m };
  }
}

export interface InstantPhase { status: string; step: 'create' | 'seed' | 'open' | 'done' | 'dead'; next_action: 'seed' | 'open_instant' | 'retry_open_instant' | 'none'; can_cancel?: boolean }
export interface InstantRecord {
  launch_id: string; status: string; creator: string; payout_recipient: string; name: string; symbol: string; token: string | null; n_alloc: string; n_pool: string;
  creator_alloc_bps: number; cliff_days: number; vest_days: number; seed_q: string; launch_fee: string; pool_seed_q: string; opened_at_ns?: string; alloc_claimed?: string;
}
export interface VestingView { recipient: string; total: string; unlocked: string; claimed: string; claimable: string; cliff_end_ns: string; vest_end_ns: string }

export const getInstantPhase = (id: string, view: View = nearView as View) => view('get_phase', { launch_id: id }, CONFIG.instant) as Promise<InstantPhase | null>;
export const getInstant = (id: string, view: View = nearView as View) => view('get_instant', { launch_id: id }, CONFIG.instant) as Promise<InstantRecord | null>;
export const getVesting = (id: string, view: View = nearView as View) => view('get_vesting', { launch_id: id }, CONFIG.instant) as Promise<VestingView | null>;
export const instantsByCreator = (account: string, view: View = nearView as View) => view('instants_by_creator', { account }, CONFIG.instant) as Promise<string[]>;

export const INSTANT_ID_BASE = 1_000_000_000n;
export const isInstantId = (id: string): boolean => /^\d{1,20}$/.test(id) && BigInt(id) >= INSTANT_ID_BASE;
