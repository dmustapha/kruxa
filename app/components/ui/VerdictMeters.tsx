import { fmtUsdc } from '@/lib/config';
import { marginSentence } from '@/lib/launch';
import type { LaunchSummary } from '@/lib/api/types';

type In = Pick<LaunchSummary, 'total_active' | 'soft_cap' | 'funders' | 'min_funders' | 'verdict'>;

function Meter({ label, value, max, text, clears }: { label: string; value: number; max: number; text: string; clears: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="vm-row">
      <div className="vm-head"><span>{label}</span><span className="num">{text}</span></div>
      <div className="vm-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-valuetext={`${text}${clears ? ', clears the line' : ', below the line'}`}>
        <div className={`vm-fill ${clears ? 'clears' : 'short'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The two inputs of the verdict as two thin meters, then one plain sentence. A missing term says so; it never draws 0%. */
export function VerdictMeters({ l, sentence = true }: { l: In; sentence?: boolean }) {
  const total = BigInt(l.total_active);
  const soft = l.soft_cap ? BigInt(l.soft_cap) : null;
  const known = soft !== null && l.min_funders !== null && l.min_funders !== undefined;
  return (
    <div className="vm">
      {soft !== null
        ? <Meter label="Committed vs soft cap" value={Number(total / 1000n)} max={Number(soft / 1000n)} text={`${fmtUsdc(total)} of ${fmtUsdc(soft)}`} clears={total >= soft} />
        : <p className="hint">Soft cap not indexed.</p>}
      {l.min_funders !== null && l.min_funders !== undefined
        ? <Meter label="Backers vs minimum" value={l.funders} max={l.min_funders} text={`${l.funders} of ${l.min_funders}`} clears={l.funders >= l.min_funders} />
        : <p className="hint">Minimum backers not indexed.</p>}
      {sentence && <p className={`vm-sentence${known ? '' : ' muted'}`}>{marginSentence(l)}</p>}
    </div>
  );
}
