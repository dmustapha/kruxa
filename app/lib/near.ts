// Read-only access to the core contract. near-api-js 7.4.0: JsonRpcProvider.callFunction (same call shape as the signed-tests kit).
import { JsonRpcProvider } from 'near-api-js';
import { CONFIG } from './config';

const provider = new JsonRpcProvider({ url: CONFIG.rpcUrl });

export async function view<T = unknown>(method: string, args: Record<string, unknown> = {}, contractId: string = CONFIG.core): Promise<T> {
  return (await provider.callFunction<any>({ contractId, method, args })) as T;
}

export interface LaunchState {
  status: string;
  phase: 'Scheduled' | 'Open' | 'Closing' | 'Ready';
  token: string | null;
  total_active: string;
  active_funders: number;
  holder_count: number;
  positions_unsettled: number;
  charter_hash: string;
  book_hash: string;
}

export interface Charter {
  launch_id: string;
  creator: string;
  opens_at: string;
  commit_end: string;
  walk_end: string;
  params: Record<string, string | number>;
  derived: Record<string, string | number>;
}

export const getState = (id: string) => view<LaunchState | null>('get_state', { launch_id: id });
export const getCharter = (id: string) => view<Charter | null>('get_charter', { launch_id: id });
export const getSettlement = (id: string) => view<Record<string, unknown> | null>('get_settlement', { launch_id: id });
export const getVerdictInputs = (id: string, contractId?: string) => view<{ inputs: Record<string, unknown>; inputs_hash: string } | null>('get_verdict_inputs', { launch_id: id }, contractId);
export const getPosition = (id: string, holder: string) => view<Record<string, unknown> | null>('get_position', { launch_id: id, holder });
export const requiredDeposit = (params: Record<string, unknown>) => view<string>('required_deposit', { params });
