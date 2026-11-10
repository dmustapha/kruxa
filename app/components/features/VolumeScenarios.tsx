import { fmtUsdc } from '@/lib/config';
import { volumeScenarios } from '@/lib/charter/scenarios';

/** What the fee terms mean in dollars at three trading volumes. Plain arithmetic on the terms, not a forecast of any volume. */
export function VolumeScenarios({ fees }: { fees: { total_fee_bps: number; creator_bps: number; platform_bps: number; fee_vest_bps: number } }) {
  const rows = volumeScenarios(fees);
  return (
    <div>
      <div className="tbl-wrap"><table>
        <caption className="sr-only">Fee split at three trading volumes</caption>
        <thead><tr><th scope="col" className="n">If volume is</th><th scope="col" className="n">Fees paid</th><th scope="col" className="n">Creator slice</th><th scope="col" className="n">Platform slice</th><th scope="col" className="n">To liquidity</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.volume.toString()}><td className="n">{fmtUsdc(r.volume)}</td><td className="n">{fmtUsdc(r.fee)}</td><td className="n">{fmtUsdc(r.creator)}</td><td className="n">{fmtUsdc(r.platform)}</td><td className="n">{fmtUsdc(r.liquidity)}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="hint">Arithmetic on these fee terms, not a forecast: nobody knows what volume a token will have, and a token can trade nothing at all. {fees.fee_vest_bps > 0 ? `${fees.fee_vest_bps / 100}% of the creator slice vests over time, so it is not all claimable at once. ` : ''}The platform slice is not income of the creator. Holders and referral slices go to liquidity in this release.</p>
    </div>
  );
}
