'use client';
import { useState } from 'react';
import { fmtPrice, fmtTokensCompact, fmtUsdcMicro, shortAccount, timeAgo } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { Trade, TradeList } from '@/lib/market/types';
import { Async, EmptyState, Panel, SourceBadge } from './shared';

export type TradeFilter = 'all' | 'you' | 'creator';

/** Filters a trades list. "You" is the connected NEAR account; "Creator accounts" are the declared wallets (creator and payout recipient) only. */
export function filterTrades(items: Trade[], filter: TradeFilter, you: string | null | undefined, declared: Record<string, string> | undefined): Trade[] {
  if (filter === 'you') return you ? items.filter((t) => t.trader === you) : [];
  if (filter === 'creator') return items.filter((t) => !!declared?.[t.trader]);
  return items;
}

export function TradesFeed({ trades, nowSec, onRetry, declared, you }: { trades: Section<TradeList>; nowSec: number; onRetry(): void; declared?: Record<string, string>; you?: string | null }) {
  const [filter, setFilter] = useState<TradeFilter>('all');
  return (
    <Panel title="Trades" id="mkt-trades-h" right={trades.status === 'ready' ? <SourceBadge source={trades.data.source} asOf={trades.data.as_of} /> : undefined}>
      <div className="mkt-seg" role="group" aria-label="Filter trades" style={{ marginBottom: 8 }}>
        {([['all', 'All'], ['you', 'You'], ['creator', 'Creator accounts']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
      </div>
      <Async section={trades} lines={5} onRetry={onRetry}>
        {(d0) => { const d = { ...d0, items: filterTrades(d0.items, filter, you, declared) }; return d.items.length === 0 ? (
          <EmptyState title={filter === 'all' ? 'No swaps yet' : filter === 'you' ? (you ? 'None of your trades in this list' : 'Connect a NEAR wallet to see your trades') : 'No trade by a declared creator account'}>{filter === 'all' ? 'Trades appear here as soon as the pool records a swap. This list is read from the market\'s swap events.' : filter === 'creator' ? 'Only the creator account and the payout recipient are known. Other wallets are not identified.' : 'The list covers the most recent swaps only.'}</EmptyState>
        ) : (
          <div className="mkt-tablewrap mkt-scroll" tabIndex={0} role="region" aria-label="Recent trades, scrollable">
            <table className="mkt-table">
              <caption className="mkt-sr">Most recent swaps, newest first</caption>
              <thead><tr><th scope="col">Side</th><th scope="col" className="num">Price</th><th scope="col" className="num">Tokens</th><th scope="col" className="num">USDC</th><th scope="col" className="mkt-hide-sm">Trader</th><th scope="col" className="num">Time</th></tr></thead>
              <tbody>{d.items.map((t) => <Row key={`${t.receipt_id}:${t.time}:${t.side}:${t.trader}`} t={t} nowSec={nowSec} tag={declared?.[t.trader]} />)}</tbody>
            </table>
          </div>
        ); }}
      </Async>
    </Panel>
  );
}

function Row({ t, nowSec, tag }: { t: Trade; nowSec: number; tag?: string }) {
  const buy = t.side === 'buy';
  return (
    <tr>
      <td className={buy ? 'mkt-up' : 'mkt-down'} style={{ whiteSpace: 'nowrap' }}><span aria-hidden="true">{buy ? '▲' : '▼'} </span>{buy ? 'Buy' : 'Sell'}</td>
      <td className="num">{fmtPrice(t.price)}</td>
      <td className="num">{fmtTokensCompact(t.token_amount ?? (buy ? t.amount_out : t.amount_in))}</td>
      <td className="num">{fmtUsdcMicro(t.quote_amount ?? (buy ? t.amount_in : t.amount_out))}</td>
      <td className="mkt-hide-sm mkt-mono" title={t.trader}>{shortAccount(t.trader, 12, 4)}{tag && <> <span className="mkt-chip mkt-chip-warn" style={{ padding: '2px 6px', fontSize: 10 }}>{tag}</span></>}</td>
      <td className="num mkt-muted" title={`receipt ${t.receipt_id}`}>{timeAgo(t.time, nowSec)}</td>
    </tr>
  );
}
