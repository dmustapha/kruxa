import type { FundsInMotion } from '@/lib/api/types';
import { fmtUsdc } from '@/lib/config';
import { Badge, ProofBadge } from '@/components/ui/Badges';

/** The seven 1Click swap statuses. This vocabulary comes from the 1Click API as described in ARCHITECTURE; it is [UNVERIFIED] against a live status call in this repo. */
export const ONECLICK_STATUSES: { id: string; meaning: string }[] = [
  { id: 'PENDING_DEPOSIT', meaning: 'Quote accepted, no deposit seen yet.' },
  { id: 'KNOWN_DEPOSIT_TX', meaning: 'A deposit transaction is known but not yet confirmed.' },
  { id: 'PROCESSING', meaning: 'Deposit received, a solver is filling the swap.' },
  { id: 'SUCCESS', meaning: 'Funds arrived in your Intents account.' },
  { id: 'INCOMPLETE_DEPOSIT', meaning: 'Less than the quoted amount arrived.' },
  { id: 'REFUNDED', meaning: 'The swap did not run; funds went back to the refund address.' },
  { id: 'FAILED', meaning: 'The swap failed.' },
];

export interface FundsStripProps {
  items: FundsInMotion[] | undefined;
  loading?: boolean;
  /** The account(s) the items were read for. Empty means no wallet is connected. */
  keys: string[];
  error?: string | null;
}

export function FundsStrip({ items, loading, keys, error }: FundsStripProps) {
  return (
    <section className="card" aria-labelledby="fim-h">
      <div className="row between"><h2 id="fim-h">Funds in motion</h2><ProofBadge status="UNPROVEN PATH" /></div>
      <p className="hint">Money that left one place and has not yet been confirmed in another: a rejected deposit being refunded, or a payout the chain logged as not completed. The Intents legs here are unproven live (PD-2, PD-8).</p>
      <div role="status" aria-live="polite">
        {keys.length === 0 && <p>Connect a wallet to see funds in motion for your account. Browsing does not need one.</p>}
        {keys.length > 0 && loading && <p>Reading funds in motion for {keys.join(', ')}.</p>}
        {keys.length > 0 && error && <p className="bad">Could not read funds in motion: {error}</p>}
        {keys.length > 0 && !loading && !error && items && items.length === 0 && <p>Nothing is in motion for {keys.join(' and ')}.</p>}
      </div>
      {items && items.length > 0 && (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Launch</th><th>What</th><th className="n">Amount</th><th>State</th></tr></thead>
            <tbody>
              {items.map((f, i) => (
                <tr key={`${f.receipt_id}-${i}`}>
                  <td>#{f.launch_id ?? 'n/a'}</td><td>{f.kind ?? 'payout'}</td><td className="n">{f.amount ? fmtUsdc(f.amount) : 'n/a'}</td>
                  <td>{f.ok === false ? <Badge tone="warn">Not completed yet</Badge> : <Badge tone="pass">Completed</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Intents swap statuses and typical waits</summary>
        <p className="hint">Typical Intents legs took about 90 to 97 seconds in Test 1. One swap stalled about 35 minutes before it completed. That is a seen-once latency tail, not a guarantee in either direction.</p>
        <dl className="kv">{ONECLICK_STATUSES.map((s) => <div key={s.id}><dt className="mono">{s.id}</dt><dd style={{ fontFamily: 'var(--sans)' }}>{s.meaning}</dd></div>)}</dl>
      </details>
    </section>
  );
}
