'use client';
import { useEffect, useState } from 'react';
import { WalletActionButton, useWallet, type ReadyDecision } from '@/components/wallet';
import { ChainActionButton } from './ChainActionButton';
import { ProofBadge } from '@/components/ui/Badges';
import { CommandBlock } from '@/components/ui/CopyButton';
import { TxStatus } from '@/components/ui/TxStatus';
import { claimRefundNear, claimTokensNear, commitNear, nearCliCommand, registerOnToken, settleNear, walkNear } from '@/lib/actions';
import { CONFIG, fmtUsdc } from '@/lib/config';
import { microFromDollars } from '@/lib/format';
import { maxRelayFee, OV3_NOTE, relaySubmit, signCommitIntent, signWalkIntent } from '@/lib/intents-commit';
import { previewContribution, getPosition, type Charter, type ContributionPreview, type LaunchState, type PositionView } from '@/lib/near';
import { useTx } from '@/lib/useTx';
import { useHolderKeys } from '@/lib/useHolders';
import type { LaunchDetail } from '@/lib/api/types';

export type Phase = 'Scheduled' | 'Open' | 'Closing' | 'Ready' | 'Settled' | 'Unknown';

/** Phase from the chain when it answered, otherwise a conservative read of the indexer's stage. The contract has the final say either way. */
export function phaseFor(d: LaunchDetail, chain: LaunchState | null): Phase {
  if (chain) return chain.status === 'Open' ? chain.phase : 'Settled';
  if (d.stage === 'passed' || d.stage === 'failed') return 'Settled';
  if (d.stage === 'closing') return 'Closing';
  return d.stage === 'new' || d.stage === 'open' ? 'Open' : 'Unknown';
}

interface Ctx { d: LaunchDetail; chain: LaunchState | null; charter: Charter | null; phase: Phase; onChanged: () => void }

function usePosition(id: string): { position: PositionView | null; holder: string | null; reload: () => void } {
  const { near, solana } = useHolderKeys();
  const holder = near ?? solana;
  const [position, setPosition] = useState<PositionView | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!holder) { setPosition(null); return; }
    let live = true;
    getPosition(id, holder).then((p) => { if (live) setPosition(p); }, () => { if (live) setPosition(null); });
    return () => { live = false; };
  }, [id, holder, n]);
  return { position, holder, reload: () => setN((x) => x + 1) };
}

