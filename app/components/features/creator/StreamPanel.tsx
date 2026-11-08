'use client';
import { useWallet, WalletActionButton } from '@/components/wallet';
import { Badge } from '@/components/ui/Badges';
import { TxStatus } from '@/components/ui/TxStatus';
import { useApi } from '@/lib/api/useApi';
import type { CreatorLaunch } from '@/lib/api/types';
import { drawStream } from '@/lib/actions';
import { fmtUsdc } from '@/lib/config';
import { fmtDate } from '@/lib/format';
import { streamStatus } from '@/lib/near';
import { drawOutcome, unlockedBps, type StreamNumbers } from '@/lib/stream';
import { useTx } from '@/lib/useTx';

/** Prefer the contract's own `stream_status`; fall back to the indexer's estimate and say which one is on screen. */
function useStream(c: CreatorLaunch) {
  const chain = useApi(() => streamStatus(c.launch.launch_id), `stream-${c.launch.launch_id}`, 15000);
  if (chain.status === 'ok' && chain.data) {
    const s = chain.data;
    const numbers: StreamNumbers = { total: s.total, cap: s.cap, drawn: s.drawn, inflight: s.inflight, drawable: s.drawable };
    return { numbers, from: 'chain' as const, ends: Math.floor(Number(BigInt(s.ends_at) / 1_000_000_000n)) };
  }
  if (c.stream && c.stream.unlocked !== null) {
    const numbers: StreamNumbers = { total: c.stream.total, cap: c.stream.unlocked, drawn: c.stream.drawn, inflight: '0', drawable: c.stream.drawable_estimate ?? '0' };
    return { numbers, from: 'indexer' as const, ends: c.stream.ends_at };
  }
  return null;
}

export function StreamPanel({ c, canAct }: { c: CreatorLaunch; canAct: boolean }) {
  const { adapters } = useWallet();
  const all = useTx(); const some = useTx();
  const s = useStream(c);
  if (!c.stream && c.launch.verdict !== 'PASS') {
    return <p className="hint">No stream yet: it starts only after a PASS. On a FAIL everyone is refunded and the creator earns nothing from this launch.</p>;
  }
  if (!s) return <p className="hint">The stream numbers are not available from the chain or the indexer right now.</p>;
  const n = s.numbers;
  const wholeOutcome = drawOutcome(n, BigInt(n.total));
  const drawableOutcome = drawOutcome(n, null);
  const bps = unlockedBps(n);
  return (
    <div className="stack">
      <div className="row between"><h4 style={{ margin: 0 }}>Stream meter</h4><Badge tone={s.from === 'chain' ? 'chain' : 'source'}>{s.from === 'chain' ? 'Chain read: stream_status' : 'Indexer estimate'}</Badge></div>
      <div className="meter" role="img" aria-label={`${Math.floor(bps / 100)} percent of the stream has unlocked`}><div className="meter-fill clears" style={{ width: `${Math.min(100, bps / 100)}%` }} /></div>
      <dl className="kv">
        <div><dt>Stream total</dt><dd>{fmtUsdc(n.total)}</dd></div>
        <div><dt>Unlocked so far (the cap)</dt><dd>{fmtUsdc(n.cap)}</dd></div>
        <div><dt>Already drawn</dt><dd>{fmtUsdc(n.drawn)}</dd></div>
        <div><dt>Drawable now</dt><dd>{fmtUsdc(n.drawable)}</dd></div>
        <div><dt>Fully unlocked at</dt><dd>{s.ends ? fmtDate(s.ends) : 'n/a'}</dd></div>
      </dl>
      <div className="callout">
        <p><b>Try to take it all.</b> The contract allows a draw of at most elapsed time times a fixed rate. Asking for the whole stream must fail.</p>
        <p className="mono" aria-live="polite"><Badge tone="recorded">Computed from the numbers above, not an on-chain result</Badge><br />
          {wholeOutcome.wouldRevert ? wholeOutcome.message : 'Everything is already drawable, so this would succeed.'}</p>
      </div>
      <div className="row">
        <WalletActionButton action="claim" disabled={!canAct} loading={all.state.status === 'pending'} className="btn-danger"
          onReady={(d) => { if (d.path === 'near-native') void all.run(() => adapters.near.signAndSendTransaction(drawStream(c.launch.launch_id, BigInt(n.total)))); }}>
          Withdraw all
        </WalletActionButton>
        <WalletActionButton action="claim" disabled={!canAct || drawableOutcome.wouldRevert} loading={some.state.status === 'pending'}
          onReady={(d) => { if (d.path === 'near-native') void some.run(() => adapters.near.signAndSendTransaction(drawStream(c.launch.launch_id, null))); }}>
          Draw what is drawable
        </WalletActionButton>
      </div>
      <p className="hint">{canAct ? 'Only the payout recipient can draw. Withdraw all sends a transaction that is expected to revert with STREAM_CAP; the wallet or chain reports it below.' : 'Connect the payout recipient account to send a draw. Reading needs no wallet.'}</p>
      <TxStatus state={all.state} /><TxStatus state={some.state} />
    </div>
  );
}
