import { fmtUnits } from '@/lib/market/format';
import type { Section } from '@/lib/market/hooks';
import type { GenesisStep } from '@/lib/market/genesis';
import type { LaunchDetail, TokenPageData } from '@/lib/market/types';
import { GenesisStepper } from './GenesisStepper';
import { Async } from './shared';

const when = (sec?: number | null): string => (sec ? new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown');

function Meters({ d }: { d: LaunchDetail }) {
  const v = d.verdict_inputs;
  const softCap = v.soft_cap ? BigInt(v.soft_cap) : null;
  const cap = softCap ? Number((BigInt(v.total_active) * 100n) / (softCap === 0n ? 1n : softCap)) : null;
  const backers = v.min_funders ? Math.round((v.funders / v.min_funders) * 100) : null;
  return (
    <div className="mkt-meters">
      <Meter label="Committed vs soft cap" value={`$${fmtUnits(v.total_active, 6, 0)} of ${softCap ? `$${fmtUnits(v.soft_cap!, 6, 0)}` : 'unknown'}`} pct={cap} />
      <Meter label="Backers vs minimum" value={`${v.funders} of ${v.min_funders ?? 'unknown'}`} pct={backers} />
      <p className="mkt-note">{margin(v)}</p>
    </div>
  );
}
function margin(v: LaunchDetail['verdict_inputs']): string {
  if (!v.soft_cap || v.min_funders === undefined || v.min_funders === null) return 'Terms not indexed, so no margin can be stated.';
  const dollars = BigInt(v.total_active) - BigInt(v.soft_cap);
  const people = v.funders - v.min_funders;
  if (dollars >= 0n && people >= 0) return `Passing by $${fmtUnits(dollars, 6, 0)} and ${people} backer${people === 1 ? '' : 's'}.`;
  const need = [dollars < 0n ? `$${fmtUnits(-dollars, 6, 0)}` : null, people < 0 ? `${-people} more backer${people === -1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
  return `Needs ${need}.`;
}
function Meter({ label, value, pct }: { label: string; value: string; pct: number | null }) {
  return (
    <div>
      <div className="mkt-split-top"><span>{label}</span><span className="mkt-mono">{value}</span></div>
      {pct === null ? <p className="mkt-note">terms not indexed</p> : <span className="mkt-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)}><span style={{ width: `${Math.min(100, pct)}%` }} /></span>}
    </div>
  );
}

/** Trial still open: no chart, no order panel. The progress that matters is the trial's. */
export function TrialState({ page, detail }: { page: TokenPageData; detail: Section<LaunchDetail> }) {
  const id = page.launch.launch_id;
  return (
    <section className="mkt-panel mkt-state" aria-labelledby="mkt-state-h">
      <h2 id="mkt-state-h">In its trial</h2>
      <p className="mkt-state-lead">This token is in its trial. It cannot be traded yet.</p>
      <Async section={detail} lines={3}>{(d) => <><Meters d={d} /><p className="mkt-note">Commits close {when(d.commit_end)}. Walk until {when(d.walk_end)}.</p></>}</Async>
      <p><a className="mkt-btn-link" href={`/launch/${encodeURIComponent(id)}`}>Go to the trial</a></p>
    </section>
  );
}

export function FailedState({ page }: { page: TokenPageData }) {
  const id = page.launch.launch_id;
  return (
    <section className="mkt-panel mkt-state" aria-labelledby="mkt-failed-h" data-tone="bad">
      <h2 id="mkt-failed-h">This trial failed</h2>
      <p className="mkt-state-lead">There is no market for this launch, and none will open. Backers can claim refunds on the trial page.</p>
      <p className="mkt-note">No Solana mint was created for a failed trial. The NEAR-side token exists from the start of every trial, but it has no pool.</p>
      <p><a className="mkt-btn-link" href={`/launch/${encodeURIComponent(id)}`}>Go to the trial and refunds</a></p>
    </section>
  );
}

export function GenesisState({ steps, detail }: { steps: GenesisStep[]; detail: Section<LaunchDetail> }) {
  return (
    <section className="mkt-panel mkt-state" aria-labelledby="mkt-gen-h">
      <h2 id="mkt-gen-h">Passed. Trading opens when the pool is seeded.</h2>
      <GenesisStepper steps={steps} />
      <Async section={detail} lines={2}>{(d) => <><h3 className="mkt-h3">Trial origin</h3><Meters d={d} /></>}</Async>
    </section>
  );
}

export function HaltedBanner() {
  return (
    <div className="mkt-alert" data-tone="warn" role="status">
      <strong>Buys are paused on this market</strong>
      Sells, creator claims and withdrawals stay open: the contract never pauses them. Operator actions are listed in the <a href="/ops-log">operations log</a>.
    </div>
  );
}
