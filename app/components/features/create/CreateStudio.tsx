'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayoutRecipientField, WalletActionButton, usePayoutRecipient, useWallet } from '@/components/wallet';
import { Badge } from '@/components/ui/Badges';
import { LaunchSigil } from '@/components/ui/LaunchSigil';
import { VerdictMeters } from '@/components/ui/VerdictMeters';
import { api } from '@/lib/api/client';
import { scenarios } from '@/lib/charter/scenarios';
import { summarizeBuckets, summarizeFees, summarizeOpening, summarizeRaise, summarizeStream, summarizeTime } from '@/lib/charter/summary';
import Link from 'next/link';
import { TxStatus } from '@/components/ui/TxStatus';
import { createTrialNear } from '@/lib/actions';
import { agreement, askContract, type ContractAnswer } from '@/lib/charter/preview';
import { EXPLAIN } from '@/lib/charter/explain';
import { VolumeScenarios } from '../VolumeScenarios';
import { feePreview, formFromPreset, paramsFromForm, type FormState } from '@/lib/charter/form';
import { PRESETS, presetById } from '@/lib/charter/presets';
import { DEMO_RULES, LADDER_RULES, bondRequired, derive, toContractJson, validateAll } from '@/lib/charter/rules';
import { fmtUsdc } from '@/lib/config';
import { fmtNear, microFromDollars } from '@/lib/format';
import { useTx } from '@/lib/useTx';

type Ask = { status: 'idle' } | { status: 'asking' } | { status: 'done'; answer: ContractAnswer };

function Field({ id, label, value, onChange, error, hint, width }: { id: keyof FormState; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; width?: number }) {
  return (
    <div style={width ? { maxWidth: width } : undefined}>
      <label htmlFor={`f-${id}`}>{label}</label>
      <input id={`f-${id}`} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={`f-${id}-d`} inputMode={id === 'symbol' || id === 'name' ? 'text' : 'decimal'} autoCapitalize={id === 'symbol' ? 'characters' : undefined} autoComplete="off" spellCheck={false} />
      <p id={`f-${id}-d`} className={error ? 'hint bad' : 'hint'}>{error ?? hint ?? ' '}</p>
    </div>
  );
}


function Summary({ text }: { text: string }) {
  return <p className="summary"><b>Summary:</b> {text}</p>;
}

const CONTRACT_EXPLAIN: Record<string, string> = {
  R_CREATOR_GATE: 'Mainnet creation is closed until the capped beta opens. Testnet is open to anyone.',
  R_ACTIVE_TRIAL: 'This account already has an active trial. One at a time.',
  R_CAP_GLOBAL: 'The global cap across all launches has no room for this hard cap.',
};

function PreviewCard({ f, signer }: { f: FormState; signer: string | null }) {
  const soft = microFromDollars(f.softCap);
  const minF = /^\d+$/.test(f.minFunders) ? Number(f.minFunders) : null;
  return (
    <article className="lc" aria-label="Draft preview">
      <div className="lc-top">
        <LaunchSigil id="draft" symbol={f.symbol || '?'} />
        <div className="lc-id">
          <h3 className="lc-title">{f.name || 'Name'} <span className="lc-sym">${f.symbol || 'SYMBOL'}</span></h3>
          <div className="sub">by {signer ?? 'you'}</div>
        </div>
        <Badge tone="warn">Draft</Badge>
      </div>
      <VerdictMeters l={{ total_active: '0', soft_cap: soft?.toString() ?? null, funders: 0, min_funders: minF, verdict: null }} />
      <div className="lc-foot"><span className="sub">Preview of how this trial appears in Discover</span></div>
    </article>
  );
}

