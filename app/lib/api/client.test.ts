import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, buildUrl } from './client';

afterEach(() => vi.restoreAllMocks());
const respond = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('apiGet', () => {
  it('builds query strings and skips empty values', () => expect(buildUrl('/api/launches', { stage: 'open', q: '', limit: 24, x: undefined }, 'http://h')).toBe('http://h/api/launches?stage=open&limit=24'));
  it('returns the parsed body', async () => { respond(200, { items: [] }); expect(await apiGet('/api/launches')).toEqual({ items: [] }); });
  it('maps an API error body to ApiError with its code', async () => {
    respond(404, { error: { code: 'not_found', message: 'no launch 9' } });
    await expect(apiGet('/api/launch/9')).rejects.toMatchObject({ name: 'ApiError', code: 'not_found', status: 404, message: 'no launch 9' });
  });
  it('maps a network failure to code unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(apiGet('/api/health')).rejects.toMatchObject({ code: 'unreachable' });
  });
  it('maps non-JSON to bad_response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(apiGet('/api/health')).rejects.toBeInstanceOf(ApiError);
  });
});
