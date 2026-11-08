import { fmtUsdc } from '@/lib/config';

/** Progress toward the soft cap. The tick is the soft cap itself (100%), so oversubscription is visible past it. */
export function MarginMeter({ totalActive, softCap, progressBps }: { totalActive: string; softCap?: string | null; progressBps?: number | null }) {
  if (!softCap) return <p className="hint">Soft cap not known to the indexer for this launch.</p>;
  const bps = progressBps ?? Number((BigInt(totalActive) * 10_000n) / BigInt(softCap));
  const scale = Math.max(bps, 10_000) * 1.0;
  const fill = Math.min(100, (bps / scale) * 100);
  const tick = (10_000 / scale) * 100;
  const clears = bps >= 10_000;
  return (
    <div>
      <div className="meter" role="img" aria-label={`${fmtUsdc(totalActive)} committed of a ${fmtUsdc(softCap)} soft cap, ${Math.floor(bps / 100)} percent`}>
        <div className={`meter-fill ${clears ? 'clears' : 'short'}`} style={{ width: `${fill}%` }} />
        <div className="meter-tick" style={{ left: `calc(${tick}% - 1px)` }} />
      </div>
      <div className="meter-cap"><span>{fmtUsdc(totalActive)}</span><span>soft cap {fmtUsdc(softCap)}</span></div>
    </div>
  );
}
