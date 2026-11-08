'use client';
import { fmtPrice, fmtTokensCompact, fmtUsdcMicro, shortAccount, timeAgo } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { Trade, TradeList } from '@/lib/market/types';
import { Async, EmptyState, Panel, SourceBadge } from './shared';

export function TradesFeed({ trades, nowSec, onRetry }: { trades: Section<TradeList>; nowSec: number; onRetry(): void }) {
  return (
    <Panel title="Trades" id="mkt-trades-h" right={trades.status === 'ready' ? <SourceBadge source={trades.data.source} asOf={trades.data.as_of} /> : undefined}>
      <Async section={trades} lines={5} onRetry={onRetry}>
        {(d) => d.items.length === 0 ? (
          <EmptyState title="No swaps yet">Trades appear here as soon as the pool records a swap. This list is read from the market&apos;s swap events.</EmptyState>
        ) : (
          <div className="mkt-tablewrap" tabIndex={0} role="region" aria-label="Recent trades, scrollable">
            <table className="mkt-table">
              <caption className="mkt-sr">Most recent swaps, newest first</caption>
              <thead><tr><th scope="col">Side</th><th scope="col" className="num">Price</th><th scope="col" className="num">Tokens</th><th scope="col" className="num">USDC</th><th scope="col" className="mkt-hide-sm">Trader</th><th scope="col" className="num">Time</th></tr></thead>
              <tbody>{d.items.map((t) => <Row key={`${t.receipt_id}:${t.time}:${t.side}:${t.trader}`} t={t} nowSec={nowSec} />)}</tbody>
            </table>
          </div>
        )}
      </Async>
    </Panel>
  );
}

function Row({ t, nowSec }: { t: Trade; nowSec: number }) {
  const buy = t.side === 'buy';
  return (
    <tr>
      <td className={buy ? 'mkt-up' : 'mkt-down'}><span aria-hidden="true">{buy ? '▲' : '▼'} </span>{buy ? 'Buy' : 'Sell'}</td>
      <td className="num">{fmtPrice(t.price)}</td>
      <td className="num">{fmtTokensCompact(t.token_amount ?? (buy ? t.amount_out : t.amount_in))}</td>
      <td className="num">{fmtUsdcMicro(t.quote_amount ?? (buy ? t.amount_in : t.amount_out))}</td>
      <td className="mkt-hide-sm mkt-mono" title={t.trader}>{shortAccount(t.trader, 12, 4)}</td>
      <td className="num mkt-muted" title={`receipt ${t.receipt_id}`}>{timeAgo(t.time, nowSec)}</td>
    </tr>
  );
}
