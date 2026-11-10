'use client';
import { api } from '@/lib/api/client';
import type { Stats } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { fmtUsdc } from '@/lib/config';
import { fmtPct, titleCase } from '@/lib/format';
import { Freshness } from '@/components/ui/Freshness';
import { ErrorState, LoadingBlock } from '@/components/ui/States';

const amt = (v: string | undefined): string => (v === undefined ? 'n/a' : fmtUsdc(v));
const num = (v: number | undefined | null, d = 0): string => (v === undefined || v === null ? 'n/a' : v.toLocaleString('en-US', { maximumFractionDigits: d }));

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="card"><div className="big">{value}</div><div className="big-label">{label}</div>{sub && <p className="hint">{sub}</p>}</div>;
}

function Body({ d }: { d: Stats }) {
  const phases = Object.entries(d.launches.by_phase ?? {}).sort((a, b) => b[1] - a[1]);
  const slices = d.volume.fee_slices;
  return (
    <>
      <div style={{ margin: '0 0 12px' }}><Freshness source={d.source} asOf={d.as_of} /></div>
      <div className="grid grid-3">
        <Tile label="Trial launches indexed" value={num(d.launches.total)} />
        <Tile label="Pass rate" value={d.launches.pass_rate_bps == null ? 'none settled yet' : fmtPct(d.launches.pass_rate_bps)} sub={`${num(d.launches.passed)} passed, ${num(d.launches.failed)} failed`} />
        <Tile label="Committed in trials, all time" value={amt(d.committed?.total_committed)} sub={`Walked: ${amt(d.committed?.total_walked)}. Refunds paid: ${amt(d.committed?.refunds_paid)}.`} />
        <Tile label="Trading volume (USDC, gross)" value={d.volume.quote_volume == null ? 'n/a' : `$${num(d.volume.quote_volume, 2)}`} sub={`${num(d.volume.trades)} trades, ${num(d.volume.unique_traders)} traders`} />
        <Tile label="Trading fees paid" value={amt(d.volume.fees_total)} />
        {d.instant && <Tile label="Instant launches" value={num(d.instant.launches?.total)} sub={`${num(d.instant.launches?.open)} with an open pool, ${num(d.instant.launches?.failed)} failed`} />}
      </div>
      {slices && (
        <section aria-labelledby="ins-fee-h">
          <h3 id="ins-fee-h">Where trading fees went</h3>
          <div className="tbl-wrap"><table>
            <caption className="sr-only">Trading fees by slice</caption>
            <thead><tr><th scope="col">Slice</th><th scope="col" className="n">Amount</th></tr></thead>
            <tbody>{(['creator', 'platform', 'lp', 'holders', 'referral'] as const).map((k) => <tr key={k}><td>{titleCase(k)}</td><td className="n">{amt(slices[k])}</td></tr>)}</tbody>
          </table></div>
          <p className="hint">In this release the holders and referral slices go to liquidity. The platform slice is a number here, not income of anyone.</p>
        </section>
      )}
      {phases.length > 0 && (
        <section aria-labelledby="ins-ph-h">
          <h3 id="ins-ph-h">Launches by phase</h3>
          <div className="tbl-wrap"><table>
            <caption className="sr-only">Launch counts by phase</caption>
            <thead><tr><th scope="col">Phase</th><th scope="col" className="n">Launches</th></tr></thead>
            <tbody>{phases.map(([k, n]) => <tr key={k}><td>{titleCase(k.toLowerCase())}</td><td className="n">{n}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
      <p className="hint">Basis: {d.basis}{d.since_block != null ? ` Counted from block ${d.since_block}; nothing earlier is included.` : ''} Trial figures and instant figures are never added together here.</p>
    </>
  );
}

export function StatsSection() {
  const s = useApi<Stats>(() => api.stats(), 'insights-stats', 60000);
  return (
    <section aria-labelledby="ins-a-h">
      <h2 id="ins-a-h">Kruxa numbers</h2>
      {s.status === 'loading' && <LoadingBlock label="Loading statistics" lines={4} />}
      {s.status === 'error' && <ErrorState error={s.error} what="the statistics" onRetry={s.reload} />}
      {s.status === 'ok' && <Body d={s.data} />}
    </section>
  );
}
