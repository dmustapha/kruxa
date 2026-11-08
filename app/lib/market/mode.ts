// Launch mode. Only two values exist and only two labels: 'Trial-verified' and 'Instant (no trial)'. The mode is read from the API
// (`launch.mode` or `pool.mode`, which the market derives from the authenticated seed sender), falling back to the instant id range
// (launch_id >= 1_000_000_000, INSTANT-ABI). It is never inferred from anything a creator typed.
import { INSTANT_ID_BASE } from './config';
import type { LaunchMode, LaunchSummary, PoolInfo } from './types';

export const MODE_LABEL: Record<LaunchMode, string> = { trial: 'Trial-verified', instant: 'Instant (no trial)' };

export function launchMode(l: Pick<LaunchSummary, 'launch_id' | 'mode'>, pool?: Pick<PoolInfo, 'mode'> | null): LaunchMode {
  if (l.mode === 'instant' || l.mode === 'trial') return l.mode;
  if (pool?.mode === 'instant' || pool?.mode === 'trial') return pool.mode;
  try { return BigInt(l.launch_id) >= INSTANT_ID_BASE ? 'instant' : 'trial'; } catch { return 'trial'; }
}

export const INSTANT_NOTICE_TITLE = 'Launched instantly: no trial, no refund, no verdict';
export const INSTANT_NOTICE_BODY = 'Nobody committed refundable money first, there was no verdict and no Walk. Buyers cannot get a refund. Higher risk.';
export const RISK_PAGE = '/legal/risk';
