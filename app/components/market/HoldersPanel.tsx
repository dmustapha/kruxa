import { fmtBps, fmtTokensCompact, shortAccount } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { HolderList } from '@/lib/market/types';
import { Async, EmptyState, Panel, SourceBadge } from './shared';

export function HoldersPanel({ holders, onRetry }: { holders: Section<HolderList>; onRetry(): void }) {
  return (
    <Panel title="Top holders" id="mkt-holders-h" right={<>
      <span className="mkt-chip mkt-chip-warn">Indexed estimate</span>
      {holders.status === 'ready' && <SourceBadge source={holders.data.source} asOf={holders.data.as_of} />}
    </>}>
      <Async section={holders} lines={5} onRetry={onRetry}>
        {(d) => d.items.length === 0 ? <EmptyState title="No holders indexed">Balances appear after trial claims or the first swap.</EmptyState> : (
          <>
            <div className="mkt-tablewrap">
              <table className="mkt-table">
                <caption className="mkt-sr">Largest holders by indexed balance</caption>
                <thead><tr><th scope="col">#</th><th scope="col">Holder</th><th scope="col" className="num">Balance</th><th scope="col" className="num">Share</th></tr></thead>
                <tbody>
                  {d.items.map((h, i) => (
                    <tr key={h.holder}>
                      <td className="mkt-muted">{i + 1}</td>
                      <td className="mkt-mono" title={h.holder}>{h.is_pool ? 'Liquidity pool' : shortAccount(h.holder, 14, 4)}{h.is_creator && <> <span className="mkt-chip mkt-chip-chain" style={{ padding: '2px 6px', fontSize: 10 }}>creator</span></>}</td>
                      <td className="num">{fmtTokensCompact(h.balance)}</td>
                      <td className="num"><span className="mkt-sr">{fmtBps(h.share_bps)}</span><span aria-hidden="true" style={{ display: 'grid', gap: 3, justifyItems: 'end' }}>{fmtBps(h.share_bps)}<span className="mkt-bar" style={{ width: 64 }}><span style={{ width: `${Math.min(100, h.share_bps / 100)}%` }} /></span></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mkt-note">{d.holder_count !== undefined ? `${d.holder_count} holders indexed. ` : ''}Basis: {d.basis}. These are not token-contract reads and can miss transfers made outside the market.</p>
          </>
        )}
      </Async>
    </Panel>
  );
}
