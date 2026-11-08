// Direct NEAR RPC view reads of the market contract (MARKET-ABI views). No keys, no signing. Used for facts the indexer API does not
// carry yet (fee terms, token account) and for the authoritative creator claimable. Failure returns null: the UI then says "unknown".
import { MARKET_CONFIG } from './config';
import type { CreatorStatus, FeeTerms } from './types';

export type Rpc = (url: string, init: RequestInit) => Promise<Response>;

export async function viewCall<T>(contractId: string, method: string, args: Record<string, unknown>, f: Rpc = fetch, rpcUrl = MARKET_CONFIG.rpcUrl): Promise<T | null> {
  try {
    const argsBase64 = btoa(JSON.stringify(args));
    const res = await f(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'kruxa', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method, args_base64: argsBase64 } }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
    const bytes = body.result?.result;
    if (!bytes || body.result?.error) return null;
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
  } catch { return null; }
}

export interface ChainPool {
  launch_id: string; token: string; quote: string; state: 'AwaitToken' | 'Open';
  q: string; t: string; opened_ns: string | number; payout_recipient: string; total_supply: string; charter_hash: string; terms: FeeTerms;
}

export const getChainPool = (launchId: string, f?: Rpc, market = MARKET_CONFIG.marketAccount) => viewCall<ChainPool | null>(market, 'get_pool', { launch_id: launchId }, f);
export const getCreatorStatus = (launchId: string, f?: Rpc, market = MARKET_CONFIG.marketAccount) => viewCall<CreatorStatus | null>(market, 'creator_status', { launch_id: launchId }, f);
