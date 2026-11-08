import { foldEpochs } from '@/lib/market/epochs';
import { fmtUnits } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { LaunchDetail, TradeList } from '@/lib/market/types';
import { Async, Panel } from './shared';

export function MechanicsPanel({ launchId, detail, epochTrades, openedAtSec, onRetry }: { launchId: string; detail: Section<LaunchDetail>; epochTrades: Section<TradeList>; openedAtSec: number | null; onRetry(): void }) {
  return (
    <Panel title="Launch mechanics" id="mkt-mech-h">
      <Async section={detail} lines={3} onRetry={onRetry}>
        {(d) => {
          const v = d.verdict_inputs;
          return (
            <>
              <dl className="mkt-kv">
                <dt>Verdict</dt><dd className={d.verdict === 'PASS' ? 'mkt-up' : d.verdict === 'FAIL' ? 'mkt-down' : undefined}>{d.verdict ?? 'not yet'}</dd>
                <dt>Committed vs soft cap</dt><dd>${fmtUnits(v.total_active, 6, 0)} / {v.soft_cap ? `$${fmtUnits(v.soft_cap, 6, 0)}` : 'unknown'}</dd>
                <dt>Funders vs minimum</dt><dd>{v.funders} / {v.min_funders ?? 'unknown'}</dd>
              </dl>
              <p className="mkt-note"><a href={`/launch/${encodeURIComponent(launchId)}/verify`}>Recompute this verdict yourself</a></p>
            </>
          );
        }}
      </Async>
      <h3 style={{ fontSize: 13, margin: '14px 0 4px', color: 'var(--muted)', fontWeight: 500 }}>Fee epochs (24 h)</h3>
      <Async section={epochTrades} lines={2} onRetry={onRetry}>
        {(t) => {
          const rows = openedAtSec ? foldEpochs(t.items, openedAtSec) : [];
          if (!openedAtSec) return <p className="mkt-note">The pool open time is unknown, so epochs cannot be drawn.</p>;
          if (rows.length === 0) return <p className="mkt-note">No swaps in the indexed window yet.</p>;
          return (
            <>
              <div className="mkt-tablewrap"><table className="mkt-table">
                <caption className="mkt-sr">Fee epochs folded from recent swaps</caption>
                <thead><tr><th scope="col">Epoch</th><th scope="col" className="num">Swaps</th><th scope="col" className="num">Fees</th><th scope="col" className="num">Creator slice</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.epoch}><td>#{r.epoch}</td><td className="num">{r.trades}</td><td className="num">${fmtUnits(r.feeTotal, 6, 4)}</td><td className="num">{r.creatorSlice === null ? 'unknown' : `$${fmtUnits(r.creatorSlice, 6, 4)}`}</td></tr>)}</tbody>
              </table></div>
              <p className="mkt-note">Folded from the latest {t.items.length} indexed swaps, not the contract&apos;s ledger. Older swaps may be missing.</p>
            </>
          );
        }}
      </Async>
    </Panel>
  );
}
