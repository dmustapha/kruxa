'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fmtUsdc } from '@/lib/config';
import { getCharter, getState, type Charter, type LaunchState } from '@/lib/near';
import { claimRefund, claimTokens, commit, connect, settle, walk } from '@/lib/wallet';

const phaseHelp: Record<string, string> = {
  Scheduled: 'Not open yet.',
  Open: 'Commit and Walk are open.',
  Closing: 'Commits closed. Walk stays open until the end of the tail: the book can only shrink.',
  Ready: 'The book is frozen. Anyone can call settle.',
};

const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
};

export default function Trial() {
  const { id } = useParams<{ id: string }>();
  const [st, setSt] = useState<LaunchState | null>(null);
  const [ch, setCh] = useState<Charter | null>(null);
  const [amount, setAmount] = useState(30);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => { setSt(await getState(id)); setCh(await getCharter(id)); }, [id]);
  useEffect(() => { void refresh(); const a = setInterval(() => void refresh(), 5000); const b = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(a); clearInterval(b); }; }, [refresh]);

  if (!st || !ch) return <p>Loading launch {id}…</p>;
  const soft = BigInt(String(ch.params['soft_cap']));
  const total = BigInt(st.total_active);
  const marginUsd = total - soft;
  const minFunders = Number(ch.params['min_funders']);
  const target = st.phase === 'Open' ? ch.commit_end : st.phase === 'Closing' ? ch.walk_end : null;
  const msLeft = target ? Number(BigInt(target) / 1_000_000n) - now : 0;

  return (
    <>
      <h1>{String(ch.params['name'])} <small>({String(ch.params['symbol'])})</small></h1>
      <p>{st.status} · {st.phase}. {phaseHelp[st.phase]} {target ? `Next change in ${fmtDuration(msLeft)}.` : ''}</p>
      <div className="card">
        <table><tbody>
          <tr><td>Committed</td><td>{fmtUsdc(total)} of soft cap {fmtUsdc(soft)}</td></tr>
          <tr><td>PASS margin</td><td className={marginUsd >= 0n ? 'ok' : 'bad'}>{marginUsd >= 0n ? '+' : '-'}{fmtUsdc(marginUsd < 0n ? -marginUsd : marginUsd)} · {st.active_funders - minFunders >= 0 ? '+' : ''}{st.active_funders - minFunders} funders</td></tr>
          <tr><td>Book hash</td><td><code>{st.book_hash.slice(0, 16)}…</code></td></tr>
          <tr><td>Token</td><td>{st.token ?? 'created at open'}</td></tr>
        </tbody></table>
      </div>
      <div className="row"><button onClick={() => void connect()}>Connect wallet</button></div>
      <h2>Your actions</h2>
      <div className="row">
        <input type="number" min={20} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 100 }} />
        <button disabled={st.phase !== 'Open'} onClick={() => void commit(id, String(amount * 1_000_000))}>Commit USDC</button>
        <button disabled={st.phase !== 'Open' && st.phase !== 'Closing'} onClick={() => void walk(id)}>Walk (principal returned, no platform fee)</button>
        <button disabled={st.phase !== 'Ready' || st.status !== 'Open'} onClick={() => void settle(id)}>Settle</button>
        <button onClick={() => void claimRefund(id)}>Claim refund</button>
        <button disabled={st.status !== 'Passed'} onClick={() => void claimTokens(id)}>Claim tokens</button>
      </div>
      <p>Walk returns your principal to the NEAR or Intents account it came from; the platform takes no fee. Moving it from Intents on to a Solana wallet costs an Intents withdrawal fee (live quote shown before you sign). A relay fee, if you paid one, is not refunded. Check this launch on the <a href={`/demo?launch=${id}`}>verification page</a>.</p>
    </>
  );
}
