import { fmtCompact, fmtPct, fmtPrice, fmtUnits, fmtUsd, shortAccount } from '@/lib/market/format';
import type { MarketFacts } from '@/lib/market/facts';
import type { Phase } from '@/lib/market/phase';
import type { TokenPageData } from '@/lib/market/types';
import { CopyButton } from './CopyButton';
import { PhaseBadge } from './PhaseBadge';
import { Sigil } from './Sigil';
import { SourceBadge } from './shared';

export function PriceHeader({ page, facts, livePrice, paused, phase, showMarket = true }: { page: TokenPageData; facts: MarketFacts; livePrice?: number | null; paused: boolean; phase: Phase; showMarket?: boolean }) {
  const { launch, stats, pool } = page;
  const price = livePrice ?? stats.last_price ?? pool.price ?? null;
  const change = stats.change_24h_pct ?? null;
  const up = change !== null && change > 0;
  const down = change !== null && change < 0;
  const mcap = price !== null && facts.totalSupply ? price * (Number(BigInt(facts.totalSupply)) / 1e6) : null;
  const creator = page.creator?.account ?? launch.creator;
  const payout = page.creator?.payout_recipient ?? launch.payout_recipient;
  const link = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <header className="mkt-head">
      <div className="mkt-title">
        <Sigil id={launch.launch_id} symbol={launch.symbol} size={44} />
        <div className="mkt-title-text">
          <h1>{launch.name ? <>{launch.name} <span className="mkt-sub">${launch.symbol}</span></> : <>{launch.symbol}</>} <span className="mkt-sub">launch #{launch.launch_id}</span></h1>
          <div className="mkt-chips">
            <PhaseBadge phase={phase} />
            {paused && <span className="mkt-chip mkt-chip-warn">Buys paused</span>}
            <SourceBadge source={page.source} asOf={page.as_of} />
          </div>
        </div>
      </div>
      {showMarket && (
        <>
          <div className="mkt-price" aria-live="off">
            <span className="mkt-price-now" aria-label={`Last price ${fmtPrice(price)} USDC`}>{fmtPrice(price)}</span>
            <span className={`mkt-price-chg ${up ? 'mkt-up' : down ? 'mkt-down' : 'mkt-muted'}`}>
              <span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>{fmtPct(change)}<span className="mkt-sr"> over 24 hours</span>
            </span>
            <span className="mkt-muted mkt-per">per token, in USDC</span>
          </div>
          <dl className="mkt-stats">
            <Stat label="Market cap" value={mcap !== null ? `$${fmtCompact(mcap)}` : 'unknown'} note={mcap !== null ? `at ${fmtUnits(facts.totalSupply, 6, 0)} tokens` : 'total supply not reported'} />
            <Stat label="Volume 24h" value={stats.volume_24h !== undefined ? fmtUsd(stats.volume_24h) : 'unknown'} note={stats.trades_24h !== undefined ? `${stats.trades_24h} trades` : undefined} />
            <Stat label="High 24h" value={fmtPrice(stats.high_24h)} />
            <Stat label="Low 24h" value={fmtPrice(stats.low_24h)} />
            <Stat label="Pool value" value={pool.tvl_quote !== null && pool.tvl_quote !== undefined ? fmtUsd(pool.tvl_quote) : 'unknown'} note="2 x USDC reserve" />
            <Stat label="Fees paid" value={stats.fees_total ? `$${fmtUnits(stats.fees_total, 6, 2)}` : 'unknown'} note="all time" />
          </dl>
        </>
      )}
      <ul className="mkt-meta" aria-label="Accounts">
        <li><span className="mkt-muted">Creator</span> <span className="mkt-mono" title={creator}>{shortAccount(creator, 14, 4)}</span></li>
        <li><span className="mkt-muted">Payout</span> <span className="mkt-mono" title={payout}>{shortAccount(payout, 14, 4)}</span></li>
        <li><span className="mkt-muted">Token</span> {facts.token ? <><span className="mkt-mono" title={facts.token}>{shortAccount(facts.token, 14, 4)}</span> <CopyButton text={facts.token} label="token account" /></> : <span className="mkt-mono">unknown</span>}</li>
        {link && <li><CopyButton text={link} label="page link" /> <span className="mkt-muted">link</span></li>}
      </ul>
    </header>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <dd className="mkt-muted mkt-stat-note">{note}</dd>}
    </div>
  );
}
