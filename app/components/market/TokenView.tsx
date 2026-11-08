'use client';
// Orchestrates the token page. Every section loads independently; the chart, trades and header stay live over SSE.
// Desktop (1024 px and up): header, safety tiles, then chart plus tabs on the left and the order panel and DexScreener-style rail on the
// right. Mobile: header, chart, activity, segmented tabs (Trades, Holders, Info, Verify) and a sticky Buy / Sell bar that opens a sheet.
// The page state (trial, failed, genesis, trading, halted) decides what renders; unknown facts are shown as unknown.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { instantSteps, instantTiles, vestSchedule } from '@/lib/market/instant';
import { launchMode } from '@/lib/market/mode';
import { openingWindow } from '@/lib/market/math';
import { fmtBps } from '@/lib/market/format';
import { top10ShareBps } from '@/lib/market/tiles';
import { useCandles, useCreatorEarnings, useDepth, useEpochTrades, useHolders, useInstantData, useMarketConfig, useLaunchDetail, useLiveStream, useNowSec, useTokenBundle, useTrades } from '@/lib/market/hooks';
import { genesisSteps } from '@/lib/market/genesis';
import { buildMarkers } from '@/lib/market/markers';
import { phaseOf, tokenState } from '@/lib/market/phase';
import { safetyTiles } from '@/lib/market/tiles';
import { windowRows } from '@/lib/market/windows';
import type { Interval, Trade } from '@/lib/market/types';
import { AllocationPanel } from './AllocationPanel';
import { ContractFacts } from './ContractFacts';
import { InstantNotice } from './InstantNotice';
import { CreatorPanel } from './CreatorPanel';
import { EnsureWallet } from './EnsureWallet';
import { FeePanel } from './FeePanel';
import { HoldersPanel } from './HoldersPanel';
import { MechanicsPanel } from './MechanicsPanel';
import { PoolPanel } from './PoolPanel';
import { PriceChart } from './PriceChart';
import { PriceHeader } from './PriceHeader';
import { SafetyPanel } from './SafetyPanel';
import { FailedState, GenesisState, HaltedBanner, LaunchFailedState, LaunchingState, TrialState } from './StateCards';
import { OrderSheet, StickyTradeBar, type SheetSide } from './OrderSheet';
import { SafetyTiles } from './SafetyTiles';
import { StatsRail } from './StatsRail';
import { Tabs, type TabDef } from './Tabs';
import { VerifyPanel } from './VerifyPanel';
import { useIsDesktop } from './useMedia';
import { Skeleton } from './shared';
import { TradePanel } from './TradePanel';
import { TradesFeed } from './TradesFeed';
import { WhereToTrade } from './WhereToTrade';
import './market.css';

interface Live { price: number; q: string | null; t: string | null; block: number }

export function TokenView({ id }: { id: string }) {
  return <EnsureWallet><TokenBody id={id} /></EnsureWallet>;
}

const DESKTOP_TABS = ['trades', 'holders', 'mechanics', 'creator', 'verify'];
const MOBILE_TABS = ['trades', 'holders', 'info', 'verify'];

function initialTab(): string {
  try { return new URLSearchParams(window.location.search).get('tab') ?? 'trades'; } catch { return 'trades'; }
}

