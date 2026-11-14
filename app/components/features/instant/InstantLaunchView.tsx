'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { LaunchDetail } from '@/lib/api/types';
import { useApi } from '@/lib/api/useApi';
import { Badge, SourceBadge } from '@/components/ui/Badges';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { ModeBadge, PhaseBadge } from '@/components/ui/PhaseBadge';
import { shortAccount } from '@/lib/format';
import { fmtUsdc } from '@/lib/config';
import { phaseOf } from '@/lib/phase';
import { InstantNotice, RiskPanel } from './InstantParts';
import { InstantProgress } from './InstantProgress';
import { VestPanel } from './VestPanel';
import { useInstantLaunch, useLauncherUnit } from './useInstant';
import { termWord } from '@/lib/instant/rules';
import { cliffSharePct, tradeCountdown } from '@/lib/instant/summary';

const STEP_LABEL = { created: 'Create the token', seeded: 'Seed the pool with your USDC', trading: 'Open the pool' } as const;

/** Read-only steps from the indexer, shown when the launcher cannot be read. No action buttons: the launcher decides what is allowed. */
function IndexedSteps({ l }: { l: LaunchDetail }) {
  const steps = l.instant?.steps ?? [];
  return (
    <section className="card" aria-labelledby="ixs-h">
      <div className="row between"><h2 id="ixs-h" style={{ margin: 0, fontSize: '1.15rem' }}>Launch steps</h2><Badge tone="source">Indexer view</Badge></div>
      <p className="hint">The launcher could not be read, so these steps come from the indexer and no action is offered. Status: {l.instant?.status ?? 'unknown'}{l.instant?.failure ? ` (${l.instant.failure})` : ''}.</p>
      <ol className="tl">{steps.map((s, i) => <li key={s.step}><b>Step {i + 1} of 3: {STEP_LABEL[s.step]}</b> {s.done ? <Badge tone="pass">Done</Badge> : <Badge tone="muted">Not yet</Badge>}{s.receipt_id && <span className="when">receipt {s.receipt_id}</span>}</li>)}</ol>
    </section>
  );
}

/** Counts down to the announced open (`trade_from_ns`); renders nothing once trading is open or when the pool never announced one. */
function TradeCountdown({ tradeFromNs }: { tradeFromNs: string | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const text = tradeCountdown(tradeFromNs, now);
  useEffect(() => {
    if (!text) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [text]);
  return text ? <p className="hint" role="status" aria-live="off">{text}. The pool is open and visible; buys are refused until then (R_NOT_YET_TRADING).</p> : null;
}

/** /launch/[id] for an instant launch (id at or above 1,000,000,000): no verdict, no Walk, no stepper of a trial. The launcher's views are the authority. */
export function InstantLaunchView() {
  const { id } = useParams<{ id: string }>();
  const idx = useApi(() => api.launch(id), `instant-idx-${id}`, 15000);
  const chain = useInstantLaunch(id);
  const { unit } = useLauncherUnit();
  const l = idx.status === 'ok' ? idx.data : null;
  const rec = chain.status === 'ok' ? chain.data.record : null;
  const symbol = rec?.symbol ?? l?.symbol ?? '';
  const phase = l ? phaseOf({ ...l, mode: 'instant' }, Math.floor(Date.now() / 1000)) : null;
  return (
    <>
      <header className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <LaunchSigil id={id} symbol={symbol || '?'} size={64} />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Launch #{id} · instant</p>
            <h1>{rec?.name && rec.name !== symbol ? <>{rec.name} <span style={{ color: 'var(--accent)' }}>${symbol}</span></> : <>${symbol || 'Instant launch'}</>}</h1>
            <div className="row" style={{ marginTop: 8 }}><ModeBadge mode="instant" />{phase && <PhaseBadge phase={phase} />}{l && <SourceBadge source={l.source} />}</div>
          </div>
        </div>
        {rec && <TradeCountdown tradeFromNs={rec.trade_from_ns} />}
        {(rec || l) && <p className="hint">Creator {shortAccount(rec?.creator ?? l?.creator ?? '')} · payout recipient {shortAccount(rec?.payout_recipient ?? l?.payout_recipient ?? '')}</p>}
      </header>
      <InstantNotice />
      <div className="grid grid-aside">
        <div className="stack">
          {chain.status === 'error' && l?.instant
            ? <IndexedSteps l={l} />
            : <InstantProgress launchId={id} onChanged={() => idx.reload()} />}
          {rec && (
            <section className="card" aria-labelledby="it-h">
              <h2 id="it-h" style={{ marginTop: 0 }}>Terms</h2>
              <dl className="kv">
                <div><dt>Pool seed</dt><dd>{fmtUsdc(rec.seed_q)} (locked in the pool, not withdrawable)</dd></div>
                <div><dt>Launch fee</dt><dd>{fmtUsdc(rec.launch_fee)}</dd></div>
                <div><dt>Pool opens with</dt><dd>{fmtUsdc(rec.pool_seed_q)}</dd></div>
                <div><dt>Creator allocation</dt><dd>{rec.creator_alloc_bps / 100}%</dd></div>
                <div><dt>Cliff</dt><dd>{termWord(rec.cliff_days, unit)}; {cliffSharePct(rec)} unlocks at once at the cliff</dd></div>
                <div><dt>Fully unlocked</dt><dd>{termWord(rec.vest_days, unit)} after the pool opens</dd></div>
                <div><dt>Supply</dt><dd>fixed at creation</dd></div>
                <div><dt>Solana mint</dt><dd>none (NEAR-only launch)</dd></div>
              </dl>
              <p className="hint">The token code is the factory&apos;s global contract; its publisher key can change it (disclosed). Not an authority tile: nothing here says the authorities are null.</p>
            </section>
          )}
          {chain.status === 'ok' && chain.data.phase?.status === 'Open' && (
            <section className="card" aria-labelledby="iv-h"><h2 id="iv-h" style={{ marginTop: 0 }}>Creator allocation</h2><VestPanel launchId={id} symbol={symbol} /></section>
          )}
        </div>
        <div className="stack">
          <RiskPanel />
          <section className="card"><p>Verify: an instant launch has no verdict to recompute. What can be checked is the pool and the supply. <Link href="/docs/security">Security notes</Link>.</p><Badge tone="muted">no verdict</Badge></section>
        </div>
      </div>
    </>
  );
}
