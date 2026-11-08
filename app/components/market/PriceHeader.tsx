import { fmtCompact, fmtPct, fmtPrice, fmtUnits, fmtUsd } from '@/lib/market/format';
import type { MarketFacts } from '@/lib/market/facts';
import type { TokenPageData } from '@/lib/market/types';
import { SourceBadge } from './shared';

const STAGE_LABEL: Record<string, string> = { passed: 'Trial passed', open: 'Trial open', new: 'Trial open', closing: 'Trial closing', failed: 'Trial failed' };

export function PriceHeader({ page, facts, livePrice, paused }: { page: TokenPageData; facts: MarketFacts; livePrice?: number | null; paused: boolean }) {
  const { launch, stats, pool } = page;
  const price = livePrice ?? stats.last_price ?? pool.price ?? null;
  const change = stats.change_24h_pct ?? null;
  const up = change !== null && change > 0;
  const down = change !== null && change < 0;
  const mcap = price !== null && facts.totalSupply ? price * (Number(BigInt(facts.totalSupply)) / 1e6) : null;
  const supplyNote = facts.totalSupply ? `${fmtUnits(facts.totalSupply, 6, 0)} tokens` : null;

  return (
    <header className="mkt-head">
      <div className="mkt-title">
        <h1>{launch.symbol} <span className="mkt-sub">launch #{launch.launch_id}</span></h1>
        <span className="mkt-chip mkt-chip-chain">{STAGE_LABEL[launch.stage] ?? launch.stage}</span>
        {paused && <span className="mkt-chip mkt-chip-warn">Market paused</span>}
        <SourceBadge source={page.source} asOf={page.as_of} />
      </div>
      <div className="mkt-price" aria-live="off">
        <span className="mkt-price-now" aria-label={`Last price ${fmtPrice(price)} USDC`}>{fmtPrice(price)}</span>
        <span className={`mkt-price-chg ${up ? 'mkt-up' : down ? 'mkt-down' : 'mkt-muted'}`}>
          <span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>{fmtPct(change)}<span className="mkt-sr"> over 24 hours</span>
        </span>
        <span className="mkt-muted" style={{ fontSize: 13 }}>per token, in USDC</span>
      </div>
      <dl className="mkt-stats">
        <Stat label="Market cap" value={mcap !== null ? `$${fmtCompact(mcap)}` : 'unknown'} note={mcap !== null ? `at ${supplyNote}` : 'total supply not reported'} />
        <Stat label="Volume 24h" value={stats.volume_24h !== undefined ? fmtUsd(stats.volume_24h) : 'unknown'} note={stats.trades_24h !== undefined ? `${stats.trades_24h} trades` : undefined} />
        <Stat label="High 24h" value={fmtPrice(stats.high_24h)} />
        <Stat label="Low 24h" value={fmtPrice(stats.low_24h)} />
        <Stat label="Pool value" value={pool.tvl_quote !== null && pool.tvl_quote !== undefined ? fmtUsd(pool.tvl_quote) : 'unknown'} note="2 x USDC reserve" />
        <Stat label="Fees paid" value={stats.fees_total ? `$${fmtUnits(stats.fees_total, 6, 2)}` : 'unknown'} note="all time" />
      </dl>
    </header>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <dd className="mkt-muted" style={{ fontSize: 11, fontWeight: 400 }}>{note}</dd>}
    </div>
  );
}
