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
    expect(snapshotFile('/api/token/7/candles', { interval: '1m' })).toBeNull();
    expect(snapshotFile('/api/portfolio/alice.testnet')).toBeNull();
    expect(snapshotFile('/api/stats')).toBeNull();
    expect(snapshotFile('/api/ops-log')).toBeNull();
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
