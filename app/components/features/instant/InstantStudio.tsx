'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PayoutRecipientField, usePayoutRecipient, useWallet } from '@/components/wallet';
import { Badge } from '@/components/ui/Badges';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { ModeBadge } from '@/components/ui/PhaseBadge';
import { TxStatus } from '@/components/ui/TxStatus';
import { ChainActionButton } from '../trial/ChainActionButton';
import { InstantProgress } from './InstantProgress';
import { ACK_TEXT, RiskPanel } from './InstantParts';
import { FINAL_DEAD } from './useInstant';
import { api } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { createInstantNear } from '@/lib/actions';
import { EXPLAIN } from '@/lib/charter/explain';
import { feePreview } from '@/lib/charter/form';
import { summarizeFees, summarizeOpening } from '@/lib/charter/summary';
import { CONFIG, fmtUsdc } from '@/lib/config';
import { fmtNear, microFromDollars } from '@/lib/format';
import { INSTANT_DEFAULTS, DEPOSIT_ESTIMATE_YOCTO, deriveInstant, rateLimited, toInstantJson, validateInstant, type InstantParams } from '@/lib/instant/rules';
import { askLauncher, getInstantPhase, instantsByCreator, launcherConfig } from '@/lib/instant/preview';
import { summarizeAllocation, summarizeOpenPrice, summarizeSeed } from '@/lib/instant/summary';
import { useTx } from '@/lib/useTx';

interface Form { symbol: string; name: string; seed: string; allocPct: string; cliff: string; vest: string }
const FORM0: Form = { symbol: '', name: '', seed: '250', allocPct: '5', cliff: '7', vest: '90' };

function toParams(f: Form): { ok: true; params: InstantParams } | { ok: false; errors: Partial<Record<keyof Form, string>> } {
  const errors: Partial<Record<keyof Form, string>> = {};
  const seed = microFromDollars(f.seed);
  if (seed === null) errors.seed = 'Enter dollars, up to 6 decimals.';
  const pct = /^\d+(\.\d{1,2})?$/.test(f.allocPct) ? Math.round(Number(f.allocPct) * 100) : null;
  if (pct === null) errors.allocPct = 'Enter a percent, up to 2 decimals.';
  const cliff = /^\d+$/.test(f.cliff) ? Number(f.cliff) : null; if (cliff === null) errors.cliff = 'Enter whole days.';
  const vest = /^\d+$/.test(f.vest) ? Number(f.vest) : null; if (vest === null) errors.vest = 'Enter whole days.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, params: { ...INSTANT_DEFAULTS, symbol: f.symbol.trim(), name: f.name.trim(), seed_q: seed ?? 0n, creator_alloc_bps: pct ?? 0, cliff_days: cliff ?? 0, vest_days: vest ?? 0 } };
}

function Field({ id, label, value, onChange, error, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={`i-${id}`}>{label}</label>
      <input id={`i-${id}`} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={`i-${id}-d`} autoComplete="off" spellCheck={false} inputMode={id === 'symbol' || id === 'name' ? 'text' : 'decimal'} autoCapitalize={id === 'symbol' ? 'characters' : undefined} />
      <p id={`i-${id}-d`} className={error ? 'hint bad' : 'hint'}>{error ?? hint ?? ' '}</p>
    </div>
  );
}

const Summary = ({ text }: { text: string }) => <p className="summary"><b>Summary:</b> {text}</p>;

function Preview({ f, p }: { f: Form; p: InstantParams | null }) {
  const d = p ? deriveInstant(p, CONFIG.network) : null;
  return (
    <article className="lc" aria-label="Draft preview">
      <div className="lc-top">
        <LaunchSigil id="draft" symbol={f.symbol || '?'} />
        <div className="lc-id"><h3 className="lc-title">{f.name || 'Name'} <span className="lc-sym">${f.symbol || 'SYMBOL'}</span></h3><div className="sub">by you</div></div>
        <Badge tone="warn">Draft</Badge>
      </div>
      <div className="row"><ModeBadge mode="instant" /></div>
      <dl className="kv lc-kv">
        <div><dt>Opening price</dt><dd>{d?.openPriceUsdc != null ? `${d.openPriceUsdc.toPrecision(3)} USDC` : 'needs a valid seed'}</dd></div>
        <div><dt>Pool opens with</dt><dd>{d ? fmtUsdc(d.poolSeed) : 'n/a'}</dd></div>
        <div><dt>Your allocation</dt><dd>{p ? `${p.creator_alloc_bps / 100}% (unlocks slowly)` : 'n/a'}</dd></div>
      </dl>
      <div className="lc-foot"><span className="sub">Preview of how this launch appears in Discover</span></div>
    </article>
  );
}

