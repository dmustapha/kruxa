import { Badge, VerdictBadge } from '@/components/ui/Badges';
import { MarginMeter } from '@/components/ui/Meter';
import { fmtUsdc } from '@/lib/config';
import { fmtSigned, fmtSignedUsdc, shortHash } from '@/lib/format';
import type { LaunchDetail } from '@/lib/api/types';
import { CopyButton } from '@/components/ui/CopyButton';

const REASON: Record<string, string> = { BELOW_SOFT_CAP: 'Total committed was below the soft cap', BELOW_MIN_FUNDERS: 'Fewer backers than the minimum', CANCELLED: 'Cancelled' };

/** The two live inputs of the verdict, the margin to the PASS line, and (once settled) the hashes. Every figure is the indexer's; /verify recomputes. */
export function VerdictPanel({ d }: { d: LaunchDetail }) {
  const v = d.verdict_inputs;
  const usdcMargin = v.margin_to_soft_cap ?? null;
  const fMargin = v.margin_funders ?? null;
  return (
    <section className="card" aria-labelledby="verdict-h">
      <div className="row between"><h2 id="verdict-h">Verdict inputs</h2><VerdictBadge verdict={d.verdict} status={d.status} /></div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div><div className="big">{fmtUsdc(v.total_active)}</div><div className="big-label">committed (active)</div></div>
        <div><div className="big">{v.funders}</div><div className="big-label">active backers</div></div>
      </div>
      <MarginMeter totalActive={v.total_active} softCap={v.soft_cap} progressBps={d.progress_bps} />
      <dl className="kv">
        <div><dt>Soft cap</dt><dd>{v.soft_cap ? fmtUsdc(v.soft_cap) : 'not indexed'}</dd></div>
        <div><dt>Margin to soft cap</dt><dd className={usdcMargin !== null ? (BigInt(usdcMargin) >= 0n ? 'ok' : 'bad') : ''}>{usdcMargin !== null ? `${fmtSignedUsdc(usdcMargin)} ${BigInt(usdcMargin) >= 0n ? '(clears)' : '(short)'}` : 'n/a'}</dd></div>
        <div><dt>Minimum backers</dt><dd>{v.min_funders ?? 'not indexed'}</dd></div>
        <div><dt>Margin in backers</dt><dd className={fMargin !== null ? (fMargin >= 0 ? 'ok' : 'bad') : ''}>{fMargin !== null ? `${fmtSigned(fMargin)} ${fMargin >= 0 ? '(clears)' : '(short)'}` : 'n/a'}</dd></div>
        <div><dt>Book hash (latest folded)</dt><dd title={v.book_hash_folded}>{shortHash(v.book_hash_folded)} <CopyButton text={v.book_hash_folded} /></dd></div>
        <div><dt>Verdict inputs hash</dt><dd title={v.inputs_hash ?? ''}>{v.inputs_hash ? <>{shortHash(v.inputs_hash)} <CopyButton text={v.inputs_hash} /></> : 'not settled yet'}</dd></div>
        <div><dt>Charter hash</dt><dd title={d.charter_hash}>{shortHash(d.charter_hash)}</dd></div>
      </dl>
      {d.verdict === 'FAIL' && (
        <div className="callout bad"><p><b>FAIL.</b> {(d.verdict_reasons?.length ? d.verdict_reasons : ['reason not logged']).map((r) => REASON[r] ?? r).join('; ')}. Every backer can claim a refund.</p></div>
      )}
      {d.verdict === 'PASS' && d.allocation && (
        <>
          <h3>Allocation at PASS</h3>
          <dl className="kv">
            <div><dt>Accepted</dt><dd>{fmtUsdc(d.allocation.accepted ?? '0')}</dd></div>
            <div><dt>Launch fee</dt><dd>{fmtUsdc(d.allocation.launch_fee ?? '0')}</dd></div>
            <div><dt>LP seed</dt><dd>{fmtUsdc(d.allocation.lp_quote ?? '0')}</dd></div>
            <div><dt>Creator stream (capped draw)</dt><dd>{fmtUsdc(d.allocation.stream ?? '0')}</dd></div>
            <div><dt>Refund pool (oversubscription)</dt><dd>{fmtUsdc(d.allocation.excess_pool ?? '0')}</dd></div>
          </dl>
        </>
      )}
      <p className="hint"><Badge tone="muted">indexer view</Badge> These are the indexer&apos;s folded numbers. The verify page recomputes them from the contract.</p>
    </section>
  );
}
