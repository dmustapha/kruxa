// Thin typed GET client for the indexer API. Never throws a bare TypeError at the UI: every failure is an ApiError with a code.
import { CONFIG } from '../config';
import { markSnapshotServed, readSnapshot } from './snapshot';

export type ApiErrorCode = 'unreachable' | 'timeout' | 'not_found' | 'bad_request' | 'unavailable' | 'bad_response';

export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number | null;
  constructor(code: ApiErrorCode | string, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, query?: Query, base: string = CONFIG.api): string {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function apiGet<T>(path: string, query?: Query, opts: { signal?: AbortSignal; timeoutMs?: number; base?: string } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), opts.timeoutMs ?? 8000);
  opts.signal?.addEventListener('abort', () => ctl.abort(opts.signal?.reason));
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query, opts.base), { signal: ctl.signal, headers: { accept: 'application/json' } });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const timedOut = ctl.signal.aborted;
    const recorded = await readSnapshot(path, query);
    if (recorded !== null) return recorded as T;
    throw new ApiError(timedOut ? 'timeout' : 'unreachable', timedOut ? 'The indexer did not answer in time.' : 'The indexer could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try { body = await res.json(); } catch { throw new ApiError('bad_response', 'The indexer returned something that is not JSON.', res.status); }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error;
    const code = err?.code ?? (res.status === 404 ? 'not_found' : res.status === 400 ? 'bad_request' : 'unavailable');
    throw new ApiError(code, err?.message ?? `The indexer answered ${res.status}.`, res.status);
  }
  // A snapshot-mode API (services/api snapshot.ts serve) answers 200 with this header: show the RECORDED strip, never pass it off as live.
  if (res.headers.get('x-kruxa-data') === 'snapshot') markSnapshotServed((body as { as_of?: { block_time?: number | null } })?.as_of?.block_time ?? null);
  return body as T;
}

export const api = {
  health: () => apiGet<import('./types').Health>('/api/health'),
  launches: (q?: Query) => apiGet<import('./types').LaunchList>('/api/launches', q),
  launch: (id: string) => apiGet<import('./types').LaunchDetail>(`/api/launch/${encodeURIComponent(id)}`),
  verify: (id: string) => apiGet<import('./types').VerifyData>(`/api/verify/${encodeURIComponent(id)}`),
  creator: (account: string) => apiGet<import('./types').CreatorDesk>(`/api/creator/${encodeURIComponent(account)}`),
  portfolio: (account: string) => apiGet<import('./types').Portfolio>(`/api/portfolio/${encodeURIComponent(account)}`),
  stats: () => apiGet<import('./types').Stats>('/api/stats'),
  opsLog: (q?: Query) => apiGet<import('./types').OpsLog>('/api/ops-log', q),
};

export const creatorCsvUrl = (account: string): string => buildUrl(`/api/export/creator/${encodeURIComponent(account)}/claims.csv`);
