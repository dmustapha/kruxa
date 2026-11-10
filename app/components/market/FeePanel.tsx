import type { MarketFacts } from '@/lib/market/facts';
import { sliceRows } from '@/lib/market/facts';
import { fmtBps, fmtDuration, shortAccount } from '@/lib/market/format';
import { openingWindow } from '@/lib/market/math';
import type { TokenPageData } from '@/lib/market/types';
import { Panel } from './shared';
import { VolumeScenarios } from '../features/VolumeScenarios';

export function FeePanel({ page, facts, nowSec }: { page: TokenPageData; facts: MarketFacts; nowSec: number }) {
  const t = facts.terms;
  const payout = page.creator?.payout_recipient ?? page.launch.payout_recipient;
  const win = t && facts.openedAtSec ? openingWindow(t, facts.openedAtSec, nowSec) : null;
  const creatorOfVolume = t ? (t.total_fee_bps * t.creator_bps) / 1_000_000 : null;
  return (
    <Panel title="Fees" id="mkt-fee-h">
      {!t ? (
        <div className="mkt-alert" data-tone="warn" role="status">
          <strong>Fee terms unknown</strong>
          The indexer does not report the logged fee terms for this pool and they could not be read from chain.
          {page.pool.fee_bps ? ` The indexer reports a base fee of ${fmtBps(page.pool.fee_bps)}.` : ''}
        </div>
      ) : (
        <>
          <dl className="mkt-kv">
            <dt>Base fee</dt><dd>{fmtBps(t.total_fee_bps)} of each trade, paid in USDC</dd>
            <dt>Creator slice</dt><dd>{fmtBps(t.creator_bps)} of the fee = {creatorOfVolume!.toFixed(2)}% of volume</dd>
            <dt>Payout recipient</dt><dd title={payout}>{shortAccount(payout, 16, 4)}</dd>
          </dl>
          <ul className="mkt-slices" aria-label="Five fee slices, share of the fee" style={{ marginTop: 14 }}>
            {sliceRows(t).map((s) => (
              <li key={s.id} className="mkt-slice" data-redirected={s.redirected}>
                <span>{s.label}</span>
                <span className="mkt-bar" aria-hidden="true"><span style={{ width: `${s.bps / 100}%` }} /></span>
                <span className="mkt-mono">{fmtBps(s.bps)}{s.redirected && <span className="mkt-sr"> redirected to liquidity</span>}</span>
              </li>
            ))}
          </ul>
          <p className="mkt-note"><span aria-hidden="true" className="mkt-warn">▨</span> Hatched slices (holders and referral) are redirected to the liquidity slice in this release: nothing is paid to holders or referrers yet. The creator slice is the declared one; see the <a href="/charter">Charter</a> for what creator-controlled wallets can do beyond it.</p>
          <p className="mkt-note">{t.fee_vest_bps > 0 ? `${fmtBps(t.fee_vest_bps)} of each 24 h epoch's creator slice vests linearly over ${t.fee_vest_days} days; the rest is claimable at once.` : 'The creator slice is claimable at once.'}</p>
          <h3 style={{ fontSize: 13, margin: '14px 0 4px', color: 'var(--muted)', fontWeight: 500 }}>Volume scenarios</h3>
          <VolumeScenarios fees={t} />
          <h3 style={{ fontSize: 13, margin: '14px 0 4px', color: 'var(--muted)', fontWeight: 500 }}>Opening fee</h3>
          {win ? (
            <p role="timer" aria-live="off" style={{ margin: 0, fontSize: 14 }}>
              <strong className="mkt-warn mkt-mono">{fmtBps(Math.round(win.appliedBps))} now</strong>, falling to the {fmtBps(win.baseBps)} base in <span className="mkt-mono">{fmtDuration(win.secondsLeft)}</span> (ends {new Date(((facts.openedAtSec ?? 0) + t.opening_decay_minutes * 60) * 1000).toISOString().slice(11, 16)} UTC). The extra goes entirely to liquidity.
            </p>
          ) : (
            <p className="mkt-note" style={{ margin: 0 }}>{t.opening_fee_start_bps > t.total_fee_bps ? `The opening fee (started at ${fmtBps(t.opening_fee_start_bps)}) has decayed to the base fee.` : 'This pool has no opening fee surcharge.'}</p>
          )}
        </>
      )}
    </Panel>
  );
}
