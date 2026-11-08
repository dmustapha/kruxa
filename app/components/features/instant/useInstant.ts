'use client';
// Reads one instant launch from the launcher's views over RPC (the authority for status and next action). Polls while something is moving.
import { useApi } from '@/lib/api/useApi';
import { ApiError } from '@/lib/api/client';
import { getInstant, getInstantPhase, getVesting, type InstantPhase, type InstantRecord, type VestingView } from '@/lib/instant/preview';

export interface InstantState { phase: InstantPhase | null; record: InstantRecord | null; vesting: VestingView | null }

export function useInstantLaunch(id: string | null) {
  return useApi<InstantState>(
    id
      ? async () => {
          try {
            const [phase, record, vesting] = await Promise.all([getInstantPhase(id), getInstant(id), getVesting(id).catch(() => null)]);
            return { phase, record, vesting };
          } catch (e) {
            const m = (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '';
            throw new ApiError(/does not exist|CodeDoesNotExist/i.test(m) ? 'not_deployed' : 'unreachable', /does not exist|CodeDoesNotExist/i.test(m) ? 'The instant launcher is not deployed on this network.' : `The NEAR RPC could not be read: ${m}`);
          }
        }
      : null,
    `instant-${id}`,
    10000,
  );
}

export const FINAL_DEAD = ['CreationFailed', 'Abandoned', 'Aborted'];

import { launcherConfig, limitsFrom } from '@/lib/instant/preview';
import { unitInfo, type UnitInfo } from '@/lib/instant/rules';

/** The launcher's `get_config` as the app needs it: the unit (never assumed to be a day) and the limits. */
export function useLauncherUnit(): { unit: UnitInfo; unitNs: string | null; known: boolean } {
  const s = useApi(() => launcherConfig(), 'launcher-config-unit');
  const cfg = s.status === 'ok' && s.data.kind === 'ok' ? s.data.config : null;
  const unitNs = limitsFrom(cfg).unitNs;
  return { unit: unitInfo(unitNs), unitNs, known: unitNs !== null };
}
