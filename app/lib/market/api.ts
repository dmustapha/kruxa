// Typed reads of the indexer API. Every function throws ApiError with a stable `kind` so the UI can render honest states.
import { MARKET_CONFIG } from './config';
import { readSnapshot } from '../api/snapshot';
import type { VerifyData, CandleSeries, CreatorDesk, LaunchDetail, HolderList, Interval, PoolDepth, TokenPageData, TradeList } from './types';

export type ApiErrorKind = 'not_found' | 'unavailable' | 'bad_response';
export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string, readonly status?: number) { super(message); this.name = 'ApiError'; }
}

export type Fetcher = typeof fetch;

async function getJson<T>(path: string, f: Fetcher, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try { res = await f(`${MARKET_CONFIG.apiBase}${path}`, { signal, headers: { accept: 'application/json' } }); }
  catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    const [p, qs] = path.split('?');
    const recorded = await readSnapshot(p!, new URLSearchParams(qs ?? ''));
    if (recorded !== null) return recorded as T;
    throw new ApiError('unavailable', 'The indexer API did not answer.');
  }
  if (res.status === 404) throw new ApiError('not_found', 'No such launch.', 404);
  if (!res.ok) throw new ApiError('unavailable', `The indexer API answered ${res.status}.`, res.status);
  try { return (await res.json()) as T; }
  catch { throw new ApiError('bad_response', 'The indexer API sent something that is not JSON.'); }
}

const id = (launchId: string): string => encodeURIComponent(launchId);

export const fetchToken = (launchId: string, f: Fetcher = fetch, s?: AbortSignal) => getJson<TokenPageData>(`/api/token/${id(launchId)}`, f, s);
export const fetchCandles = (launchId: string, interval: Interval, f: Fetcher = fetch, s?: AbortSignal) =>
  getJson<CandleSeries>(`/api/token/${id(launchId)}/candles?interval=${interval}&limit=500`, f, s);
export const fetchTrades = (launchId: string, limit = 30, f: Fetcher = fetch, s?: AbortSignal) =>
  getJson<TradeList>(`/api/token/${id(launchId)}/trades?limit=${limit}`, f, s);
export const fetchHolders = (launchId: string, limit = 10, f: Fetcher = fetch, s?: AbortSignal) =>
  getJson<HolderList>(`/api/token/${id(launchId)}/holders?limit=${limit}`, f, s);
export const fetchDepth = (launchId: string, f: Fetcher = fetch, s?: AbortSignal) => getJson<PoolDepth>(`/api/token/${id(launchId)}/depth`, f, s);
export const fetchCreatorDesk = (account: string, f: Fetcher = fetch, s?: AbortSignal) => getJson<CreatorDesk>(`/api/creator/${encodeURIComponent(account)}`, f, s);
export const fetchLaunch = (launchId: string, f: Fetcher = fetch, s?: AbortSignal) => getJson<LaunchDetail>(`/api/launch/${id(launchId)}`, f, s);
export const fetchVerify = (launchId: string, f: Fetcher = fetch, s?: AbortSignal) => getJson<VerifyData>(`/api/verify/${id(launchId)}`, f, s);
