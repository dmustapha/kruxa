import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet } from './client';
import { filterFeed, readSnapshot, resetSnapshotServed, snapshotFile, snapshotServed } from './snapshot';

afterEach(() => { vi.restoreAllMocks(); resetSnapshotServed(); });

const item = (id: string, over: Record<string, unknown> = {}) => ({ launch_id: id, symbol: `S${id}`, creator: `c${id}.testnet`, stage: 'open', ...over });
const feed = { items: [item('1'), item('2', { stage: 'failed', verdict: 'FAIL' }), item('3', { mode: 'instant', stage: 'trading', has_market: true })], next_cursor: null, as_of: { block_height: 9, block_time: 1700000000 }, source: 'chain' };

describe('snapshotFile', () => {
  it('maps the API read paths that the snapshot script writes', () => {
    expect(snapshotFile('/api/health')).toBe('/snapshot/api/health.json');
    expect(snapshotFile('/api/launches')).toBe('/snapshot/api/launches.json');
    expect(snapshotFile('/api/launch/7')).toBe('/snapshot/api/launch/7.json');
    expect(snapshotFile('/api/token/7')).toBe('/snapshot/api/token/7.json');
    expect(snapshotFile('/api/token/7/candles', { interval: '1h' })).toBe('/snapshot/api/token/7/candles-1h.json');
  });
  it('has no snapshot for anything else, including other candle intervals and per-account reads', () => {
    expect(snapshotFile('/api/token/7/candles', { interval: '9h' })).toBeNull();
    expect(snapshotFile('/api/token/7/candles', { interval: '1h', from: 5 })).toBeNull();
    expect(snapshotFile('/api/token/7/trades', { before: 'abc' })).toBeNull();
    expect(snapshotFile('/api/ops-log', { before: 'abc' })).toBeNull();
    expect(snapshotFile('/api/ops-log', { scope: 'weird' })).toBeNull();
    expect(snapshotFile('/api/portfolio/bad%20name')).toBeNull();
    expect(snapshotFile('/api/export/launches.csv')).toBeNull();
    expect(snapshotFile('/api/launch/abc')).toBeNull();
  });
  it('maps every other read the app makes (stats, candles, trades, holders, depth, verify, ops, per-account)', () => {
    expect(snapshotFile('/api/stats')).toBe('/snapshot/api/stats.json');
    expect(snapshotFile('/api/ops-log', { limit: 50 })).toBe('/snapshot/api/ops-log.json');
    expect(snapshotFile('/api/ops-log', { scope: 'core' })).toBe('/snapshot/api/ops-log-core.json');
    expect(snapshotFile('/api/token/7/candles', { interval: '1m' })).toBe('/snapshot/api/token/7/candles-1m.json');
    expect(snapshotFile('/api/token/7/candles?interval=5m&limit=500')).toBe('/snapshot/api/token/7/candles-5m.json');
    expect(snapshotFile('/api/token/7/trades?limit=20')).toBe('/snapshot/api/token/7/trades.json');
    expect(snapshotFile('/api/token/7/holders')).toBe('/snapshot/api/token/7/holders.json');
    expect(snapshotFile('/api/token/7/depth')).toBe('/snapshot/api/token/7/depth.json');
    expect(snapshotFile('/api/verify/7')).toBe('/snapshot/api/verify/7.json');
    expect(snapshotFile('/api/launch/7/custody')).toBe('/snapshot/api/launch/7/custody.json');
    expect(snapshotFile('/api/ops/solvency')).toBe('/snapshot/api/ops/solvency.json');
    expect(snapshotFile('/api/portfolio/alice.testnet')).toBe('/snapshot/api/portfolio/alice.testnet.json');
    expect(snapshotFile('/api/creator/near%3Aalice.testnet')).toBe('/snapshot/api/creator/alice.testnet.json');
  });
  it('builds the same path under a remote base', () => {
    expect(snapshotFile('/api/launches', undefined, 'https://o.github.io/kruxa')).toBe('https://o.github.io/kruxa/api/launches.json');
  });
});

