import { describe, expect, it, vi } from 'vitest';
import { ApiError, fetchToken } from './api';
import { viewCall } from './chain';
import { openStream, parseStreamEvent } from './stream';

const resp = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('api', () => {
  it('maps 404, 5xx and network failure to stable kinds', async () => {
    await expect(fetchToken('9', (async () => resp(404, {})) as typeof fetch)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(fetchToken('9', (async () => resp(503, {})) as typeof fetch)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fetchToken('9', (async () => { throw new TypeError('x'); }) as typeof fetch)).rejects.toBeInstanceOf(ApiError);
  });
  it('returns the parsed body', async () => {
    const f = vi.fn(async () => resp(200, { ok: 1 }));
    expect(await fetchToken('1', f as unknown as typeof fetch)).toEqual({ ok: 1 });
    expect((f.mock.calls[0] as unknown[])[0]).toMatch(/\/api\/token\/1$/);
  });
});

describe('chain view', () => {
  it('decodes the RPC byte array', async () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ a: 1 })));
    const f = async () => resp(200, { result: { result: bytes } });
    expect(await viewCall('m', 'x', {}, f, 'http://rpc')).toEqual({ a: 1 });
  });
  it('returns null on any failure instead of guessing', async () => {
    expect(await viewCall('m', 'x', {}, async () => { throw new Error('down'); }, 'http://rpc')).toBeNull();
    expect(await viewCall('m', 'x', {}, async () => resp(200, { error: 'UnknownAccount' }), 'http://rpc')).toBeNull();
    expect(await viewCall('m', 'x', {}, async () => resp(500, {}), 'http://rpc')).toBeNull();
  });
});

describe('stream', () => {
  it('parses known events and drops garbage', () => {
    expect(parseStreamEvent('trade', '{"side":"buy"}')).toMatchObject({ kind: 'trade' });
    expect(parseStreamEvent('candle', '{"t":1}')).toMatchObject({ kind: 'candle' });
    expect(parseStreamEvent('trade', 'not json')).toBeNull();
    expect(parseStreamEvent('nope', '{}')).toBeNull();
  });
  it('reports unsupported when there is no EventSource, and wires state and events otherwise', () => {
    const states: string[] = [];
    openStream('1', { onEvent: () => {}, onState: (s) => states.push(s) }, undefined);
    expect(states).toEqual(['unsupported']);

    const listeners: Record<string, (m: { data: string }) => void> = {};
    const close = vi.fn();
    class FakeES { onopen?: () => void; onerror?: () => void; constructor(public url: string) { (globalThis as { __es?: FakeES }).__es = this; }
      addEventListener(t: string, fn: (m: { data: string }) => void) { listeners[t] = fn; } close = close; }
    const seen: string[] = []; const st: string[] = [];
    const stop = openStream('3', { onEvent: (e) => seen.push(e.kind), onState: (s) => st.push(s) }, FakeES as unknown as new (u: string) => EventSource);
    const es = (globalThis as unknown as { __es: FakeES }).__es;
    expect(es.url).toMatch(/\/api\/stream\?launch_id=3$/);
    es.onopen?.(); listeners.trade?.({ data: '{"side":"sell"}' }); es.onerror?.();
    expect(seen).toEqual(['trade']);
    expect(st).toEqual(['connecting', 'live', 'reconnecting']);
    stop(); expect(close).toHaveBeenCalled();
  });
});
