'use client';
// Orchestrates the token page: loads each section independently, keeps the chart, trades and header live over SSE,
// and lays the panels out mobile-first (one column, trade panel right under the chart; two columns from 1024 px).
import { useCallback, useEffect, useState } from 'react';
import { useCandles, useCreatorEarnings, useDepth, useEpochTrades, useHolders, useLaunchDetail, useLiveStream, useNowSec, useTokenBundle, useTrades } from '@/lib/market/hooks';
import type { Interval, Trade } from '@/lib/market/types';
import { CreatorPanel } from './CreatorPanel';
import { EnsureWallet } from './EnsureWallet';
import { FeePanel } from './FeePanel';
import { HoldersPanel } from './HoldersPanel';
import { MechanicsPanel } from './MechanicsPanel';
import { PoolPanel } from './PoolPanel';
import { PriceChart } from './PriceChart';
import { PriceHeader } from './PriceHeader';
import { SafetyPanel } from './SafetyPanel';
import { Skeleton } from './shared';
import { TradePanel } from './TradePanel';
import { TradesFeed } from './TradesFeed';
import { WhereToTrade } from './WhereToTrade';
import './market.css';

interface Live { price: number; q: string | null; t: string | null; block: number }

export function TokenView({ id }: { id: string }) {
  return <EnsureWallet><TokenBody id={id} /></EnsureWallet>;
}

function TokenBody({ id }: { id: string }) {
  const [interval, setInterval_] = useState<Interval>('1h');
  const [live, setLive] = useState<Live | null>(null);
  const nowSec = useNowSec();
  const { bundle, reload: reloadBundle } = useTokenBundle(id);
  const { candles, reload: reloadCandles, applyCandle, applyTrade } = useCandles(id, interval);
  const { trades, reload: reloadTrades, push } = useTrades(id);
  const [holders, reloadHolders] = useHolders(id);
  const [depth, reloadDepth] = useDepth(id);
  const [detail, reloadDetail] = useLaunchDetail(id);
  const [epochs, reloadEpochs] = useEpochTrades(id);
  const recipient = bundle.status === 'ready' ? (bundle.data.page.creator?.payout_recipient ?? bundle.data.page.launch.payout_recipient) : undefined;
  const [earnings, reloadEarnings] = useCreatorEarnings(id, recipient);

  const refreshAfterTrade = useCallback(() => {
    // The indexer needs a moment to see the receipt; refresh twice so the page catches up without a manual reload.
    for (const ms of [4000, 12000]) setTimeout(() => { reloadBundle(); reloadTrades(); reloadHolders(); reloadDepth(); reloadEarnings(); reloadCandles(); }, ms);
  }, [reloadBundle, reloadTrades, reloadHolders, reloadDepth, reloadEarnings, reloadCandles]);

  const onTrade = useCallback((t: Trade) => {
    push(t);
    if (interval !== '1m') applyTrade(t);
    setLive((p) => (p && p.block > t.block_height ? p : { price: t.price, q: t.quote_reserve_after ?? null, t: t.token_reserve_after ?? null, block: t.block_height }));
  }, [push, applyTrade, interval]);
  const streamState = useLiveStream(id, {
    trade: onTrade,
    candle: (c) => { if (interval === '1m') applyCandle(c); },
    launch: reloadBundle,
  });

  // Header stats are a snapshot; refresh them on a slow timer as a fallback when the stream is down.
  useEffect(() => { const t = window.setInterval(reloadBundle, 30_000); return () => window.clearInterval(t); }, [reloadBundle]);

  if (bundle.status === 'loading') return <div className="mkt-root" aria-busy="true"><Skeleton lines={2} height={36} /><div style={{ height: 16 }} /><Skeleton lines={8} height={28} /></div>;
  if (bundle.status === 'error') {
    return (
      <div className="mkt-root">
        <section className="mkt-panel" aria-labelledby="mkt-err-h" role="alert">
          <header><h2 id="mkt-err-h">{bundle.kind === 'not_found' ? 'No such launch' : 'The market data service did not answer'}</h2></header>
          <p>{bundle.kind === 'not_found' ? `Launch ${id} is not known to the indexer.` : 'The indexer API is unreachable, so no prices or trades can be shown. Nothing here is guessed or cached.'}</p>
          <p><a href="/launches">Browse launches</a>{bundle.kind !== 'not_found' && <> or <button type="button" className="mkt-link" onClick={reloadBundle}>try again</button></>}</p>
        </section>
      </div>
    );
  }

  const { page, facts } = bundle.data;
  const reserves = live && live.q && live.t ? { q: live.q, t: live.t } : { q: page.pool.quote_reserve, t: page.pool.token_reserve };
  return (
    <div className="mkt-root">
      <PriceHeader page={page} facts={facts} livePrice={live?.price} paused={page.pool.paused} />
      <div className="mkt-grid">
        <div className="mkt-col">
          <div className="mkt-o1"><PriceChart candles={candles} interval={interval} onInterval={setInterval_} stream={streamState} onRetry={reloadCandles} symbol={page.launch.symbol} /></div>
          <div className="mkt-o3"><TradesFeed trades={trades} nowSec={nowSec} onRetry={reloadTrades} /></div>
          <div className="mkt-o8"><HoldersPanel holders={holders} onRetry={reloadHolders} /></div>
          <div className="mkt-o9"><MechanicsPanel launchId={id} detail={detail} epochTrades={epochs} openedAtSec={facts.openedAtSec} onRetry={() => { reloadDetail(); reloadEpochs(); }} /></div>
        </div>
        <div className="mkt-col">
          <div className="mkt-o2"><TradePanel page={page} facts={facts} reserves={reserves} nowSec={nowSec} onSubmitted={refreshAfterTrade} /></div>
          <div className="mkt-o6"><PoolPanel pool={{ ...page.pool, quote_reserve: reserves.q, token_reserve: reserves.t }} symbol={page.launch.symbol} depth={depth} onRetry={reloadDepth} /></div>
          <div className="mkt-o4"><SafetyPanel page={page} /></div>
          <div className="mkt-o5"><FeePanel page={page} facts={facts} nowSec={nowSec} /></div>
          <div className="mkt-o7"><CreatorPanel page={page} facts={facts} earnings={earnings} onClaimed={refreshAfterTrade} onRetry={reloadEarnings} /></div>
          <div className="mkt-o10"><WhereToTrade page={page} facts={facts} /></div>
        </div>
      </div>
      <p className="mkt-disclosure">Unreviewed market contract on NEAR testnet: a capped constant-product pool. No independent audit. Every number above comes from the indexer API or a chain read and is labelled with its source. Nothing here is investment advice.</p>
    </div>
  );
}
