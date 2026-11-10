'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api/client';
import type { OpsLog, OpsLogItem } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { getOpsState, getSolvencyReport, type OpsState, type SolvencyReport } from '@/lib/near';
import { GROUP_LABEL, OPERATOR_POWERS, eventLabel, groupOf, nsToUnix, type OpsGroup } from '@/lib/ops';
import { fmtDate, fmtDuration, shortHash } from '@/lib/format';
import { fmtUsdc } from '@/lib/config';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { Freshness } from '@/components/ui/Freshness';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/States';

const FILTERS: ('all' | OpsGroup)[] = ['all', 'pauses', 'upgrades', 'halts', 'resolves', 'caps', 'other'];

/** Section 1: the powers, each with the limit that bounds it. Static text, tied to the contract source by lib/ops.test.ts. */
function Powers() {
  return (
    <section aria-labelledby="ops-powers-h">
      <h2 id="ops-powers-h">What the operator can do, and what stops it</h2>
      <div className="tbl-wrap">
        <table>
          <caption className="sr-only">Operator powers and their limits</caption>
          <thead><tr><th scope="col">Who</th><th scope="col">Power</th><th scope="col">Limit</th></tr></thead>
          <tbody>{OPERATOR_POWERS.map((p) => <tr key={p.id}><td>{p.who}</td><td>{p.power} <code>{p.id}</code></td><td>{p.limit}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="hint">None of these can change a stored verdict, redirect a refund, change a payout recipient or move a buyer&apos;s funds to a new place.</p>
    </section>
  );
}

function UpgradeQueue({ s }: { s: OpsState }) {
  const at = nsToUnix(s.pending_upgrade?.effective_at);
  const now = Math.floor(Date.now() / 1000);
  if (!s.pending_upgrade) return <p><b>No upgrade is queued.</b> The deployed core code cannot change without first appearing here, 7 days ahead.</p>;
  return (
    <div className="callout">
      <p><b>An upgrade is queued.</b> Code hash <code>{shortHash(s.pending_upgrade.code_hash, 12, 8)}</code>.</p>
      <p>It can be deployed {at ? <>after {fmtDate(at)}{at > now ? <> (in {fmtDuration(at - now)})</> : <> (the delay has passed)</>}</> : 'after a delay that could not be read'}. The guardian can cancel it.</p>
    </div>
  );
}

function Leg({ name, l }: { name: string; l: unknown }) {
  const leg = l as { balance?: string; liability?: string; ok?: boolean } | null | undefined;
  if (!leg) return <div><dt>{name}</dt><dd>not part of the last check</dd></div>;
  return <div><dt>{name}</dt><dd>{leg.balance ? fmtUsdc(leg.balance) : 'n/a'} held, {leg.liability ? fmtUsdc(leg.liability) : 'n/a'} owed, {leg.ok ? 'covered' : 'SHORT'}</dd></div>;
}

function Solvency({ r }: { r: SolvencyReport }) {
  const last = r.last_check as { at?: string; ok?: boolean; native?: unknown; intents?: unknown } | null;
  const at = nsToUnix(last?.at);
  return (
    <>
      <dl className="kv">
        <div><dt>Counters match a recomputation from state</dt><dd className={r.counters_ok ? 'ok' : 'bad'}>{r.counters_ok ? 'yes' : 'NO'}</dd></div>
        <div><dt>Owed in USDC on NEAR (counter)</dt><dd>{fmtUsdc(r.held_native)}</dd></div>
        <div><dt>Owed in Intents (counter)</dt><dd>{fmtUsdc(r.held_intents)}</dd></div>
        <div><dt>Intents alert</dt><dd className={r.intents_alert ? 'bad' : 'ok'}>{r.intents_alert ? 'RAISED: new Intents commits are refused' : 'clear'}</dd></div>
        <div><dt>Last balance check</dt><dd>{last ? `${at ? fmtDate(at) : 'time unknown'}, ${last.ok ? 'covered' : 'SHORT'}` : 'none has run yet'}</dd></div>
        {last && <Leg name="NEAR leg" l={last.native} />}
        {last && <Leg name="Intents leg" l={last.intents} />}
      </dl>
      <p className="hint">Informational. Anyone can run <code>check_solvency</code>. It moves no money. The only thing it can do is pause new Intents commits while the Intents balance is below what core owes there.</p>
    </>
  );
}

function ContractState() {
  const ops = useApi<OpsState>(() => getOpsState(), 'ops-state', 60000);
  const sol = useApi<SolvencyReport>(() => getSolvencyReport(), 'solvency', 60000);
  const [lid, setLid] = useState('');
  const [asked, setAsked] = useState('');
  const halted = useApi<OpsState>(asked ? () => getOpsState(asked) : null, `halt-${asked}`);
  return (
    <section aria-labelledby="ops-state-h">
      <h2 id="ops-state-h">Read from the core contract now</h2>
      <p className="hint"><Badge tone="chain">Read from chain</Badge> These come from contract views over the NEAR RPC, not from the indexer.</p>
      <div className="grid grid-2">
        <div className="card">
          <h3>Upgrade queue</h3>
          {ops.status === 'loading' && <LoadingBlock label="Reading the upgrade queue" lines={2} />}
          {ops.status === 'error' && <ErrorState error={ops.error} what="the upgrade queue" onRetry={ops.reload} />}
          {ops.status === 'ok' && <UpgradeQueue s={ops.data} />}
        </div>
        <div className="card">
          <h3>Solvency report</h3>
          {sol.status === 'loading' && <LoadingBlock label="Reading the solvency report" lines={3} />}
          {sol.status === 'error' && <ErrorState error={sol.error} what="the solvency report" onRetry={sol.reload} />}
          {sol.status === 'ok' && <Solvency r={sol.data} />}
        </div>
      </div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); setAsked(lid.trim()); }} aria-label="Check whether a launch is halted">
        <label htmlFor="halt-id" style={{ marginTop: 0 }}>Is a launch halted?</label>
        <div className="row"><input id="halt-id" inputMode="numeric" pattern="[0-9]*" style={{ flex: '1 1 160px', width: 'auto' }} value={lid} onChange={(e) => setLid(e.target.value)} placeholder="launch number" autoComplete="off" />
          <button type="submit" disabled={!/^[0-9]+$/.test(lid.trim())}>Check</button></div>
        {asked && halted.status === 'loading' && <p className="hint" role="status">Reading launch {asked}</p>}
        {asked && halted.status === 'error' && <p className="bad" role="alert">Could not read launch {asked}: {halted.error.message}</p>}
        {asked && halted.status === 'ok' && <p role="status"><b>Launch {asked} is {halted.data.halted ? 'HALTED' : 'not halted'}.</b> {halted.data.halted ? 'New commits and creator side payouts are stopped. Walk, refunds and token claims still work.' : 'Commits and payouts follow the Charter.'}</p>}
      </form>
    </section>
  );
}

