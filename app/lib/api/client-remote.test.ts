import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

const recorded = (blockTime: number) => new Response(JSON.stringify({ items: [], as_of: { block_time: blockTime } }), { status: 200 });

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('./client');
}

describe('apiGet with NEXT_PUBLIC_SNAPSHOT_BASE_URL', () => {
  it('with no live API configured, reads the remote snapshot and never touches localhost', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => recorded(5));
    const { apiGet } = await load({ NEXT_PUBLIC_SNAPSHOT_BASE_URL: 'https://o.github.io/kruxa/' });
    await apiGet('/api/launches');
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(['https://o.github.io/kruxa/api/launches.json']);
  });
  it('says so honestly when the page is not in the snapshot', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 404 }));
    const { apiGet } = await load({ NEXT_PUBLIC_SNAPSHOT_BASE_URL: 'https://o.github.io/kruxa' });
    await expect(apiGet('/api/portfolio/nobody.testnet')).rejects.toMatchObject({ name: 'ApiError', code: 'not_found' });
  });
  it('with a live API configured, asks it first and falls back to the remote snapshot on a network failure or a 5xx', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      if (String(u).startsWith('https://api.example')) throw new TypeError('fetch failed');
      return recorded(9);
    });
    const { apiGet } = await load({ NEXT_PUBLIC_KRUXA_API: 'https://api.example', NEXT_PUBLIC_SNAPSHOT_BASE_URL: 'https://o.github.io/kruxa' });
    expect(await apiGet('/api/stats')).toMatchObject({ as_of: { block_time: 9 } });
    f.mockImplementation(async (u) => (String(u).startsWith('https://api.example') ? new Response('<html>bad gateway', { status: 502 }) : recorded(10)));
    expect(await apiGet('/api/stats')).toMatchObject({ as_of: { block_time: 10 } });
  });
  it('keeps today\'s behaviour when the variable is unset: a 5xx stays an error and nothing remote is read', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'unavailable', message: 'down' } }), { status: 503 }));
    const { apiGet } = await load({ NEXT_PUBLIC_KRUXA_API: 'https://api.example' });
    await expect(apiGet('/api/stats')).rejects.toMatchObject({ code: 'unavailable', status: 503 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('ignores a snapshot base that is not an absolute http(s) URL', async () => {
    const { parseSnapshotBase } = await import('../config');
    expect(parseSnapshotBase('')).toBe('');
    expect(parseSnapshotBase('/snapshot')).toBe('');
    expect(parseSnapshotBase('javascript:alert(1)')).toBe('');
    expect(parseSnapshotBase('https://o.github.io/kruxa/')).toBe('https://o.github.io/kruxa');
  });
});
