'use client';
// Direct chain reads for one launch (core views over RPC). Independent of the indexer so the page degrades honestly when it is down.
import { useApi } from '@/lib/api/useApi';
import { ApiError } from '@/lib/api/client';
import { getCharter, getState, type Charter, type LaunchState } from '@/lib/near';

export interface ChainLaunch { state: LaunchState | null; charter: Charter | null }

export function useChainLaunch(id: string) {
  return useApi<ChainLaunch>(
    async () => {
      try {
        const [state, charter] = await Promise.all([getState(id), getCharter(id)]);
        return { state, charter };
      } catch (e) {
        throw new ApiError('unreachable', `The NEAR RPC could not be read: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
      }
    },
    `chain-${id}`,
    15000,
  );
}
