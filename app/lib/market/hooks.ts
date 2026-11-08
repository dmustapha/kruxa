'use client';
// Data hooks for the token page. Each section loads independently, so one failing endpoint never blanks the page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchLaunch, fetchCandles, fetchCreatorDesk, fetchDepth, fetchHolders, fetchToken, fetchTrades } from './api';
import { getChainInstant, getChainPool, getChainVesting, getCreatorStatus, getMarketConfig, type ChainPool, type MarketConfigView } from './chain';
import { resolveFacts, type MarketFacts } from './facts';
import { applyTradeToSeries, prependTrade, upsertCandle } from './series';
import { openStream, type StreamState } from './stream';
import type { Candle, CreatorEarnings, CreatorClaim, CreatorStatus, StreamMeter, VestingView, HolderList, Interval, PoolDepth, InstantInfo, LaunchDetail, TokenPageData, Trade, TradeList } from './types';

export type Section<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; kind: ApiError['kind']; message: string };
const loading = <T,>(): Section<T> => ({ status: 'loading' });

function toError<T>(e: unknown): Section<T> {
  if (e instanceof ApiError) return { status: 'error', kind: e.kind, message: e.message };
  return { status: 'error', kind: 'unavailable', message: e instanceof Error ? e.message : 'Request failed.' };
}

/** Runs `load` on mount and whenever `deps` change; `reload` forces a refetch without flashing the loading state. */
function useSection<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): [Section<T>, () => void, (u: (d: T) => T) => void] {
  const [state, setState] = useState<Section<T>>(loading<T>());
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback((silent: boolean, signal: AbortSignal) => {
    if (!silent) setState(loading<T>());
    loadRef.current(signal).then((data) => { if (!signal.aborted) setState({ status: 'ready', data }); })
      .catch((e) => { if (!signal.aborted && (e as Error)?.name !== 'AbortError') setState((prev) => (silent && prev.status === 'ready' ? prev : toError<T>(e))); });
  }, []);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    run(false, c.signal);
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const reload = useCallback(() => { const c = ctl.current; if (c && !c.signal.aborted) run(true, c.signal); }, [run]);
  const patch = useCallback((u: (d: T) => T) => setState((p) => (p.status === 'ready' ? { status: 'ready', data: u(p.data) } : p)), []);
  return [state, reload, patch];
}

export interface PageBundle { page: TokenPageData; chain: ChainPool | null; facts: MarketFacts }

export function useTokenBundle(id: string) {
  const [s, reload, patch] = useSection<PageBundle>(async (signal) => {
    const page = await fetchToken(id, fetch, signal);
    const needsChain = !(page.pool.fee_terms && page.pool.token);
    const chain = needsChain && page.pool.open ? await getChainPool(id) : null;
    return { page, chain, facts: resolveFacts(page, chain) };
  }, [id]);
  return { bundle: s, reload, patch };
}

export function useCandles(id: string, interval: Interval) {
  const [s, reload, patch] = useSection<Candle[]>(async (signal) => (await fetchCandles(id, interval, fetch, signal)).candles, [id, interval]);
  const applyCandle = useCallback((c: Candle) => patch((d) => upsertCandle(d, c)), [patch]);
  const applyTrade = useCallback((t: Trade) => patch((d) => applyTradeToSeries(d, t, interval)), [patch, interval]);
  return { candles: s, reload, applyCandle, applyTrade };
}

export function useTrades(id: string) {
  const [s, reload, patch] = useSection<TradeList>((signal) => fetchTrades(id, 30, fetch, signal), [id]);
  const push = useCallback((t: Trade) => patch((d) => ({ ...d, items: prependTrade(d.items, t, 50) })), [patch]);
  return { trades: s, reload, push };
}

export const useLaunchDetail = (id: string) => useSection<LaunchDetail>((signal) => fetchLaunch(id, fetch, signal), [id]);
export const useHolders = (id: string) => useSection<HolderList>((signal) => fetchHolders(id, 10, fetch, signal), [id]);
export const useEpochTrades = (id: string) => useSection<TradeList>((signal) => fetchTrades(id, 200, fetch, signal), [id]);
export const useDepth = (id: string) => useSection<PoolDepth>((signal) => fetchDepth(id, fetch, signal), [id]);

export interface CreatorBundle { status: CreatorStatus | null; earnings: CreatorEarnings | null; stream: StreamMeter | null; claims: CreatorClaim[]; basis: 'chain' | 'indexer' | 'none' }

/** Creator earnings: the market's own `creator_status` view when reachable, else the indexer's estimate, else none. */
export function useCreatorEarnings(id: string, recipient: string | undefined) {
  return useSection<CreatorBundle>(async (signal) => {
    const status = await getCreatorStatus(id);
    let row: { earnings: CreatorEarnings; stream: StreamMeter | null; claims: CreatorClaim[] } | null = null;
    if (recipient) {
      try {
        const desk = await fetchCreatorDesk(recipient, fetch, signal);
        const hit = desk.launches.find((l) => l.launch.launch_id === id);
        if (hit) row = { earnings: hit.earnings, stream: hit.stream ?? null, claims: (desk.claims ?? []).filter((c) => c.launch_id === id) };
      } catch (e) { if ((e as Error)?.name === 'AbortError') throw e; }
    }
    if (status) return { status, earnings: row?.earnings ?? null, stream: row?.stream ?? null, claims: row?.claims ?? [], basis: 'chain' };
    return row ? { status: null, earnings: row.earnings, stream: row.stream, claims: row.claims, basis: 'indexer' } : { status: null, earnings: null, stream: null, claims: [], basis: 'none' };
  }, [id, recipient]);
}

/** Live stream for one launch. Handlers are kept in a ref so the connection is not rebuilt on every render. */
export function useLiveStream(id: string, on: { trade(t: Trade): void; candle(c: Candle): void; launch(): void }) {
  const [state, setState] = useState<StreamState>('connecting');
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const close = openStream(id, {
      onState: setState,
      onEvent: (e) => {
        if (e.kind === 'trade') ref.current.trade(e.trade);
        else if (e.kind === 'candle') ref.current.candle(e.candle);
        else if (e.kind === 'launch') ref.current.launch();
      },
    });
    return close;
  }, [id]);
  return state;
}

/** Ticking clock in unix seconds, for countdowns. */
export function useNowSec(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export interface InstantBundle { info: InstantInfo | null; vesting: VestingView | null; basis: 'api' | 'chain' | 'none' }

/** Instant launch record and vesting: the API's `instant` object when present, otherwise the launcher's own views. Never guessed. */
export function useInstantData(id: string, enabled: boolean, fromApi: InstantInfo | null | undefined) {
  return useSection<InstantBundle>(async () => {
    if (!enabled) return { info: null, vesting: null, basis: 'none' };
    const [chainInfo, vesting] = await Promise.all([getChainInstant(id), getChainVesting(id)]);
    if (chainInfo || vesting) return { info: { ...(fromApi ?? {}), ...(chainInfo ?? {}) } as InstantInfo, vesting: vesting ?? fromApi?.vesting ?? null, basis: 'chain' };
    return fromApi ? { info: fromApi, vesting: fromApi.vesting ?? null, basis: 'api' } : { info: null, vesting: null, basis: 'none' };
  }, [id, enabled, fromApi?.opened_at_ns, fromApi?.n_alloc]);
}

/** Market config, for the instant sub-cap. Null when the RPC cannot be read. */
export function useMarketConfig(enabled: boolean) {
  return useSection<MarketConfigView | null>(async () => (enabled ? getMarketConfig() : null), [enabled]);
}