export function InstantStudio() {
  const { sessions, adapters, guard } = useWallet();
  const signer = sessions.near?.address ?? null;
  const payout = usePayoutRecipient(signer, guard.env);
  const [f, setF] = useState<Form>(FORM0);
  const [ack, setAck] = useState(false);
  const tx = useTx();
  const [created, setCreated] = useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const parsed = useMemo(() => toParams(f), [f]);
  const local = useMemo(() => (parsed.ok ? validateInstant(parsed.params, CONFIG.network) : []), [parsed]);
  const derived = parsed.ok ? deriveInstant(parsed.params, CONFIG.network) : null;
  const key = parsed.ok ? JSON.stringify(toInstantJson(parsed.params)) : '';

  const cfg = useApi(() => launcherConfig(), 'launcher-config');
  const launcher = cfg.status === 'ok' ? cfg.data : null;
  const gateClosed = launcher?.kind === 'ok' && launcher.config.creator_gate === true;
  const mainnetClosed = CONFIG.network === 'mainnet' && (gateClosed || launcher?.kind !== 'ok');
  const notDeployed = launcher?.kind === 'not_deployed';
  const paused = launcher?.kind === 'ok' && launcher.config.paused !== undefined && launcher.config.paused !== 'None';

  const [ask, setAsk] = useState<Awaited<ReturnType<typeof askLauncher>> | 'asking' | null>(null);
  useEffect(() => {
    if (!parsed.ok) { setAsk(null); return; }
    setAsk('asking');
    let live = true;
    const t = setTimeout(() => { void askLauncher(parsed.params, signer, payout.resolution.ok ? payout.resolution.accountId : null).then((a) => { if (live) setAsk(a); }); }, 500);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signer]);

  const mine = useApi(signer ? () => api.launches({ creator: signer, launch_type: 'instant', include_failed: true, limit: 20 }) : null, `instant-mine-${signer}`);
  const recent = mine.status === 'ok' ? mine.data.items.filter((l) => (l.mode ?? 'trial') === 'instant').map((l) => l.created_at ?? 0) : [];
  const limited = rateLimited(recent, Math.floor(Date.now() / 1000));

  const [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    if (!signer || notDeployed) { setResume(null); return; }
    let live = true;
    void instantsByCreator(signer).then(async (ids) => {
      const last = ids[ids.length - 1];
      if (!last) return;
      const ph = await getInstantPhase(last);
      if (live && ph && ph.step !== 'done' && !FINAL_DEAD.includes(ph.status)) setResume(last);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [signer, notDeployed, created]);

  const launcherViolations = ask && ask !== 'asking' && ask.kind === 'refused' ? ask.violations : [];
  const deposit = ask && ask !== 'asking' && ask.kind === 'ok' ? ask.deposit : null;
  const clean = parsed.ok && local.length === 0 && launcherViolations.length === 0 && !limited;
  const canStart = clean && !!deposit && ack && payout.resolution.ok && !mainnetClosed && !notDeployed && !paused;
  const reason = !parsed.ok ? 'Fix the highlighted fields first.' : local.length || launcherViolations.length ? 'Fix the rule codes above. Nothing is signed.' : limited ? 'One instant launch per account per 24 hours.'
    : mainnetClosed ? 'Instant launches are closed on mainnet until the capped beta opens.' : notDeployed ? 'The instant launcher is not deployed on this network yet, so nothing can be created.' : paused ? 'The launcher is paused. Exits stay open; new launches do not.'
      : !deposit ? 'The required deposit comes from the launcher, which is not answering.' : !payout.resolution.ok ? payout.resolution.error : !ack ? 'Tick the acknowledgement to continue.' : 'No wallet is needed until you press the button.';

  async function step1() {
    if (!parsed.ok || !deposit || !payout.resolution.ok) return;
    const recipient = payout.resolution.isSeparate ? payout.resolution.accountId : null;
    await tx.run(async () => {
      const r = await adapters.near.signAndSendTransaction(createInstantNear(toInstantJson(parsed.params), recipient, deposit));
      try { const ids = await instantsByCreator(signer ?? ''); setCreated(ids[ids.length - 1] ?? null); } catch { /* the progress panel finds it later */ }
      return r;
    });
  }

  const p = parsed.ok ? parsed.params : null;
  const errors = parsed.ok ? {} : parsed.errors;
  return (
    <div className="studio">
      <aside className="studio-left" aria-label="Preview and consequences">
        <Preview f={f} p={p} />
        <section className="card" aria-labelledby="iw-h">
          <h2 id="iw-h" style={{ marginTop: 0, fontSize: '1.1rem' }}>What happens</h2>
          <ul className="sumlist">
            {p ? <><li>{summarizeSeed(p, CONFIG.network)}</li><li>{summarizeAllocation(p)}</li><li>{summarizeOpenPrice(p, CONFIG.network)}</li><li>Buyers get no trial and no refund. You cannot withdraw the seed.</li></> : <li>Fix the highlighted fields to see the consequences.</li>}
          </ul>
        </section>
      </aside>

      <div className="stack studio-right">
        {mainnetClosed && <div className="callout bad" role="status"><p><b>Instant launches are closed on mainnet until the capped beta opens.</b> Testnet is open to anyone.</p></div>}
        {notDeployed && <div className="callout" role="status"><p><b>The instant launcher is not deployed on this network yet.</b> The form below works as a preview with a local copy of the rules; nothing can be created.</p></div>}
        {resume && <><div className="callout info"><p>You have an instant launch in progress. Finish it here.</p></div><InstantProgress launchId={resume} /></>}
        <RiskPanel />

        <section className="card" aria-labelledby="iid-h">
          <h2 id="iid-h" style={{ marginTop: 0 }}>1. Identity</h2>
          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <Field id="symbol" label="Ticker (2 to 12 of A-Z, 0-9)" value={f.symbol} onChange={set('symbol')} hint="KRUXA and well-known tickers are reserved" />
            <Field id="name" label="Name" value={f.name} onChange={set('name')} />
          </div>
          <p className="hint">Image and links: not available yet. Each launch gets a generated mark.</p>
        </section>

        <section className="card" aria-labelledby="iseed-h">
          <h2 id="iseed-h" style={{ marginTop: 0 }}>2. Pool seed</h2>
          <Field id="seed" label="USDC seed ($100 to $1,000)" value={f.seed} onChange={set('seed')} error={errors.seed} hint="This USDC is locked in the pool permanently" />
          {p && <Summary text={summarizeSeed(p, CONFIG.network)} />}
          <p className="hint">Launch fee: flat $10 on mainnet only, taken from the seed. None on testnet.</p>
        </section>

        <section className="card" aria-labelledby="ialloc-h">
          <h2 id="ialloc-h" style={{ marginTop: 0 }}>3. Your allocation and unlock</h2>
          <label htmlFor="i-allocrange">Creator allocation: {f.allocPct}% (0 to 10%)</label>
          <input id="i-allocrange" type="range" min={0} max={10} step={0.5} value={Number(f.allocPct) || 0} onChange={(e) => set('allocPct')(e.target.value)} />
          {p && <div className="bar" role="img" aria-label={`Pool ${100 - p.creator_alloc_bps / 100}%, creator ${p.creator_alloc_bps / 100}%`}><span style={{ flex: 10000 - p.creator_alloc_bps, background: 'var(--ok)' }} /><span style={{ flex: Math.max(p.creator_alloc_bps, 1), background: 'var(--warn)' }} /></div>}
          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <Field id="allocPct" label="Allocation (percent)" value={f.allocPct} onChange={set('allocPct')} error={errors.allocPct} hint="default 5" />
            <span />
            <Field id="cliff" label="Cliff (days)" value={f.cliff} onChange={set('cliff')} error={errors.cliff} hint="7 to 30, default 7" />
            <Field id="vest" label="Unlock ends (days)" value={f.vest} onChange={set('vest')} error={errors.vest} hint="30 to 365, default 90" />
          </div>
          {p && <Summary text={summarizeAllocation(p)} />}
        </section>

        <section className="card" aria-labelledby="ifee-h">
          <h2 id="ifee-h" style={{ marginTop: 0 }}>4. Fees</h2>
          <Summary text={summarizeFees(INSTANT_DEFAULTS)} /><Summary text={summarizeOpening(INSTANT_DEFAULTS)} />
          <dl className="kv">{feePreview(INSTANT_DEFAULTS).map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.pct}</dd></div>)}</dl>
          <p className="hint">The same fee terms as a trial launch. In this release the holders and referral slices go to liquidity. Not a promise of income.</p>
        </section>

        <PayoutRecipientField state={payout.state} onChange={payout.setState} resolution={payout.resolution} signer={signer} />

        <section className="card" aria-labelledby="iunused-h">
          <h2 id="iunused-h" style={{ marginTop: 0, fontSize: '1.05rem' }}>Not used by instant launches</h2>
          <p className="hint" aria-disabled="true">Raise, soft cap, minimum backers, commit and Walk windows, sale and backer buckets, stream length, Solana genesis. There is no trial.</p>
        </section>

        <section className="card" aria-labelledby="irules-h">
          <div className="row between"><h2 id="irules-h" style={{ margin: 0 }}>5. Rule codes</h2>{parsed.ok ? <Badge tone={local.length + launcherViolations.length ? 'fail' : 'pass'}>{local.length + launcherViolations.length ? 'Refused' : 'All rules pass'}</Badge> : <Badge tone="muted">Fix the fields</Badge>}</div>
          <div aria-live="polite">
            {local.map((v) => <div key={`${v.code}-${v.field}`} className="callout bad"><p><code>{v.code}</code> on <b>{v.field}</b></p><p>{EXPLAIN[v.code]}</p><p className="mono">got {v.got}, allowed {v.limit}</p></div>)}
            {limited && <div className="callout bad"><p><code>R_RATE_LIMIT</code> {EXPLAIN.R_RATE_LIMIT}</p></div>}
            {launcherViolations.filter((lv) => !local.some((l) => l.code === lv.code)).map((lv) => <div key={lv.code} className="callout bad"><p><code>{lv.code}</code> from the launcher {lv.field ? <>on <b>{lv.field}</b></> : null}</p></div>)}
          </div>
          <p className="hint"><Badge tone="muted">local mirror</Badge> Shown instantly with no network. The launcher&apos;s own answer is next.</p>
          <h3 style={{ fontSize: '1rem' }}>Launcher check</h3>
          <div aria-live="polite">
            {ask === null && <p>Waiting for valid fields.</p>}{ask === 'asking' && <p>Asking the launcher.</p>}
            {ask && ask !== 'asking' && ask.kind === 'ok' && <p className="ok">The launcher accepts these parameters (via <code>preview_instant</code>).</p>}
            {ask && ask !== 'asking' && ask.kind === 'refused' && <p className="bad">The launcher refused with {ask.violations.map((v) => <code key={v.code} style={{ marginRight: 6 }}>{v.code}</code>)}.</p>}
            {ask && ask !== 'asking' && ask.kind === 'not_deployed' && <p className="warn">The launcher is not deployed here, so only the local mirror is shown. Nothing is claimed about what it would say.</p>}
            {ask && ask !== 'asking' && ask.kind === 'unreachable' && <p className="warn">The launcher could not be asked ({ask.message}). Only the local mirror is shown.</p>}
          </div>
        </section>

        <section className="card" aria-labelledby="irev-h">
          <h2 id="irev-h" style={{ marginTop: 0 }}>6. Review and launch</h2>
          {deposit ? <p><span className="big">{fmtNear(deposit)}</span><br /><span className="muted">required deposit from the launcher: factory fee, storage and token registration. The refundable part comes back only if the launch ends before it opens.</span></p>
            : <p>Estimate while the launcher is silent: about <b>{fmtNear(DEPOSIT_ESTIMATE_YOCTO)}</b> (INSTANT-ABI section 5). The exact figure comes from the launcher.</p>}
          {derived && <p className="hint">Pool opens with {fmtUsdc(derived.poolSeed)} of the {fmtUsdc(parsed.ok ? parsed.params.seed_q : 0n)} seed. One instant launch per account per 24 hours.</p>}
          <label className="inline"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} aria-describedby="ack-d" /> {ACK_TEXT}</label>
          <p id="ack-d" className="hint">Required before step 1.</p>
          <ChainActionButton chain="near" action="create" disabled={!canStart} loading={tx.state.status === 'pending'} className="btn-primary" onReady={() => void step1()}>
            Step 1 of 3: Create token{deposit ? ` (deposit ${fmtNear(deposit)})` : ''}
          </ChainActionButton>
          <p className="hint">{reason}</p>
          <TxStatus state={tx.state} />
          {created && <InstantProgress launchId={created} />}
          {tx.state.status === 'done' && !created && <div className="callout ok"><p><b>Submitted.</b> The launch appears under Resume above, and in <Link href="/creator">your Creator desk</Link>, once the launcher has recorded it. Then seed and open.</p></div>}
        </section>
      </div>
    </div>
  );
}
