import { fmtUsdc } from '@/lib/config';
import { fmtDuration } from '@/lib/format';
import type { Charter } from '@/lib/near';

const pct = (bps: unknown): string => `${Number(bps) / 100}%`;

/** The Charter as the contract holds it. Read over RPC, so it is shown only when the chain answered. */
export function TermsPanel({ charter }: { charter: Charter | null }) {
  if (!charter) return null;
  const p = charter.params;
  const d = charter.derived;
  return (
    <section className="card" aria-labelledby="terms-h">
      <h2 id="terms-h">Charter terms</h2>
      <dl className="kv">
        <div><dt>Hard cap</dt><dd>{fmtUsdc(String(p['hard_cap']))}</dd></div>
        <div><dt>Minimum buy</dt><dd>{fmtUsdc(String(p['min_buy']))}</dd></div>
        <div><dt>Per-wallet cap</dt><dd>{d['wallet_cap'] !== undefined ? fmtUsdc(String(d['wallet_cap'])) : 'n/a'}</dd></div>
        <div><dt>Commit window</dt><dd>{fmtDuration(Number(p['commit_secs']))}</dd></div>
        <div><dt>Walk tail</dt><dd>{fmtDuration(Number(p['tail_secs']))}</dd></div>
        <div><dt>Stream length</dt><dd>{String(p['stream_days'])} days</dd></div>
        <div><dt>Token buckets sale / LP / creator / backer</dt><dd>{pct(p['sale_bps'])} / {pct(p['lp_bps'])} / {pct(p['creator_bps'])} / {pct(p['backer_bps'])}</dd></div>
        <div><dt>Creator</dt><dd>{charter.creator}</dd></div>
      </dl>
      <p className="hint">Payout recipient and the stream rule are fixed once the trial opens. The submission build has no method that changes the recipient.</p>
    </section>
  );
}
