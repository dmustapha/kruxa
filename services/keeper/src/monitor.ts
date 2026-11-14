import type { Ctx } from "./launch.js";
import { exec } from "./launch.js";
import type { CoreLedger, CoreState, Invariants, SolvencyReport } from "./types.js";

/** Names of the checks that failed in a get_invariants answer (l1_ok false becomes "l1"). */
export function failedChecks(inv: Invariants): string[] {
  return Object.keys(inv).filter((k) => k.endsWith("_ok") && k !== "all_ok" && inv[k] === false).map((k) => k.slice(0, -3));
}

/** get_invariants for one launch. Alerts on any false check or on intents_alert; re-arms when the launch is healthy again. */
export async function checkInvariants(c: Ctx, id: string): Promise<void> {
  const inv = await c.chain.view<Invariants | null>("get_invariants", { launch_id: id });
  if (!inv) return;
  const bad = inv.all_ok === false ? failedChecks(inv) : [];
  const detail = Object.fromEntries(bad.map((n) => [`${n}_err`, inv[`${n}_err`]]));
  if (inv.all_ok === false) await c.alerts.raise(`inv:${id}`, "invariant_false", { launch: id, failed: bad, ...detail });
  else c.alerts.clear(`inv:${id}`);
  if (inv.intents_alert === true) await c.alerts.raise(`intents:${id}`, "intents_alert", { launch: id });
  else c.alerts.clear(`intents:${id}`);
}

/** In-memory tracker: the same inflight amount seen for longer than the threshold means a leg is stuck. A restart restarts the clock. */
export class StuckTracker {
  private readonly seen = new Map<string, { value: string; since: number }>();
  constructor(private readonly now: () => number, private readonly afterMs: number) {}

  /** Returns how long (ms) the leg has been stuck at this exact value, or null when it is zero, moving, or too young. */
  observe(key: string, value: bigint): number | null {
    if (value === 0n) { this.seen.delete(key); return null; }
    const v = value.toString();
    const prev = this.seen.get(key);
    if (!prev || prev.value !== v) { this.seen.set(key, { value: v, since: this.now() }); return null; }
    const age = this.now() - prev.since;
    return age >= this.afterMs ? age : null;
  }
}

/** A leg is a payout in flight (inflight ledger columns) or a verdict whose positions are not settled. */
export async function checkStuckLegs(c: Ctx, tracker: StuckTracker, id: string): Promise<void> {
  const [l, st] = await Promise.all([c.chain.view<CoreLedger>("get_ledger", { launch_id: id }), c.chain.view<CoreState>("get_state", { launch_id: id })]);
  const legs: Array<[string, bigint]> = [
    ["inflight_native", BigInt(l.inflight_native)],
    ["inflight_intents", BigInt(l.inflight_intents)],
    ["positions_unsettled", BigInt(st.positions_unsettled)],
  ];
  for (const [name, value] of legs) {
    const key = `stuck:${id}:${name}`;
    const age = tracker.observe(key, value);
    if (age !== null) await c.alerts.raise(key, "leg_stuck", { launch: id, leg: name, value: value.toString(), stuck_ms: age });
    else if (value === 0n) c.alerts.clear(key);
  }
}

/** check_solvency (any caller, 30 s cooldown) then solvency_report. R_TOO_EARLY just means somebody checked a moment ago. */
export async function checkSolvency(c: Ctx, callIt: boolean): Promise<void> {
  if (callIt) await exec(c, "-", "check_solvency", {});
  const r = await c.chain.view<SolvencyReport>("solvency_report", {});
  if (!r.counters_ok) await c.alerts.raise("solvency:counters", "solvency_counters_mismatch", { report: r });
  else c.alerts.clear("solvency:counters");
  if (r.last_check && !r.last_check.ok) await c.alerts.raise("solvency:last", "solvency_false", { last_check: r.last_check });
  else c.alerts.clear("solvency:last");
  if (r.intents_alert) await c.alerts.raise("solvency:intents", "intents_alert", { source: "solvency_report" });
  else c.alerts.clear("solvency:intents");
}