function TokenBody({ id }: { id: string }) {
  const [interval, setInterval_] = useState<Interval>('1h');
  const [mode, setMode] = useState<'price' | 'mc'>('price');
  const [tab, setTab] = useState('trades');
  const [sheet, setSheet] = useState<SheetSide | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const desktop = useIsDesktop();
  const nowSec = useNowSec();
  const { bundle, reload: reloadBundle } = useTokenBundle(id);
  const { candles, reload: reloadCandles, applyCandle, applyTrade } = useCandles(id, interval);
  const { trades, reload: reloadTrades, push } = useTrades(id);
  const [holders, reloadHolders] = useHolders(id);
  const [depth, reloadDepth] = useDepth(id);
  const [detail, reloadDetail] = useLaunchDetail(id);
  const [wide, reloadWide] = useEpochTrades(id);
  const recipient = bundle.status === 'ready' ? (bundle.data.page.creator?.payout_recipient ?? bundle.data.page.launch.payout_recipient) : undefined;
  const [earnings, reloadEarnings] = useCreatorEarnings(id, recipient);
  const isInstant = bundle.status === 'ready' ? launchMode(bundle.data.page.launch, bundle.data.page.pool) === 'instant' : id.length >= 10 && BigInt(id) >= 1_000_000_000n;
  const [instantData, reloadInstant] = useInstantData(id, isInstant, bundle.status === 'ready' ? bundle.data.page.instant : null);
  const [marketCfg] = useMarketConfig(isInstant);

  useEffect(() => { setTab(initialTab()); }, []);
  const changeTab = useCallback((t: string) => {
    setTab(t);
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u); } catch { /* history may be unavailable */ }
  }, []);

  const refreshAfterTrade = useCallback(() => {
    for (const ms of [4000, 12000]) setTimeout(() => { reloadBundle(); reloadTrades(); reloadHolders(); reloadDepth(); reloadEarnings(); reloadCandles(); reloadWide(); }, ms);
  }, [reloadBundle, reloadTrades, reloadHolders, reloadDepth, reloadEarnings, reloadCandles, reloadWide]);

  const onTrade = useCallback((t: Trade) => {
    push(t);
    if (interval !== '1m') applyTrade(t);
    setLive((p) => (p && p.block > t.block_height ? p : { price: t.price, q: t.quote_reserve_after ?? null, t: t.token_reserve_after ?? null, block: t.block_height }));
  }, [push, applyTrade, interval]);
  const streamState = useLiveStream(id, { trade: onTrade, candle: (c) => { if (interval === '1m') applyCandle(c); }, launch: reloadBundle });
  useEffect(() => { const t = window.setInterval(reloadBundle, 30_000); return () => window.clearInterval(t); }, [reloadBundle]);

  const page = bundle.status === 'ready' ? bundle.data.page : null;
  const facts = bundle.status === 'ready' ? bundle.data.facts : null;
  const asOf = page?.as_of.block_time ?? nowSec;
  const wideTrades = wide.status === 'ready' ? wide.data : null;
  const rows = useMemo(() => (page ? windowRows(page.stats.windows, wideTrades?.items ?? [], asOf, wideTrades ? wideTrades.next_cursor === null : false) : []), [page, wideTrades, asOf]);
  const creatorBundle = earnings.status === 'ready' ? earnings.data : null;
  const markers = useMemo(() => {
    if (!page || candles.status !== 'ready' || candles.data.length === 0) return [];
    const known = [...new Set([page.launch.creator, page.launch.payout_recipient])];
    const from = candles.data[0]!.t; const to = candles.data[candles.data.length - 1]!.t;
    return buildMarkers(wideTrades?.items ?? [], creatorBundle?.claims ?? [], known, interval, { from, to });
  }, [page, candles, wideTrades, creatorBundle, interval]);

  if (bundle.status === 'loading') return <div className="mkt-root" aria-busy="true"><Skeleton lines={2} height={36} /><div style={{ height: 16 }} /><Skeleton lines={8} height={28} /></div>;
  if (bundle.status === 'error' || !page || !facts) {
    const err = bundle.status === 'error' ? bundle : null;
    return (
      <div className="mkt-root">
        <section className="mkt-panel" aria-labelledby="mkt-err-h" role="alert">
          <header><h2 id="mkt-err-h">{err?.kind === 'not_found' ? 'No such launch' : 'The market data service did not answer'}</h2></header>
          <p>{err?.kind === 'not_found' ? `Launch ${id} is not known to the indexer.` : 'The indexer API is unreachable, so no prices or trades can be shown. Nothing here is guessed or cached.'}</p>
          <p><a href="/">Browse launches</a>{err?.kind !== 'not_found' && <> or <button type="button" className="mkt-link" onClick={reloadBundle}>try again</button></>}</p>
        </section>
      </div>
    );
  }

  const state = tokenState(page, nowSec);
  const phase = phaseOf(page.launch, nowSec, page.pool.open);
  const lmode = isInstant ? 'instant' as const : 'trial' as const;
  const detailData = detail.status === 'ready' ? detail.data : undefined;
  const reserves = live && live.q && live.t ? { q: live.q, t: live.t } : { q: page.pool.quote_reserve, t: page.pool.token_reserve };
  const supply = facts.totalSupply ? Number(BigInt(facts.totalSupply)) / 1e6 : null;
  const holderItems = holders.status === 'ready' ? holders.data.items : undefined;
  const instantBundle = instantData.status === 'ready' ? instantData.data : null;
  const win = facts.terms && facts.openedAtSec ? openingWindow(facts.terms, facts.openedAtSec, nowSec) : null;
  const openingNow = facts.terms ? (win ? `${fmtBps(Math.round(win.appliedBps))} now, base ${fmtBps(win.baseBps)}` : `${fmtBps(facts.terms.total_fee_bps)} base (opening fee over)`) : null;
  const tiles = isInstant
    ? instantTiles({ totalSupply: facts.totalSupply ?? instantBundle?.info?.total_supply ?? null, info: instantBundle?.info, sched: vestSchedule(instantBundle?.info, instantBundle?.vesting, nowSec), safety: page.safety, payout: page.creator?.payout_recipient ?? page.launch.payout_recipient, openingNow, top10Bps: top10ShareBps(holderItems) })
    : safetyTiles(page, holderItems, creatorBundle?.stream, detailData);
  const declared: Record<string, string> = { [page.launch.payout_recipient]: 'payout recipient', [page.launch.creator]: 'creator' };
  const instantOrder = isInstant ? { declared: [page.launch.creator, page.launch.payout_recipient], config: marketCfg.status === 'ready' ? marketCfg.data : null } : undefined;
  const trading = state === 'trading' || state === 'halted';
  const supplyPage = { ...page, pool: { ...page.pool, quote_reserve: reserves.q, token_reserve: reserves.t } };

  const order = (side?: SheetSide) => <TradePanel key={side ?? 'rail'} page={page} facts={facts} reserves={reserves} nowSec={nowSec} onSubmitted={refreshAfterTrade} initialSide={side} instant={instantOrder} />;
  const fees = <FeePanel page={page} facts={facts} nowSec={nowSec} />;
  const mech = <MechanicsPanel launchId={id} detail={detail} epochTrades={wide} openedAtSec={facts.openedAtSec} onRetry={() => { reloadDetail(); reloadWide(); }} instant={isInstant} />;
  const alloc = <AllocationPanel page={page} instant={instantData} nowSec={nowSec} onClaimed={() => { refreshAfterTrade(); reloadInstant(); }} onRetry={reloadInstant} />;
  const creator = <CreatorPanel page={page} facts={facts} earnings={earnings} onClaimed={refreshAfterTrade} onRetry={reloadEarnings} />;
  const where = <WhereToTrade page={page} facts={facts} />;
  const pool = <PoolPanel pool={supplyPage.pool} symbol={page.launch.symbol} depth={depth} onRetry={reloadDepth} />;
  const verify = isInstant ? <ContractFacts page={page} facts={facts} instant={instantData} nowSec={nowSec} /> : <div className="mkt-stack"><VerifyPanel launchId={id} /><SafetyPanel page={page} /></div>;
  const verifyLabel = isInstant ? 'Contract facts' : 'Verify';
  const creatorTab = isInstant ? <div className="mkt-stack">{alloc}{creator}</div> : creator;
  const trades_ = <TradesFeed trades={trades} nowSec={nowSec} onRetry={reloadTrades} declared={declared} />;
  const holders_ = <HoldersPanel holders={holders} onRetry={reloadHolders} />;
  const stats = <StatsRail rows={rows} partial={!!wideTrades && wideTrades.next_cursor !== null} />;

  const tabDefs: TabDef[] = desktop
    ? [{ id: 'trades', label: 'Trades', body: trades_ }, { id: 'holders', label: 'Holders', body: holders_ }, { id: 'mechanics', label: 'Mechanics', body: mech }, { id: 'creator', label: 'Creator', body: creatorTab }, { id: 'verify', label: verifyLabel, body: verify }]
    : [{ id: 'trades', label: 'Trades', body: trades_ }, { id: 'holders', label: 'Holders', body: holders_ }, { id: 'info', label: 'Info', body: <div className="mkt-stack">{fees}{mech}{creatorTab}{where}{pool}</div> }, { id: 'verify', label: verifyLabel, body: verify }];
  const allowed = desktop ? DESKTOP_TABS : MOBILE_TABS;
  const activeTab = allowed.includes(tab) ? tab : tab === 'mechanics' || tab === 'creator' ? 'info' : 'trades';
  const buyBlock = page.pool.paused ? 'Buys paused by the operator (sells and claims stay open)' : page.source === 'fixture' ? 'Fixture data: nothing here is on a chain' : null;

  return (
    <div className="mkt-root" data-state={state}>
      <PriceHeader page={page} facts={facts} livePrice={live?.price} paused={page.pool.paused} phase={phase} showMarket={trading} mode={lmode} />
      {isInstant && <InstantNotice />}
      {state === 'failed' ? (isInstant ? <LaunchFailedState status={page.launch.status} /> : <FailedState page={page} />) : (
        <>
          <SafetyTiles tiles={tiles} verifyLabel={isInstant ? 'See the contract facts' : 'Recompute in your browser'} onOpenVerify={() => { changeTab('verify'); document.getElementById('mkt-tabs')?.scrollIntoView({ block: 'start' }); }} />
          {state === 'halted' && <HaltedBanner />}
          {state === 'launching' && <LaunchingState steps={instantSteps({ poolOpen: page.pool.open, status: page.launch.status, timeline: detailData?.timeline, info: instantBundle?.info })} />}
          {state === 'trial' && !isInstant && <TrialState page={page} detail={detail} />}
          {state === 'genesis' && !isInstant && <GenesisState steps={genesisSteps(page, detailData, false)} detail={detail} />}
          {trading && (
            <div className="mkt-grid">
              <div className="mkt-col">
                <PriceChart candles={candles} interval={interval} onInterval={setInterval_} stream={streamState} onRetry={reloadCandles} symbol={page.launch.symbol} mode={mode} onMode={setMode} supply={supply} markers={markers} />
                {!desktop && stats}
                <div id="mkt-tabs"><Tabs tabs={tabDefs} active={activeTab} onChange={changeTab} label="Market details" /></div>
              </div>
              {desktop && (
                <div className="mkt-col mkt-rail" tabIndex={0} role="region" aria-label="Order panel and market statistics">
                  {order()}
                  {stats}
                  {fees}
                  {where}
                  {pool}
                </div>
              )}
            </div>
          )}
          {trading && !desktop && (
            <>
              <StickyTradeBar onOpen={setSheet} buyDisabledReason={buyBlock} sellDisabled={page.source === 'fixture'} />
              <OrderSheet open={sheet !== null} onClose={() => setSheet(null)}>{order(sheet ?? 'buy')}</OrderSheet>
            </>
          )}
        </>
      )}
      <p className="mkt-disclosure">Unreviewed market contract on NEAR testnet: a capped constant-product pool. No independent audit. Every number above comes from the indexer API or a chain read and is labelled with its source. Nothing here is investment advice. Charts by TradingView Lightweight Charts.</p>
    </div>
  );
}
