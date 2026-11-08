import { shortAccount } from '@/lib/market/format';
import type { MarketFacts } from '@/lib/market/facts';
import type { TokenPageData } from '@/lib/market/types';
import { Panel } from './shared';

/** Only http(s) links are rendered; anything else from the API is shown as text. */
const safeUrl = (u?: string | null): string | null => (u && /^https:\/\//i.test(u) ? u : null);

export function WhereToTrade({ page, facts }: { page: TokenPageData; facts: MarketFacts }) {
  const meteora = (page.external_pools ?? []).find((p) => p.venue.toLowerCase().includes('meteora'));
  const url = safeUrl(meteora?.url);
  return (
    <Panel title="Where to trade" id="mkt-where-h">
      <ul className="mkt-list">
        <li>
          <span className={`mkt-chip ${page.pool.open ? 'mkt-chip-ok' : 'mkt-chip-unknown'}`}>{page.pool.open ? 'Open' : 'Not open'}</span>
          <span>Kruxa pool on NEAR</span>
          <span className="mkt-detail">Constant-product pool on <span className="mkt-mono">{facts.market}</span>. Trade it in the panel above.</span>
        </li>
        <li>
          <span className={`mkt-chip ${meteora ? 'mkt-chip-ok' : 'mkt-chip-unknown'}`}>{meteora ? 'Reported' : 'None'}</span>
          <span>Meteora pool on Solana</span>
          <span className="mkt-detail">
            {meteora ? (url ? <a href={url} target="_blank" rel="noopener noreferrer">Open the pool on Meteora</a> : <>Pool <span className="mkt-mono">{shortAccount(meteora.pool, 8, 6)}</span> (no link reported).</>)
              : 'The API reports no Meteora pool for this token. A link appears here only after it does.'}
          </span>
        </li>
      </ul>
      <p className="mkt-note">Prices on different chains are separate markets. Trading this token across chains is not executable here.</p>
    </Panel>
  );
}