function Row({ i }: { i: OpsLogItem }) {
  return (
    <li>
      <span className="when">{fmtDate(i.time)} · block {i.block_height} · {i.scope}</span>
      <b>{eventLabel(i.event)}</b>: {i.summary}
      {typeof i.data.reason === 'string' && i.data.reason && <span className="muted"> Reason given: {i.data.reason}</span>}
      <span className="row" style={{ marginTop: 2 }}><SourceBadge source={i.source} /><span className="mono muted" title={i.receipt_id}>receipt {shortHash(i.receipt_id, 6, 4)}</span></span>
    </li>
  );
}

function Log() {
  const [scope, setScope] = useState<'' | 'core' | 'market' | 'launcher'>('');
  const [group, setGroup] = useState<'all' | OpsGroup>('all');
  const [extra, setExtra] = useState<{ cursor: string | null; items: OpsLogItem[] }>({ cursor: null, items: [] });
  const [more, setMore] = useState<{ busy: boolean; error: ApiError | null }>({ busy: false, error: null });
  const s = useApi<OpsLog>(() => api.opsLog({ limit: 50, scope: scope || undefined }), `ops-${scope}`, 30000);
  const loadMore = async (cursor: string) => {
    setMore({ busy: true, error: null });
    try { const r = await api.opsLog({ limit: 50, scope: scope || undefined, before: cursor }); setExtra((e) => ({ cursor: r.next_cursor, items: [...e.items, ...r.items] })); setMore({ busy: false, error: null }); }
    catch (e) { setMore({ busy: false, error: e instanceof ApiError ? e : new ApiError('unreachable', 'Request failed.') }); }
  };
  const base = s.status === 'ok' ? s.data : null;
  const items = base ? [...base.items, ...extra.items].filter((i) => group === 'all' || groupOf(i.event) === group) : [];
  const cursor = extra.cursor ?? base?.next_cursor ?? null;
  return (
    <section aria-labelledby="ops-log-h">
      <h2 id="ops-log-h">What the contracts logged</h2>
      <div className="filters">
        <div className="seg" role="group" aria-label="Filter by kind">
          {FILTERS.map((f) => <button key={f} type="button" aria-pressed={group === f} onClick={() => setGroup(f)}>{f === 'all' ? 'All' : GROUP_LABEL[f]}</button>)}
        </div>
        <label className="inline" htmlFor="ops-scope">Contract
          <select id="ops-scope" style={{ width: 'auto', marginLeft: 8 }} value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setExtra({ cursor: null, items: [] }); }}>
            <option value="">All</option><option value="core">Core</option><option value="market">Market</option><option value="launcher">Instant launcher</option>
          </select>
        </label>
      </div>
      {s.status === 'loading' && <LoadingBlock label="Loading the operations log" />}
      {s.status === 'error' && <ErrorState error={s.error} what="the operations log" onRetry={s.reload} />}
      {base && (
        <>
          <div style={{ margin: '0 0 12px' }}><Freshness source={base.source} asOf={base.as_of} /></div>
          {items.length === 0
            ? <EmptyState title="No operator action has been taken.">{group === 'all' ? 'The indexer has read no pause, freeze, cap or similar event yet.' : 'Nothing of this kind in the entries loaded so far.'}</EmptyState>
            : <ol className="tl" aria-label="Operations log, newest first">{items.map((i) => <Row key={`${i.receipt_id}:${i.event}:${i.time}`} i={i} />)}</ol>}
          {cursor && <button type="button" className="btn-quiet" disabled={more.busy} onClick={() => void loadMore(cursor)}>{more.busy ? 'Loading' : 'Load older entries'}</button>}
          {more.error && <p className="bad" role="alert">{more.error.message}</p>}
          <p className="hint">This is a record of what the contracts logged, newest first. It is not a moderation list. Hiding a token from Kruxa feeds, when it exists, will be listed here with the token, reason, actor, time and appeal path.</p>
        </>
      )}
    </section>
  );
}

export function OpsLogView() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Operations log</p>
        <h1>Operator powers are public.</h1>
        <p className="lede">Every pause, freeze, halt, queued upgrade, force-resolve and cap change is a contract event. This page lists the powers, shows what is queued right now, and reads the log.</p>
      </header>
      <Powers />
      <ContractState />
      <Log />
    </>
  );
}