function CommitPanel({ d, charter, phase, onChanged }: Ctx) {
  const { adapters, sessions } = useWallet();
  const holders = useHolderKeys();
  const [tab, setTab] = useState<'near' | 'solana'>('near');
  const [amount, setAmount] = useState('30');
  const [fee, setFee] = useState('0');
  const tx = useTx();
  const [bundle, setBundle] = useState<string | null>(null);
  const [relayNote, setRelayNote] = useState<string | null>(null);
  const [pre, setPre] = useState<ContributionPreview | 'unavailable' | null>(null);

  useEffect(() => { if (!sessions.near && sessions.solana) setTab('solana'); }, [sessions.near, sessions.solana]);
  const micro = microFromDollars(amount);
  const feeMicro = tab === 'solana' ? microFromDollars(fee) ?? 0n : 0n;
  const holder = tab === 'near' ? holders.near : holders.solana;
  const minBuy = charter ? BigInt(String(charter.params['min_buy'])) : null;
  const walletCap = charter?.derived['wallet_cap'] !== undefined ? BigInt(String(charter.derived['wallet_cap'])) : null;
  const feeMax = micro ? maxRelayFee(micro) : 0n;
  const net = micro !== null ? micro - feeMicro : null;

  useEffect(() => {
    if (!holder || micro === null || micro === 0n) { setPre(null); return; }
    let live = true;
    const t = setTimeout(() => {
      previewContribution(d.launch_id, holder, micro.toString(), tab === 'solana' ? feeMicro.toString() : null).then(
        (r) => { if (live) setPre(r); }, () => { if (live) setPre('unavailable'); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [holder, micro, feeMicro, tab, d.launch_id]);

  const invalid = micro === null || micro === 0n;
  const open = phase === 'Open';
  const sid = tab === 'solana' ? sessions.solana?.intentsAccountId : undefined;

  async function submit(session: { address: string }) {
    if (micro === null) return;
    await tx.run(async () => {
      if (tab === 'near') {
        const r = await adapters.near.signAndSendTransaction(commitNear(d.launch_id, micro));
        onChanged();
        return r;
      }
      const { bundle: b } = await signCommitIntent({ adapter: adapters.solana, address: session.address, launchId: d.launch_id, amountMicro: micro, relayFeeMicro: feeMicro });
      setBundle(JSON.stringify(b));
      const relayed = await relaySubmit('commit', b);
      setRelayNote(relayed ? (relayed.ok ? `Relayer accepted: ${relayed.message}` : `Relayer refused: ${relayed.message}`) : 'No relayer is configured in this build. Submit the signed bundle yourself (below).');
      return { note: 'signed; not yet on chain' };
    });
  }

  return (
    <section className="card" aria-labelledby="commit-h" id="act-commit">
      <div className="row between"><h3 id="commit-h" style={{ margin: 0 }}>Commit USDC</h3>{tab === 'solana' && <ProofBadge status="UNPROVEN PATH" />}</div>
      <div className="seg" role="tablist" aria-label="Where your funds are" style={{ margin: '12px 0' }}>
        {(['near', 'solana'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'near' ? 'From NEAR' : 'From Solana'}</button>
        ))}
      </div>
      <label htmlFor="amt">Amount (USDC)</label>
      <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={invalid || undefined} aria-describedby="amt-hint" disabled={!open} />
      <p id="amt-hint" className="hint">
        {minBuy !== null ? `Minimum ${fmtUsdc(minBuy)} net` : 'Minimum read from the Charter once the chain answers'}{walletCap !== null ? ` · wallet cap ${fmtUsdc(walletCap)}` : ''}. Stated in USDC.
      </p>
      {tab === 'solana' && (
        <>
          <div className="callout"><p><b>Your funds sit in an Intents account that only your Phantom key controls.</b> Kruxa never holds a key for it.{sid ? <> Yours is <code>{sid.slice(0, 8)}...{sid.slice(-6)}</code>.</> : ' Connect Phantom to see its id.'}</p>
            <p>Step 1: get USDC into that account with a 1Click quote (not wired in this build; the app does not invent a quote). Step 2: sign one transfer message below.</p></div>
          <label htmlFor="fee">Relay fee (USDC, taken from the amount)</label>
          <input id="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} disabled={!open} aria-describedby="fee-hint" />
          <p id="fee-hint" className="hint">Ceiling for this amount: {fmtUsdc(feeMax)}. With no relayer, use 0 and submit the signed message yourself, fee-free. {net !== null && micro !== null ? `Net after the fee: ${fmtUsdc(net)}.` : ''}</p>
        </>
      )}
      <div aria-live="polite" className="hint">
        {pre === null && (holder ? 'Enter an amount to pre-check it against the contract.' : `Connect a ${tab === 'near' ? 'NEAR' : 'Solana'} wallet to pre-check this amount against your account.`)}
        {pre === 'unavailable' && 'Contract pre-check unavailable (RPC). The contract still decides when you sign.'}
        {pre && pre !== 'unavailable' && (pre.ok ? <span className="ok">Pre-check OK: net {fmtUsdc(pre.net ?? '0')} would be credited.</span> : <span className="bad">Pre-check refused: <code>{pre.code}</code> {pre.detail}</span>)}
      </div>
      <ChainActionButton chain={tab} action="commit" disabled={!open || invalid} loading={tx.state.status === 'pending'} onReady={(s) => void submit(s)} className="btn-primary">
        Commit{micro ? ` ${fmtUsdc(micro)}` : ''}{tab === 'solana' ? ' by signing a message' : ''}
      </ChainActionButton>
      {!open && <p className="hint">Commits are open only while the trial is in its commit window. This one is: {phase}.</p>}
      <TxStatus state={tx.state} />
      {tab === 'solana' && <p className="hint">{OV3_NOTE}</p>}
      {bundle && (
        <>
          {relayNote && <p role="status" className="hint">{relayNote}</p>}
          <CommandBlock label="Signed Intents bundle" command={bundle} />
          <CommandBlock label="Self-submit (any NEAR account can call this)" command={nearCliCommand(CONFIG.core, 'contribute_via_intents', { signed: JSON.parse(bundle) as unknown })} />
        </>
      )}
    </section>
  );
}

function WalkPanel({ d, phase, onChanged }: Ctx) {
  const { adapters } = useWallet();
  const tx = useTx();
  const [signedArgs, setSignedArgs] = useState<string | null>(null);
  const { solana, near } = useHolderKeys();
  const solanaOnly = !near && !!solana;
  const can = phase === 'Open' || phase === 'Closing';

  async function walk(dec: ReadyDecision) {
    await tx.run(async () => {
      if (dec.path === 'near-native') { const r = await adapters.near.signAndSendTransaction(walkNear(d.launch_id)); onChanged(); return r; }
      const { args } = await signWalkIntent({ adapter: adapters.solana, address: dec.session.address, launchId: d.launch_id });
      setSignedArgs(JSON.stringify(args));
      return { note: 'signed; anyone can submit it' };
    });
  }

  return (
    <section className="card" aria-labelledby="walk-h" id="act-walk">
      <div className="row between"><h3 id="walk-h" style={{ margin: 0 }}>Walk</h3>{solanaOnly && <ProofBadge status="UNPROVEN PATH" />}</div>
      <p>Your principal is returned to the account it came from. The platform takes no fee on a Walk. A relay fee you paid is not returned. Moving a refund from your Intents account to a Solana wallet costs a fixed 0.03 USDC bridge fee, deducted from the refund and never paid by Kruxa.</p>
      <WalletActionButton action="walk" disabled={!can} loading={tx.state.status === 'pending'} onReady={(dec) => void walk(dec)}>Walk away with my principal</WalletActionButton>
      {!can && <p className="hint">Walk is open from commit start until the end of the tail. This trial is: {phase}.</p>}
      <TxStatus state={tx.state} />
      {signedArgs && <CommandBlock label="Signed walk (any NEAR account submits this)" command={nearCliCommand(CONFIG.core, 'walk_signed', JSON.parse(signedArgs) as Record<string, unknown>)} />}
    </section>
  );
}

function SettleClaimPanel({ d, chain, phase, onChanged }: Ctx) {
  const { adapters } = useWallet();
  const { near } = useHolderKeys();
  const settleTx = useTx(); const refundTx = useTx(); const claimTx = useTx(); const regTx = useTx();
  const { position, reload } = usePosition(d.launch_id);
  const refundable = d.stage === 'failed' || (position !== null && BigInt(position.due_native) + BigInt(position.due_intents) > 0n);
  const passed = d.verdict === 'PASS' || chain?.status === 'Passed';
  const token = chain?.token ?? null;

  const act = async (t: ReturnType<typeof useTx>, build: () => Parameters<typeof adapters.near.signAndSendTransaction>[0]) =>
    t.run(async () => { const r = await adapters.near.signAndSendTransaction(build()); onChanged(); reload(); return r; });

  return (
    <section className="card" aria-labelledby="settle-h" id="act-settle">
      <h3 id="settle-h" style={{ margin: 0 }}>Settle, claim and refund</h3>
      {position && (
        <dl className="kv" aria-label="Your position">
          <div><dt>Your contribution</dt><dd>{fmtUsdc(position.contributed)}</dd></div>
          <div><dt>Still in the book</dt><dd>{fmtUsdc((BigInt(position.open_native) + BigInt(position.open_intents)).toString())}</dd></div>
          <div><dt>Refund due</dt><dd>{fmtUsdc((BigInt(position.due_native) + BigInt(position.due_intents)).toString())}</dd></div>
          <div><dt>Tokens entitled / claimed</dt><dd>{position.tokens_entitled} / {position.claimed}</dd></div>
        </dl>
      )}
      <div className="stack">
        <div>
          <WalletActionButton action="claim" disabled={phase !== 'Ready'} loading={settleTx.state.status === 'pending'} onReady={() => void act(settleTx, () => settleNear(d.launch_id))}>Settle (anyone can call)</WalletActionButton>
          <p className="hint">{phase === 'Ready' ? 'The book is frozen. Settling records the verdict.' : 'Settle opens when the Walk tail has ended.'}</p>
          <TxStatus state={settleTx.state} />
        </div>
        <div>
          <WalletActionButton action="claim" disabled={!refundable} loading={refundTx.state.status === 'pending'} onReady={(dec) => { if (dec.path === 'near-native') void act(refundTx, () => claimRefundNear(d.launch_id)); }}>Claim refund</WalletActionButton>
          <p className="hint">{refundable ? 'Refunds are pulled by the holder. The destination is fixed by your position.' : 'Nothing to refund yet. Available after a FAIL, a dissolve, or a Walk.'}</p>
          <TxStatus state={refundTx.state} />
        </div>
        <div>
          {passed && token && near && (
            <>
              <button type="button" className="btn-quiet" disabled={regTx.state.status === 'pending'} onClick={() => void act(regTx, () => registerOnToken(token, near.replace('near:', '')))}>Register on {token} (0.00125 NEAR)</button>
              <p className="hint">Token claims need your account registered on the launch token first.</p>
              <TxStatus state={regTx.state} />
            </>
          )}
          <WalletActionButton action="claim" disabled={!passed} loading={claimTx.state.status === 'pending'} onReady={(dec) => { if (dec.path === 'near-native') void act(claimTx, () => claimTokensNear(d.launch_id)); }}>Claim tokens</WalletActionButton>
          <p className="hint">{passed ? 'Sale tokens come from this launch, plus the vested part of any backer bonus.' : 'Tokens exist for claiming only after PASS.'}</p>
          <TxStatus state={claimTx.state} />
        </div>
      </div>
    </section>
  );
}

export function TrialActions(props: Ctx) {
  return (
    <div className="stack" aria-label="Your actions">
      <h2 style={{ margin: 0 }}>Your actions</h2>
      <p className="hint">A wallet is requested only when you press one of these. Mock wallets are used in tests; this build has not signed on testnet with a real wallet (PD-1).</p>
      <CommitPanel {...props} />
      <WalkPanel {...props} />
      <SettleClaimPanel {...props} />
    </div>
  );
}
