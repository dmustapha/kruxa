'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayoutRecipientField, WalletActionButton, usePayoutRecipient, useWallet } from '@/components/wallet';
import { Badge } from '@/components/ui/Badges';
import { TxStatus } from '@/components/ui/TxStatus';
import { createTrialNear } from '@/lib/actions';
import { agreement, askContract, type ContractAnswer } from '@/lib/charter/preview';
import { EXPLAIN } from '@/lib/charter/explain';
import { feePreview, formFromPreset, paramsFromForm, type FormState } from '@/lib/charter/form';
import { PRESETS, presetById } from '@/lib/charter/presets';
import { DEMO_RULES, LADDER_RULES, bondRequired, derive, toContractJson, validateAll } from '@/lib/charter/rules';
import { fmtUsdc } from '@/lib/config';
import { fmtNear } from '@/lib/format';
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
  const set = (k: keyof FormState) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setPresetId('custom'); };

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
  const clean = parsed.ok && violations.length === 0 && !contractRefused;
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
    <div className="grid grid-aside">
      <div className="stack">
        <section className="card" aria-labelledby="preset-h">
          <h2 id="preset-h" style={{ marginTop: 0 }}>Start from a preset</h2>
          <div className="seg" role="group" aria-label="Presets">
            {PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={presetId === p.id} onClick={() => pickPreset(p.id)}>{p.label}</button>)}
            {presetId === 'custom' && <button type="button" aria-pressed="true" disabled>Custom</button>}
          </div>
          <p className="hint">{presetId === 'custom' ? 'Edited by hand. The rules below are checked on every keystroke.' : presetById(presetId).blurb}</p>
        </section>

        <form className="card" onSubmit={(e) => e.preventDefault()} aria-label="Charter" noValidate>
          <h2 style={{ marginTop: 0 }}>Charter</h2>
          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <Field id="symbol" label="Ticker (2 to 12 of A-Z, 0-9)" value={form.symbol} onChange={set('symbol')} error={errors.symbol} />
            <Field id="name" label="Name" value={form.name} onChange={set('name')} error={errors.name} />
            <Field id="hardCap" label="Hard cap (USDC)" value={form.hardCap} onChange={set('hardCap')} error={errors.hardCap} hint="$500 to $1,000 on this profile" />
            <Field id="softCap" label="Soft cap (USDC)" value={form.softCap} onChange={set('softCap')} error={errors.softCap} hint="PASS needs at least this much" />
            <Field id="minBuy" label="Minimum buy (USDC)" value={form.minBuy} onChange={set('minBuy')} error={errors.minBuy} />
            <Field id="minFunders" label="Minimum backers" value={form.minFunders} onChange={set('minFunders')} error={errors.minFunders} hint="PASS needs at least this many" />
            <Field id="commitHours" label="Commit window (hours)" value={form.commitHours} onChange={set('commitHours')} error={errors.commitHours} hint="24 h to 30 days" />
            <Field id="tailHours" label="Walk tail (hours)" value={form.tailHours} onChange={set('tailHours')} error={errors.tailHours} hint="1 h to 48 h" />
            <Field id="streamDays" label="Stream length (days)" value={form.streamDays} onChange={set('streamDays')} error={errors.streamDays} hint="at least 30 days up to $25,000" />
          </div>
          <details>
            <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Token buckets and wallet cap</summary>
            <div className="grid grid-2" style={{ gap: '0 16px' }}>
              <Field id="saleBps" label="Sale bucket (bps)" value={form.saleBps} onChange={set('saleBps')} error={errors.saleBps} hint="5000 to 8000" />
              <Field id="lpBps" label="LP bucket (bps)" value={form.lpBps} onChange={set('lpBps')} error={errors.lpBps} hint="1500 to 4000" />
              <Field id="creatorBps" label="Creator bucket (bps)" value={form.creatorBps} onChange={set('creatorBps')} error={errors.creatorBps} hint="0 to 2000" />
              <Field id="backerBps" label="Backer bonus bucket (bps)" value={form.backerBps} onChange={set('backerBps')} error={errors.backerBps} hint="0 to 1000; creator plus backer at most 2500" />
              <Field id="walletBps" label="Per-wallet cap (bps of hard cap)" value={form.walletBps} onChange={set('walletBps')} error={errors.walletBps} hint="50 to 500" />
              <Field id="supply" label="Supply (whole tokens)" value={form.supply} onChange={set('supply')} error={errors.supply} hint="10 million to 1 trillion" />
            </div>
          </details>
          <label htmlFor="profile">Rule profile</label>
          <select id="profile" value={profile} onChange={(e) => setProfile(e.target.value as 'ladder' | 'demo')} style={{ maxWidth: 360 }}>
            <option value="ladder">Capped ladder (testnet default)</option>
            <option value="demo">Demo clock (separate labelled account, preview only)</option>
          </select>
          {profile === 'demo' && <p className="hint">Demo clock allows a 90 second commit window and a 30 second tail. It runs on a separate demo account and is preview only here.</p>}
        </form>

        <PayoutRecipientField state={payout.state} onChange={payout.setState} resolution={payout.resolution} signer={signer} />
      </div>

      <aside className="stack" aria-label="Rule check and create">
        <section className="card" aria-labelledby="rules-h">
          <div className="row between"><h2 id="rules-h" style={{ margin: 0 }}>Rule codes</h2>
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
          </div>
          <p className="hint"><Badge tone="muted">local mirror</Badge> Shown instantly with no network. The contract&apos;s own answer is below.</p>
        </section>

        <section className="card" aria-labelledby="contract-h">
          <h2 id="contract-h" style={{ marginTop: 0 }}>Contract check</h2>
          <div aria-live="polite">
            {profile === 'demo' && <p>Not asked: the demo profile lives on a separate account.</p>}
            {profile === 'ladder' && ask.status === 'idle' && <p>Waiting for valid fields.</p>}
            {ask.status === 'asking' && <p>Asking the contract.</p>}
            {answer?.kind === 'ok' && <p className="ok">The contract accepts this Charter (via <code>{answer.via}</code>).</p>}
            {answer?.kind === 'refused' && <p className="bad">The contract refused with {answer.codes.map((c) => <code key={c}>{c}</code>)}{' '}(via <code>{answer.via}</code>).</p>}
            {answer?.kind === 'unreachable' && <p className="warn">The contract could not be asked ({answer.message}). Only the local mirror is shown; nothing is claimed about what the contract would say.</p>}
            {answer && agreement(violations, answer) === 'disagree' && <p className="callout bad">The local mirror and the contract disagree. Trust the contract and report this.</p>}
          </div>
        </section>

        <section className="card" aria-labelledby="dep-h">
          <h2 id="dep-h" style={{ marginTop: 0 }}>Required creator deposit</h2>
          {deposit ? <p><span className="big">{fmtNear(deposit)}</span><br /><span className="muted">from <code>required_deposit</code>: storage bond (refundable after dissolve or settle) plus the factory fee.</span></p>
            : derived ? <p>Storage bond part only: <b>{fmtNear(bondRequired(derived.maxHolders))}</b> for up to {derived.maxHolders} holders. The factory fee is added by the contract, so the full number needs the contract to answer.</p>
              : <p>Fill valid numbers to see the deposit.</p>}
          {derived && <p className="hint">Per-wallet cap {fmtUsdc(derived.walletCap)}.</p>}
        </section>

        {parsed.ok && (
          <section className="card" aria-labelledby="fee-h">
            <h2 id="fee-h" style={{ marginTop: 0 }}>Fee preview</h2>
            <dl className="kv">{feePreview(parsed.params).map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.pct}</dd></div>)}</dl>
            <p className="hint">Shares of trade volume at the committed standard terms, with vesting of {parsed.params.fees.fee_vest_bps / 100}% over {parsed.params.fees.fee_vest_days} days. Fees apply only once a pool exists. This is not a promise of income.</p>
          </section>
        )}

        <div className="card">
          <WalletActionButton action="create" disabled={!canCreate} loading={tx.state.status === 'pending'} onReady={() => void create()} className="btn-primary">Create trial</WalletActionButton>
          <p className="hint">
            {!parsed.ok ? 'Fix the highlighted fields first.' : violations.length || contractRefused ? 'Refused by the rules above. Nothing is signed.'
              : !deposit ? 'The deposit comes from the contract; it is not available right now.' : !payout.resolution.ok ? payout.resolution.error : profile !== 'ladder' ? 'Preview only on the demo profile.' : 'No wallet is needed until you press Create.'}
          </p>
          <TxStatus state={tx.state} />
        </div>
      </aside>
    </div>
  );
}
