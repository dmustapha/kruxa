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
export const getPosition = (id: string, holder: string) => view<PositionView | null>('get_position', { launch_id: id, holder });
export const requiredDeposit = (params: Record<string, unknown>) => view<string>('required_deposit', { params });

export interface StreamStatus {
  recipient: string; total: string; cap: string; drawn: string; inflight: string; drawable: string; starts_at: string; ends_at: string; paused: boolean;
}
export interface Settlement {
  pass: boolean; reasons: number; settled_at: string; total_active: string; accepted: string; launch_fee: string; lp_quote: string;
  stream: string; excess_pool: string; inputs_hash: string; book_hash: string;
}
export interface PositionView {
  holder: string; seq: number; deliver: string; contributed: string; open_native: string; open_intents: string; due_native: string; due_intents: string;
  inflight: string; refunded: string; spent: string; tokens_entitled: string; bonus_entitled: string; claimed: string; settled: boolean; conserved: boolean;
}
export interface ContributionPreview { ok: boolean; net?: string; code?: string; detail?: string }

export const streamStatus = (id: string) => view<StreamStatus | null>('stream_status', { launch_id: id });
export const listPositions = (id: string, from: number, limit = 50) => view<PositionView[]>('list_positions', { launch_id: id, from_seq: from, limit });
export const getLedger = (id: string) => view<Record<string, string> | null>('get_ledger', { launch_id: id });
export const getConfigView = () => view<Record<string, unknown>>('get_config');
export const previewContribution = (id: string, holder: string, amountMicro: string, relayFee: string | null) =>
  view<ContributionPreview>('preview_contribution', { launch_id: id, holder, amount: amountMicro, relay_fee: relayFee });

export interface CreatorStatus { recipient: string; accrued: string; unlocked: string; paid: string; claimable: string; epochs?: number }
export const creatorStatus = (id: string) => view<CreatorStatus | null>('creator_status', { launch_id: id }, CONFIG.market);
/** NEP-145: a non-null storage balance means the account is registered on USDC and can receive it. */
export const usdcRegistered = async (account: string): Promise<boolean> => (await view<unknown>('storage_balance_of', { account_id: account }, CONFIG.usdc)) !== null;
