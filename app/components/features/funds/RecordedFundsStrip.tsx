import { ProofBadge } from '@/components/ui/Badges';
import { TEST1_LEGS } from './test1Recorded';

/** Read-only strip of funds in motion from the signed Test 1 run. Static data, no wallet, no network. Always labelled RECORDED. */
export function RecordedFundsStrip() {
  return (
    <section className="card" aria-labelledby="rfs-h">
      <div className="row between"><h2 id="rfs-h">Funds in motion: Test 1</h2><ProofBadge status="RECORDED" /></div>
      <p className="hint">
        Recorded on mainnet on 2026-11-08 with throwaway wallets. This is a copy of evidence/test1-ov4.json and evidence/test1-ov15.json, not a live read.
        One separate swap sat in PROCESSING for about 35 minutes before it completed; treat the 90 s legs as typical, not guaranteed.
      </p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Check</th><th>What</th><th>Sent</th><th>Arrived</th><th>Time</th></tr></thead>
          <tbody>
            {TEST1_LEGS.map((l) => (
              <tr key={`${l.id}-${l.what}`}>
                <td>{l.id}</td>
                <td>{l.what}{l.tx && <div className="mono hint">tx {l.tx}</div>}</td>
                <td>{l.sent}</td><td>{l.arrived}</td><td>{l.seconds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
