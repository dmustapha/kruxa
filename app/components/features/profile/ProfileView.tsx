'use client';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import type { CreatorDesk, LaunchList, Portfolio } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { fmtUsdc, explorer } from '@/lib/config';
import { shortAccount, titleCase } from '@/lib/format';
import { useNow } from '@/lib/clock';
import { Freshness } from '@/components/ui/Freshness';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { ModeBadge } from '@/components/ui/PhaseBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';
import { LaunchCard } from '../LaunchCard';

/** "3 trials: 2 PASS, 1 FAIL". A recorded fact about settled trials, not a score. */
export function trialRecord(items: { mode?: string | null; verdict?: 'PASS' | 'FAIL' | null }[]): string {
  const trials = items.filter((l) => (l.mode ?? 'trial') === 'trial');
  const pass = trials.filter((l) => l.verdict === 'PASS').length;
  const fail = trials.filter((l) => l.verdict === 'FAIL').length;
  const open = trials.length - pass - fail;
  const bits = [`${pass} PASS`, `${fail} FAIL`, ...(open > 0 ? [`${open} without a verdict yet`] : [])];
  return `${trials.length} trial${trials.length === 1 ? '' : 's'}: ${bits.join(', ')}`;
}

function Created({ account }: { account: string }) {
  const s = useApi<LaunchList>(() => api.launches({ creator: account, limit: 50 }), `u-launches-${account}`);
  const ok = s.status === 'ok' ? s.data : null;
  const now = useNow(ok?.source, ok?.as_of);
  const mine = ok ? ok.items.filter((l) => l.creator === account) : [];
  const instant = mine.filter((l) => l.mode === 'instant').length;
  return (
    <section aria-labelledby="u-launch-h">
      <h2 id="u-launch-h">Launches created</h2>
      {s.status === 'loading' && <LoadingBlock label="Loading launches" />}
      {s.status === 'error' && <ErrorState error={s.error} what="launches" onRetry={s.reload} />}
      {ok && (
        <>
          <p><b>{trialRecord(mine)}.</b>{instant > 0 && <> {instant} instant launch{instant === 1 ? '' : 'es'}, which have no trial and no verdict.</>} This is a factual record, not a rating. There are no followers and no reputation score.</p>
          <div style={{ margin: '0 0 12px' }}><Freshness source={ok.source} asOf={ok.as_of} /></div>
          {mine.length === 0
            ? <EmptyState title="No launch created by this account">The indexer has none, or the account has only backed launches.</EmptyState>
            : <div className="grid grid-cards">{mine.map((l) => <LaunchCard key={l.launch_id} launch={l} now={now} frozenClock={l.source === 'fixture'} />)}</div>}
        </>
      )}
    </section>
  );
}

function Positions({ account }: { account: string }) {
  const s = useApi<Portfolio>(() => api.portfolio(account), `u-pos-${account}`);
  return (
    <section aria-labelledby="u-pos-h">
      <h2 id="u-pos-h">Positions</h2>
      <p className="hint">Positions are public because they are on-chain events. This is the same read-only data as <Link href="/portfolio">Portfolio</Link>.</p>
      {s.status === 'loading' && <LoadingBlock label="Loading positions" />}
      {s.status === 'error' && <ErrorState error={s.error} what="positions" onRetry={s.reload} />}
      {s.status === 'ok' && (s.data.positions.length === 0
        ? <EmptyState title="No positions for this account" />
        : (
          <div className="tbl-wrap"><table>
            <caption className="sr-only">Positions of {account}</caption>
            <thead><tr><th scope="col">Launch</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col" className="n">Contributed</th><th scope="col" className="n">Walked</th><th scope="col">Source</th></tr></thead>
            <tbody>{s.data.positions.map((p) => (
              <tr key={p.launch.launch_id}>
                <td><Link href={`/launch/${p.launch.launch_id}`}>{p.launch.symbol} #{p.launch.launch_id}</Link></td>
                <td><ModeBadge mode={p.launch.mode} /></td><td><Badge tone="muted">{titleCase(p.status)}</Badge></td>
                <td className="n">{fmtUsdc(p.contributed)}</td><td className="n">{fmtUsdc(p.walked)}</td><td><SourceBadge source={p.launch.source} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
    </section>
  );
}

function Earnings({ account }: { account: string }) {
  const s = useApi<CreatorDesk>(() => api.creator(account), `u-earn-${account}`);
  return (
    <section aria-labelledby="u-earn-h">
      <h2 id="u-earn-h">Creator earnings (read only)</h2>
      {s.status === 'loading' && <LoadingBlock label="Loading earnings" lines={2} />}
      {s.status === 'error' && <ErrorState error={s.error} what="creator totals" onRetry={s.reload} />}
      {s.status === 'ok' && (
        <>
          <dl className="kv">
            <div><dt>Stream drawn</dt><dd>{s.data.totals.stream_drawn ? fmtUsdc(s.data.totals.stream_drawn) : 'n/a'}</dd></div>
            <div><dt>Trading-fee share accrued</dt><dd>{s.data.totals.market_fees_creator_slice ? fmtUsdc(s.data.totals.market_fees_creator_slice) : 'n/a'}</dd></div>
            <div><dt>Trading-fee share claimed</dt><dd>{s.data.totals.claimed ? fmtUsdc(s.data.totals.claimed) : 'n/a'}</dd></div>
          </dl>
          <p className="hint">Amounts the contracts paid or accrued. Not a promise of future income.</p>
        </>
      )}
    </section>
  );
}

export function ProfileView({ account }: { account: string }) {
  const sol = account.startsWith('sol:');
  const href = sol ? explorer.solAddress(account.slice(4)) : explorer.nearAccount(account);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Public profile</p>
        <h1 style={{ overflowWrap: 'anywhere' }}>{shortAccount(account)}</h1>
        <p className="lede"><span className="mono" style={{ overflowWrap: 'anywhere' }}>{account}</span> · <a href={href} target="_blank" rel="noreferrer noopener">View on explorer<span className="sr-only"> (new tab)</span></a></p>
        <nav aria-label="On this page" className="row"><a href="#u-launch-h">Launches</a><a href="#u-pos-h">Positions</a><a href="#u-earn-h">Earnings</a></nav>
      </header>
      <div className="stack"><Created account={account} /><Positions account={account} /><Earnings account={account} /></div>
    </>
  );
}