describe('filterFeed', () => {
  it('applies q, tab, creator, type and limit as far as recorded fields allow', () => {
    expect(filterFeed(feed, { q: 's2' }).items.map((l) => l.launch_id)).toEqual(['2']);
    expect(filterFeed(feed, { tab: 'failed' }).items.map((l) => l.launch_id)).toEqual(['2']);
    expect(filterFeed(feed, { tab: 'trading' }).items.map((l) => l.launch_id)).toEqual(['3']);
    expect(filterFeed(feed, { tab: 'live' }).items.map((l) => l.launch_id)).toEqual(['1']);
    expect(filterFeed(feed, { launch_type: 'instant' }).items.map((l) => l.launch_id)).toEqual(['3']);
    expect(filterFeed(feed, { creator: 'c1.testnet' }).items.length).toBe(1);
    const f = filterFeed(feed, { limit: 1 });
    expect(f.items.length).toBe(1);
    expect((f as { total?: number }).total).toBe(3);
  });
});

describe('degrade to snapshot', () => {
  it('serves the recorded file when the API is unreachable, and flags it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      if (String(u).startsWith('/snapshot/')) return new Response(JSON.stringify(feed), { status: 200 });
      throw new TypeError('fetch failed');
    });
    const r = await apiGet<typeof feed>('/api/launches', { limit: 24 });
    expect(r.items.length).toBe(3);
    expect(snapshotServed()).toEqual({ at: 1700000000 });
  });
  it('keeps the honest error when there is no snapshot file or no snapshot for that path', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => { if (String(u).startsWith('/snapshot/')) return new Response('nope', { status: 404 }); throw new TypeError('fetch failed'); });
    await expect(apiGet('/api/launches')).rejects.toMatchObject({ code: 'unreachable' });
    await expect(apiGet('/api/portfolio/a.testnet')).rejects.toBeInstanceOf(ApiError);
    expect(snapshotServed()).toBeNull();
  });
  it('never replaces a real API error answer (404 stays 404)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), { status: 404 }));
    await expect(apiGet('/api/launch/9')).rejects.toMatchObject({ code: 'not_found' });
    expect(snapshotServed()).toBeNull();
  });
  it('readSnapshot returns null on a network failure', async () => {
    expect(await readSnapshot('/api/health', undefined, (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('remote snapshot base', () => {
  const bases = ['https://o.github.io/kruxa', '/snapshot'];
  it('reads the remote file first with revalidation, and marks the strip', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ as_of: { block_time: 77 }, items: [] }), { status: 200 }));
    const body = await readSnapshot('/api/stats', undefined, f as unknown as typeof fetch, bases);
    expect(body).toMatchObject({ as_of: { block_time: 77 } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('https://o.github.io/kruxa/api/stats.json', expect.objectContaining({ cache: 'no-cache' }));
    expect(snapshotServed()).toEqual({ at: 77 });
  });
  it('falls through to the local /snapshot when the remote file is missing', async () => {
    const f = vi.fn(async (u: string) => (u.startsWith('https://') ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    expect(await readSnapshot('/api/stats', undefined, f as unknown as typeof fetch, bases)).toEqual({ ok: 1 });
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://o.github.io/kruxa/api/stats.json', '/snapshot/api/stats.json']);
  });
  it('cuts trades to the asked limit and drops the cursor, since a recorded page cannot be paged', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ i }));
    const f = async () => new Response(JSON.stringify({ items, next_cursor: 'x', as_of: { block_time: 1 } }), { status: 200 });
    const body = (await readSnapshot('/api/token/7/trades?limit=5', undefined, f as unknown as typeof fetch, bases)) as { items: unknown[]; next_cursor: string | null };
    expect(body.items.length).toBe(5);
    expect(body.next_cursor).toBeNull();
  });
  it('is only the local /snapshot when the variable is unset', async () => {
    const { snapshotBases } = await import('./snapshot');
    expect(snapshotBases('')).toEqual(['/snapshot']);
    expect(snapshotBases('https://o.github.io/kruxa')).toEqual(['https://o.github.io/kruxa', '/snapshot']);
  });
});
