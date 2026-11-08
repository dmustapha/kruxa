import { fmtPrice, fmtTokensCompact, fmtUnits, fmtUsd } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { PoolDepth, PoolInfo } from '@/lib/market/types';
import { Async, Panel, SourceBadge } from './shared';

export function PoolPanel({ pool, symbol, depth, onRetry }: { pool: PoolInfo; symbol: string; depth: Section<PoolDepth>; onRetry(): void }) {
  return (
    <Panel title="Pool depth" id="mkt-pool-h" right={depth.status === 'ready' ? <SourceBadge source={depth.data.source} asOf={depth.data.as_of} /> : undefined}>
      <dl className="mkt-kv">
        <dt>USDC reserve</dt><dd>{pool.quote_reserve ? `$${fmtUnits(pool.quote_reserve, 6, 2)}` : 'unknown'}</dd>
        <dt>{symbol} reserve</dt><dd>{pool.token_reserve ? fmtTokensCompact(pool.token_reserve) : 'unknown'}</dd>
        <dt>Pool price</dt><dd>{fmtPrice(pool.price)}</dd>
        <dt>Pool value</dt><dd>{pool.tvl_quote !== null && pool.tvl_quote !== undefined ? fmtUsd(pool.tvl_quote) : 'unknown'}</dd>
      </dl>
      <h3 style={{ fontSize: 13, margin: '16px 0 4px', color: 'var(--muted)', fontWeight: 500 }}>Price impact by trade size</h3>
      <Async section={depth} lines={4} onRetry={onRetry}>
        {(d) => d.ladder.length === 0 ? <p className="mkt-note">No depth ladder is available until the pool has reserves.</p> : (
          <div className="mkt-tablewrap">
            <table className="mkt-table">
              <caption className="mkt-sr">Estimated price impact for hypothetical trades</caption>
              <thead><tr><th scope="col">Trade</th><th scope="col" className="num">You pay</th><th scope="col" className="num">You get</th><th scope="col" className="num">Impact</th></tr></thead>
              <tbody>
                {d.ladder.map((r) => (
                  <tr key={`${r.side}${r.amount_in}`}>
                    <td className={r.side === 'buy' ? 'mkt-up' : 'mkt-down'}>{r.side === 'buy' ? 'Buy' : 'Sell'}</td>
                    <td className="num">{r.side === 'buy' ? `$${fmtUnits(r.amount_in, 6, 0)}` : fmtTokensCompact(r.amount_in)}</td>
                    <td className="num">{r.side === 'buy' ? fmtTokensCompact(r.amount_out) : `$${fmtUnits(r.amount_out, 6, 2)}`}</td>
                    <td className={`num ${r.price_impact_bps >= 500 ? 'mkt-warn' : ''}`}>{(r.price_impact_bps / 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <p className="mkt-note">Estimate from the latest indexed reserves with the constant-product formula. It is not a guarantee: your min_out is the protection.</p>
    </Panel>
  );
}