function ScenarioTable({ rows }: { rows: NonNullable<ReturnType<typeof scenarios>> }) {
  return (
    <div className="tbl-wrap">
      <table>
        <caption className="sr-only">Raise scenarios</caption>
        <thead><tr><th>If committed</th><th>Verdict</th><th className="n">Accepted</th><th className="n">Launch fee</th><th className="n">LP seed</th><th className="n">Stream</th><th className="n">Per day</th><th className="n">A $100 backer pays</th><th className="n">Refund</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.label}>
            <td><b>{r.label}</b><div className="hint">{fmtUsdc(r.committed)}</div></td>
            <td><Badge tone={r.verdict === 'PASS' ? 'pass' : 'fail'}>{r.verdict}</Badge></td>
            <td className="n">{fmtUsdc(r.accepted)}</td><td className="n">{fmtUsdc(r.launchFee)}</td><td className="n">{fmtUsdc(r.lpSeed)}</td>
            <td className="n">{fmtUsdc(r.stream)}</td><td className="n">{fmtUsdc(r.streamPerDay)}</td><td className="n">{fmtUsdc(r.sample.spend)}</td><td className="n">{fmtUsdc(r.sample.refund)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function CreateStudio() {
  const search = useSearchParams();
  const { sessions, adapters, guard } = useWallet();
  const [presetId, setPresetId] = useState(() => presetById(search.get('preset') ?? 'standard').id);
  const [form, setForm] = useState<FormState>(() => formFromPreset(presetById(search.get('preset') ?? 'standard')));
  const [profile, setProfile] = useState<'ladder' | 'demo'>('ladder');
  const [ask, setAsk] = useState<Ask>({ status: 'idle' });
  const signer = sessions.near?.address ?? null;
  const payout = usePayoutRecipient(signer, guard.env);
  const tx = useTx();
  const [active, setActive] = useState<string | null>(null);
  const set = (k: keyof FormState) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setPresetId('custom'); };

  useEffect(() => {
    if (!signer) { setActive(null); return; }
    let live = true;
    api.launches({ creator: signer, limit: 20 }).then((r) => { if (live) setActive(r.items.find((l) => l.status === 'open' || l.status === 'creating')?.launch_id ?? null); }, () => { if (live) setActive(null); });
    return () => { live = false; };
  }, [signer]);

  const wanted = search.get('preset');
  useEffect(() => {
    if (!wanted) return;
    const p = presetById(wanted);
    setPresetId(p.id);
    setForm((f) => formFromPreset(p, p.id === 'hostile' ? undefined : { symbol: f.symbol, name: f.name }));
  }, [wanted]);

  const parsed = useMemo(() => paramsFromForm(form), [form]);
  const rules = profile === 'demo' ? DEMO_RULES : LADDER_RULES;
  const violations = useMemo(() => (parsed.ok ? validateAll(parsed.params, rules) : []), [parsed, rules]);
  const derived = useMemo(() => (parsed.ok ? derive(parsed.params, rules) : null), [parsed, rules]);
  const key = parsed.ok ? JSON.stringify(toContractJson(parsed.params)) : '';

  useEffect(() => {
    if (!parsed.ok || profile === 'demo') { setAsk({ status: 'idle' }); return; }
    setAsk({ status: 'asking' });
    let live = true;
    const t = setTimeout(() => { void askContract(parsed.params).then((answer) => { if (live) setAsk({ status: 'done', answer }); }); }, 500);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, profile]);

  const answer = ask.status === 'done' ? ask.answer : null;
  const contractRefused = answer?.kind === 'refused';
  const deposit = answer?.kind === 'ok' ? answer.deposit : null;
  const clean = parsed.ok && violations.length === 0 && !contractRefused && !active;
  const rows = parsed.ok && violations.length === 0 ? scenarios(parsed.params, rules) : null;
  const canCreate = clean && !!deposit && payout.resolution.ok && profile === 'ladder';
  const errors = parsed.ok ? {} : parsed.errors;

  function pickPreset(id: string) {
    const p = presetById(id);
    setPresetId(p.id);
    setForm((f) => formFromPreset(p, p.id === 'hostile' ? undefined : { symbol: f.symbol, name: f.name }));
  }

  async function create() {
    if (!parsed.ok || !deposit || !payout.resolution.ok) return;
    const recipient = payout.resolution.isSeparate ? payout.resolution.accountId : null;
    await tx.run(() => adapters.near.signAndSendTransaction(createTrialNear({ params: toContractJson(parsed.params), streamRecipient: recipient, depositYocto: deposit })));
  }

  return (
    <div className="studio">
      <aside className="studio-left" aria-label="Preview and consequences">
        <PreviewCard f={form} signer={signer} />
        <section className="card" aria-labelledby="what-h">
          <h2 id="what-h" style={{ marginTop: 0, fontSize: '1.1rem' }}>What happens</h2>
          <ul className="sumlist">
            {parsed.ok ? (
              <>
                <li>{summarizeRaise(parsed.params)}</li>
                <li>{summarizeTime(parsed.params)}</li>
                <li>{summarizeBuckets(parsed.params)}</li>
                <li>{summarizeStream(parsed.params)}</li>
              </>
            ) : <li>Fix the highlighted fields to see the consequences.</li>}
          </ul>
        </section>
      </aside>

      <div className="stack studio-right">
        <section className="card" aria-labelledby="preset-h">
          <h2 id="preset-h" style={{ marginTop: 0 }}>1. Start from a preset</h2>
          <div className="seg" role="radiogroup" aria-label="Presets">
            {PRESETS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={presetId === p.id} aria-pressed={presetId === p.id} onClick={() => pickPreset(p.id)}>{p.expectRefusal ? 'Hostile example, will be refused' : p.label}</button>)}
            {presetId === 'custom' && <button type="button" role="radio" aria-checked="true" aria-pressed="true" disabled>Custom</button>}
          </div>
          <p className="hint">{presetId === 'custom' ? 'Edited by hand. The rules are checked on every keystroke.' : presetById(presetId).blurb}</p>
        </section>

        <form className="stack" onSubmit={(e) => e.preventDefault()} aria-label="Charter" noValidate>
          <section className="card" aria-labelledby="id-h">
            <h2 id="id-h" style={{ marginTop: 0 }}>2. Identity</h2>
            <div className="grid grid-2" style={{ gap: '0 16px' }}>
              <Field id="symbol" label="Ticker (2 to 12 of A-Z, 0-9)" value={form.symbol} onChange={set('symbol')} error={errors.symbol} />
              <Field id="name" label="Name" value={form.name} onChange={set('name')} error={errors.name} />
            </div>
            <p className="hint" aria-disabled="true">Image and links: not available yet. Each launch gets a generated mark until token metadata is final.</p>
          </section>

          <section className="card" aria-labelledby="raise-h">
            <h2 id="raise-h" style={{ marginTop: 0 }}>3. Raise</h2>
            <div className="grid grid-2" style={{ gap: '0 16px' }}>
              <Field id="hardCap" label="Hard cap (USDC)" value={form.hardCap} onChange={set('hardCap')} error={errors.hardCap} hint="$500 to $1,000 on this profile" />
              <Field id="softCap" label="Soft cap (USDC)" value={form.softCap} onChange={set('softCap')} error={errors.softCap} hint="PASS needs at least this much" />
              <Field id="minBuy" label="Minimum buy (USDC)" value={form.minBuy} onChange={set('minBuy')} error={errors.minBuy} />
              <Field id="minFunders" label="Minimum backers" value={form.minFunders} onChange={set('minFunders')} error={errors.minFunders} hint="PASS needs at least this many" />
              <Field id="walletBps" label="Per-wallet cap (bps of hard cap)" value={form.walletBps} onChange={set('walletBps')} error={errors.walletBps} hint="50 to 500" />
            </div>
            {parsed.ok && <Summary text={summarizeRaise(parsed.params)} />}
          </section>

          <section className="card" aria-labelledby="time-h">
            <h2 id="time-h" style={{ marginTop: 0 }}>4. Time</h2>
            <div className="grid grid-2" style={{ gap: '0 16px' }}>
              <Field id="commitHours" label="Commit window (hours)" value={form.commitHours} onChange={set('commitHours')} error={errors.commitHours} hint="24 h to 30 days" />
              <Field id="tailHours" label="Walk window after commits (hours)" value={form.tailHours} onChange={set('tailHours')} error={errors.tailHours} hint="1 h to 48 h" />
            </div>
            {parsed.ok && <Summary text={summarizeTime(parsed.params)} />}
            <label htmlFor="profile">Rule profile</label>
            <select id="profile" value={profile} onChange={(e) => setProfile(e.target.value as 'ladder' | 'demo')} style={{ maxWidth: 360 }}>
              <option value="ladder">Capped ladder (testnet default)</option>
              <option value="demo">Demo clock (separate labelled account, preview only)</option>
            </select>
            {profile === 'demo' && <p className="hint">Demo clock allows a 90 second commit window and a 30 second Walk window. It runs on a separate account and is preview only here.</p>}
          </section>

          <section className="card" aria-labelledby="supply-h">
            <h2 id="supply-h" style={{ marginTop: 0 }}>5. Supply split</h2>
            {parsed.ok && (
              <div className="bar" role="img" aria-label={`Sale ${parsed.params.sale_bps / 100}%, LP ${parsed.params.lp_bps / 100}%, creator ${parsed.params.creator_bps / 100}%, backer ${parsed.params.backer_bps / 100}%`}>
                <span style={{ flex: parsed.params.sale_bps, background: 'var(--info)' }} /><span style={{ flex: parsed.params.lp_bps, background: 'var(--ok)' }} /><span style={{ flex: parsed.params.creator_bps, background: 'var(--warn)' }} /><span style={{ flex: parsed.params.backer_bps, background: 'var(--muted)' }} />
              </div>
            )}
            <div className="grid grid-2" style={{ gap: '0 16px' }}>
              <Field id="saleBps" label="Sale bucket (bps)" value={form.saleBps} onChange={set('saleBps')} error={errors.saleBps} hint="5000 to 8000" />
              <Field id="lpBps" label="LP bucket (bps)" value={form.lpBps} onChange={set('lpBps')} error={errors.lpBps} hint="1500 to 4000" />
              <Field id="creatorBps" label="Creator bucket (bps)" value={form.creatorBps} onChange={set('creatorBps')} error={errors.creatorBps} hint="0 to 2000" />
              <Field id="backerBps" label="Backer bonus bucket (bps)" value={form.backerBps} onChange={set('backerBps')} error={errors.backerBps} hint="0 to 1000; creator plus backer at most 2500" />
              <Field id="supply" label="Supply (whole tokens)" value={form.supply} onChange={set('supply')} error={errors.supply} hint="10 million to 1 trillion" />
            </div>
            {parsed.ok && <Summary text={summarizeBuckets(parsed.params)} />}
          </section>

          <section className="card" aria-labelledby="earn-h">
            <h2 id="earn-h" style={{ marginTop: 0 }}>6. Creator earnings</h2>
            <div className="grid grid-2" style={{ gap: '0 16px' }}><Field id="streamDays" label="Stream length (days)" value={form.streamDays} onChange={set('streamDays')} error={errors.streamDays} hint="at least 30 days up to $25,000" /></div>
            {parsed.ok && <><Summary text={summarizeStream(parsed.params)} /><Summary text={summarizeFees(parsed.params)} /><Summary text={summarizeOpening(parsed.params)} /></>}
            {parsed.ok && (
              <>
                <h3 style={{ fontSize: '1rem' }}>Fee preview</h3>
                <dl className="kv">{feePreview(parsed.params).map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.pct}</dd></div>)}</dl>
                <h3 style={{ fontSize: '1rem' }}>Volume scenarios</h3>
                <VolumeScenarios fees={parsed.params.fees} />
                <p className="hint">Shares of trade volume at the committed standard terms, vesting {parsed.params.fees.fee_vest_bps / 100}% over {parsed.params.fees.fee_vest_days} days. In this release the holders and referral slices go to liquidity. Fees apply only once a pool exists. A model of your terms, not a forecast, and not a promise of income.</p>
              </>
            )}
          </section>
        </form>

        <section className="card" aria-labelledby="sim-h">
          <h2 id="sim-h" style={{ marginTop: 0 }}>Raise scenarios</h2>
          {rows ? <ScenarioTable rows={rows} /> : <p>{parsed.ok ? 'Fix the rule codes to see the scenarios.' : 'Fix the highlighted fields to see the scenarios.'}</p>}
          <p className="hint">Computed in your browser with the same integer rules as the contract. A model of your terms, not a forecast.</p>
          <details>
            <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Test your terms against a simulated crowd</summary>
            <p>Three recorded, scripted crowd runs are committed (snipers, whales, a sybil ring, a walk-flipper; see docs/interfaces/swarm-crowd-test.json). Replaying them against your own terms is not built yet, so no result for your terms is shown here and none is implied.</p>
          </details>
        </section>

        <PayoutRecipientField state={payout.state} onChange={payout.setState} resolution={payout.resolution} signer={signer} />

        <section className="card" aria-labelledby="rules-h">
          <div className="row between"><h2 id="rules-h" style={{ margin: 0 }}>7. Rule codes</h2>
            {parsed.ok ? <Badge tone={violations.length ? 'fail' : 'pass'}>{violations.length ? `${violations.length} refused` : 'All rules pass'}</Badge> : <Badge tone="muted">Fix the fields</Badge>}</div>
          <div aria-live="polite">
            {violations.length === 0 && parsed.ok && <p>Every rule passes in the local mirror of the contract&apos;s checks.</p>}
            {violations.map((v) => (
              <div key={`${v.code}-${v.field}`} className="callout bad">
                <p><code>{v.code}</code> on <b>{v.field}</b></p>
                <p>{EXPLAIN[v.code]}</p>
                <p className="mono">got {v.got}, allowed {v.limit}</p>
              </div>
            ))}
            {active && <div className="callout bad"><p><code>R_ACTIVE_TRIAL</code> {CONTRACT_EXPLAIN['R_ACTIVE_TRIAL']} Launch <Link href={`/launch/${active}`}>#{active}</Link> is still open.</p></div>}
          </div>
          <p className="hint"><Badge tone="muted">local mirror</Badge> Shown instantly with no network. The contract&apos;s own answer is next.</p>
          <h3 style={{ fontSize: '1rem' }}>Contract check</h3>
          <div aria-live="polite">
            {profile === 'demo' && <p>Not asked: the demo profile lives on a separate account.</p>}
            {profile === 'ladder' && ask.status === 'idle' && <p>Waiting for valid fields.</p>}
            {ask.status === 'asking' && <p>Asking the contract.</p>}
            {answer?.kind === 'ok' && <p className="ok">The contract accepts this Charter (via <code>{answer.via}</code>).</p>}
            {answer?.kind === 'refused' && <><p className="bad">The contract refused with {answer.codes.map((c) => <code key={c} style={{ marginRight: 6 }}>{c}</code>)}(via <code>{answer.via}</code>).</p>{answer.codes.filter((c) => CONTRACT_EXPLAIN[c]).map((c) => <p key={c} className="hint">{CONTRACT_EXPLAIN[c]}</p>)}</>}
            {answer?.kind === 'unreachable' && <p className="warn">The contract could not be asked ({answer.message}). Only the local mirror is shown; nothing is claimed about what the contract would say.</p>}
            {answer && agreement(violations, answer) === 'disagree' && <p className="callout bad">The local mirror and the contract disagree. Trust the contract and report this.</p>}
          </div>
        </section>

        <section className="card" aria-labelledby="rev-h">
          <h2 id="rev-h" style={{ marginTop: 0 }}>8. Review and create</h2>
          {deposit ? <p><span className="big">{fmtNear(deposit)}</span><br /><span className="muted">required deposit from <code>required_deposit</code>: a storage bond (refundable after settle or dissolve) plus the factory fee.</span></p>
            : derived ? <p>Storage bond part only: <b>{fmtNear(bondRequired(derived.maxHolders))}</b> for up to {derived.maxHolders} holders. The factory fee is added by the contract, so the full number needs the contract to answer.</p>
              : <p>Fill valid numbers to see the deposit.</p>}
          {derived && <p className="hint">Per-wallet cap {fmtUsdc(derived.walletCap)}. One active trial per account.</p>}
          <WalletActionButton action="create" disabled={!canCreate} loading={tx.state.status === 'pending'} onReady={() => void create()} className="btn-primary">
            {canCreate && deposit ? `Create trial (deposit ${fmtNear(deposit)}, refundable)` : 'Create trial'}
          </WalletActionButton>
          <p className="hint">
            {!parsed.ok ? 'Fix the highlighted fields first.' : violations.length || contractRefused ? `Fix the rule code${violations.length === 1 ? '' : 's'} above. Nothing is signed.`
              : active ? 'This account already has an open trial.' : !deposit ? 'The deposit comes from the contract; it is not available right now.' : !payout.resolution.ok ? payout.resolution.error : profile !== 'ladder' ? 'Preview only on the demo profile.' : 'No wallet is needed until you press Create.'}
          </p>
          <TxStatus state={tx.state} />
          {tx.state.status === 'done' && (
            <div className="callout ok"><p><b>Submitted.</b> The new trial appears in <Link href="/">Discover</Link> a few blocks after the transaction lands, and on your <Link href="/creator">Creator desk</Link>. Share its page from there.</p></div>
          )}
        </section>
      </div>
    </div>
  );
}
