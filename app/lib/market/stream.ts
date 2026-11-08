// SSE price stream (GET /api/stream?launch_id=). EventSource reconnects on its own and resends Last-Event-ID, so this only
// parses events and reports connection state. Heartbeats prove the stream is alive and are never shown as trades.
import { MARKET_CONFIG } from './config';
import type { Candle, LaunchSummary, StreamEvent, Trade } from './types';

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unsupported';
export interface StreamHandlers { onEvent(e: StreamEvent): void; onState(s: StreamState): void }
export type EventSourceCtor = new (url: string) => EventSource;

export function parseStreamEvent(type: string, data: string): StreamEvent | null {
  if (type === 'hello') return { kind: 'hello' };
  let json: unknown;
  try { json = JSON.parse(data); } catch { return null; }
  if (typeof json !== 'object' || json === null) return null;
  if (type === 'trade') return { kind: 'trade', trade: json as Trade };
  if (type === 'candle') return { kind: 'candle', candle: json as Candle & { launch_id?: string } };
  if (type === 'launch') return { kind: 'launch', launch: json as LaunchSummary };
  return null;
}

/** Opens the stream for one launch. Returns a close function. */
export function openStream(launchId: string, h: StreamHandlers, ES: EventSourceCtor | undefined = typeof EventSource === 'undefined' ? undefined : EventSource): () => void {
  if (!ES) { h.onState('unsupported'); return () => {}; }
  h.onState('connecting');
  const es = new ES(`${MARKET_CONFIG.apiBase}/api/stream?launch_id=${encodeURIComponent(launchId)}`);
  es.onopen = () => h.onState('live');
  es.onerror = () => h.onState('reconnecting');
  for (const type of ['hello', 'trade', 'candle', 'launch']) {
    es.addEventListener(type, (m) => {
      const ev = parseStreamEvent(type, (m as MessageEvent<string>).data);
      if (ev) h.onEvent(ev);
    });
  }
  es.addEventListener('heartbeat', () => h.onState('live'));
  return () => es.close();
}
