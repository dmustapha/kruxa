'use client';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import type { Health } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { CONFIG, fmtUsdc } from '@/lib/config';
import { view } from '@/lib/near';
import { fmtDate, fmtDuration } from '@/lib/format';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { ErrorState, LoadingBlock } from '@/components/ui/States';

const MAINTENANCE = process.env.NEXT_PUBLIC_MAINTENANCE ?? '';

interface CoreCfg { pause?: string; creator_gate?: boolean | string; profile?: string; global_cap?: string; global_held?: string; market?: string | null; genesis_paused?: boolean; pending_global_cap?: { value: string; effective_at: string } | null }
interface MarketCfg { paused?: boolean }

const TONE: Record<Health['status'], string> = { ok: 'chain', stale: 'warn', fixture: 'fixture' };

function Indexer() {
  const s = useApi<Health>(() => api.health(), 'status-health', 15000);
  return (
    <section className="card" aria-labelledby="st-idx-h">
      <h2 id="st-idx-h">Indexer</h2>
      {s.status === 'loading' && <LoadingBlock label="Reading indexer health" lines={3} />}
      {s.status === 'error' && <ErrorState error={s.error} what="indexer health" onRetry={s.reload} />}
      {s.status === 'ok' && (
        <>
          <p className="row"><Badge tone={TONE[s.data.status]}>{s.data.status}</Badge><SourceBadge source={s.data.source} />{s.data.data_source === 'snapshot' && <Badge tone="recorded">RECORDED</Badge>}</p>
          <dl className="kv">
            <div><dt>Network</dt><dd>{s.data.network}</dd></div>
            <div><dt>Indexed to block</dt><dd>{s.data.as_of.block_height ?? 'nothing yet'}{s.data.as_of.block_time ? ` (${fmtDate(s.data.as_of.block_time)})` : ''}</dd></div>
            <div><dt>Chain head</dt><dd>{s.data.head_height ?? 'unknown'}</dd></div>
            <div><dt>Lag</dt><dd>{s.data.lag_blocks ?? 'unknown'} blocks (limit {s.data.max_lag_blocks})</dd></div>
            <div><dt>Events indexed</dt><dd>{s.data.event_count}</dd></div>
            <div><dt>Uptime</dt><dd>{fmtDuration(s.data.uptime_s)}</dd></div>
            <div><dt>Last error</dt><dd>{s.data.last_error ?? 'none'}</dd></div>
          </dl>
          {s.data.status === 'stale' && <p className="callout"><b>The indexer is behind.</b> Feeds and balances here can be out of date. The contracts are not affected.</p>}
          {s.data.status === 'fixture' && <p className="callout"><b>Fixture data.</b> This indexer was built from the offline generator, not from a chain.</p>}
        </>
      )}
    </section>
  );
}

function Contracts() {
  const core = useApi<CoreCfg>(() => view<CoreCfg>('get_config'), 'status-core', 30000);
  const market = useApi<MarketCfg>(() => view<MarketCfg>('get_config', {}, CONFIG.market), 'status-market', 30000);
  return (
    <section className="card" aria-labelledby="st-chain-h">
      <h2 id="st-chain-h">Contracts and the NEAR RPC</h2>
      <p className="hint"><Badge tone="chain">Read from chain</Badge> Direct contract views. If these fail, the RPC is unreachable from this browser, or the contract is not deployed at the configured account.</p>
      <dl className="kv">
        <div><dt>NEAR RPC</dt><dd className={core.status === 'ok' ? 'ok' : core.status === 'error' ? 'bad' : ''}>{core.status === 'ok' ? 'reachable' : core.status === 'error' ? 'not reachable' : 'checking'}</dd></div>
        <div><dt>Core contract</dt><dd>{CONFIG.core}</dd></div>
        <div><dt>Core pause level</dt><dd>{core.status === 'ok' ? (core.data.pause ?? 'unknown') : 'unknown'}</dd></div>
        <div><dt>Creator gate</dt><dd>{core.status === 'ok' ? String(core.data.creator_gate ?? 'unknown') : 'unknown'}</dd></div>
        <div><dt>Profile</dt><dd>{core.status === 'ok' ? (core.data.profile ?? 'unknown') : 'unknown'}</dd></div>
        <div><dt>Global cap held</dt><dd>{core.status === 'ok' && core.data.global_cap && core.data.global_held ? `${fmtUsdc(core.data.global_held)} of ${fmtUsdc(core.data.global_cap)}` : 'unknown'}</dd></div>
        <div><dt>Market contract</dt><dd>{CONFIG.market}</dd></div>
        <div><dt>Market paused</dt><dd>{market.status === 'ok' ? (market.data.paused ? 'yes' : 'no') : market.status === 'error' ? 'unknown (could not read)' : 'checking'}</dd></div>
      </dl>
      {core.status === 'ok' && core.data.pause && core.data.pause !== 'None' && <p className="callout"><b>Core is {core.data.pause}.</b> Read <Link href="/ops-log">the operations log</Link> for what that blocks. A pause does not block exits.</p>}
      {core.status === 'ok' && core.data.pending_global_cap && <p className="callout info">A global cap raise is queued. See <Link href="/ops-log">the operations log</Link>.</p>}
    </section>
  );
}

export function StatusView() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Status</p>
        <h1>Is everything working?</h1>
        <p className="lede">The website, the indexer and the NEAR RPC can all be down or behind while the contracts keep working. Each line below says where it was read from.</p>
      </header>
      {MAINTENANCE
        ? <div className="callout"><p><b>Maintenance.</b> {MAINTENANCE} Trading and commit buttons stay enabled because the contracts, not this site, decide every action.</p></div>
        : <p className="hint">No maintenance message is set.</p>}
      <div className="stack"><Indexer /><Contracts /></div>
      <section className="card" aria-labelledby="st-note-h">
        <h2 id="st-note-h">Good to know</h2>
        <ul>
          <li>Intents legs usually take about 90 seconds. One test swap stalled for about 35 minutes before it completed.</li>
          <li>You can recompute any verdict without this site: see <Link href="/docs/verify">Verify a launch</Link>.</li>
        </ul>
      </section>
    </>
  );
}
