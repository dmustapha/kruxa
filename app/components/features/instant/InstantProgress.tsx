'use client';
import Link from 'next/link';
import { useWallet } from '@/components/wallet';
import { ChainActionButton } from '../trial/ChainActionButton';
import { ErrorState, LoadingBlock } from '@/components/ui/States';
import { TxStatus } from '@/components/ui/TxStatus';
import { abortInstantNear, cancelInstantNear, openInstantNear, reclaimDepositNear, seedInstantNear } from '@/lib/actions';
import { fmtUsdc } from '@/lib/config';
import { useTx } from '@/lib/useTx';
import { StatusPill } from './InstantParts';
import { FINAL_DEAD, useInstantLaunch } from './useInstant';

type Step = { n: number; label: string; state: 'done' | 'next' | 'wait' | 'dead' };

export function stepsFor(status: string | undefined, next: string | undefined): Step[] {
  const dead = !!status && FINAL_DEAD.includes(status);
  const created = ['TokenReady', 'Seeded', 'Handoff', 'Open'].includes(status ?? '');
  const seeded = ['Seeded', 'Handoff', 'Open'].includes(status ?? '');
  const open = status === 'Open';
  return [
    { n: 1, label: 'Create the token', state: created ? 'done' : dead ? 'dead' : 'next' },
    { n: 2, label: 'Seed the pool with your USDC', state: seeded ? 'done' : dead ? 'dead' : created ? 'next' : 'wait' },
    { n: 3, label: 'Open the pool', state: open ? 'done' : dead ? 'dead' : seeded || next === 'open_instant' || next === 'retry_open_instant' ? 'next' : 'wait' },
  ];
}

/** The three-step tracker for one instant launch, with the one action each step needs. Statuses come from the launcher, never from this page. */
export function InstantProgress({ launchId, onChanged }: { launchId: string; onChanged?: () => void }) {
  const s = useInstantLaunch(launchId);
  const { sessions, adapters } = useWallet();
  const seedTx = useTx(); const openTx = useTx(); const endTx = useTx();
  if (s.status === 'loading' || s.status === 'idle') return <LoadingBlock label="Reading the launcher" lines={3} />;
  if (s.status === 'error') return <ErrorState error={s.error} what="the instant launch" onRetry={s.reload} />;
  const { phase, record } = s.data;
  if (!phase || !record) return <div className="callout"><p>The launcher has no launch {launchId}.</p></div>;
  const steps = stepsFor(phase.status, phase.next_action);
  const isCreator = sessions.near?.address === record.creator;
  const dead = FINAL_DEAD.includes(phase.status);
  const run = (t: typeof seedTx, build: () => Parameters<typeof adapters.near.signAndSendTransaction>[0]) =>
    t.run(async () => { const r = await adapters.near.signAndSendTransaction(build()); onChanged?.(); s.reload(); return r; });

  return (
    <section className="card" aria-labelledby={`ip-${launchId}`}>
      <div className="row between"><h2 id={`ip-${launchId}`} style={{ margin: 0, fontSize: '1.15rem' }}>${record.symbol} launch steps</h2><span className="mono hint">status {phase.status}</span></div>
      <ol className="tl" aria-label="Instant launch steps" style={{ marginTop: 12 }}>
        {steps.map((st) => <li key={st.n} aria-current={st.state === 'next' ? 'step' : undefined}><b>Step {st.n} of 3: {st.label}</b> <StatusPill state={st.state} /></li>)}
      </ol>
      {!dead && phase.status === 'TokenReady' && (
        <div className="stack">
          <ChainActionButton chain="near" action="commit" disabled={!isCreator && !!sessions.near} loading={seedTx.state.status === 'pending'} className="btn-primary"
            onReady={() => void run(seedTx, () => seedInstantNear(launchId, BigInt(record.seed_q)))}>
            Step 2 of 3: Seed pool ({fmtUsdc(record.seed_q)} USDC)
          </ChainActionButton>
          <p className="hint">The exact amount, once. Only the creator ({record.creator}) can seed; a different amount is returned by the token contract.{sessions.near && !isCreator ? ' You are connected as a different account.' : ''}</p>
          <TxStatus state={seedTx.state} />
          {isCreator && <button type="button" className="btn-quiet" onClick={() => void run(endTx, () => cancelInstantNear(launchId))}>Cancel before seeding</button>}
        </div>
      )}
      {!dead && (phase.next_action === 'open_instant' || phase.next_action === 'retry_open_instant') && (
        <div className="stack">
          <ChainActionButton chain="near" action="claim" loading={openTx.state.status === 'pending'} className="btn-primary" onReady={() => void run(openTx, () => openInstantNear(launchId))}>
            {phase.next_action === 'retry_open_instant' ? 'Step 3 of 3: Retry opening the pool' : 'Step 3 of 3: Open the pool'}
          </ChainActionButton>
          <p className="hint">Anyone can open it. It hands your seed to the market and then the pool tokens. A retry sends only what is missing. Once the market has taken the seed it is not refundable.</p>
          <TxStatus state={openTx.state} />
          {isCreator && phase.status === 'Seeded' && <button type="button" className="btn-quiet" onClick={() => void run(endTx, () => abortInstantNear(launchId))}>Abort and take the seed back (allowed only after the launcher's abort delay, and only if the market has taken none of it)</button>}
        </div>
      )}
      {dead && (
        <div className="callout bad"><p><b>This launch ended: {phase.status}.</b> The token will never be listed.</p>
          {isCreator && <button type="button" onClick={() => void run(endTx, () => reclaimDepositNear(launchId))}>Reclaim the refundable part of the deposit</button>}
          <p className="hint">The factory keeps its token deposit, so the refund is smaller than what you attached.</p></div>
      )}
      {phase.status === 'Open' && <p>The pool is open. <Link href={`/token/${launchId}`}>Open the trade view</Link>.</p>}
      <TxStatus state={endTx.state} />
    </section>
  );
}

