import type { Alerter } from "./alerts.js";
import type { KeeperConfig } from "./config.js";
import type { Chain, CoreLedger, CorePosition, CoreState, LogFn } from "./types.js";

/** Gas per method. consolidate needs 250 Tgas: its ft_withdraw leg reserves 100 plus the callback (100 fails with "Exceeded the prepaid gas"). */
export const GAS: Record<string, number> = { consolidate: 250, claim_refund_batch: 300, check_solvency: 150 };
const DEFAULT_GAS = 100;
const PAGE = 25;
const VIEW_PAGE = 50;
const TAIL = ["consolidate", "pay_launch_fee", "pay_relay_fees"] as const;

export interface Ctx {
  chain: Chain;
  cfg: KeeperConfig;
  log: LogFn;
  alerts: Alerter;
  now: () => number;
  /** Launches whose tail was found fully idle in this process (an optimisation only; a restart just repeats one cheap pass). */
  quiet: Set<string>;
  /** Dissolved launches: nothing left to do, ever. */
  finished: Set<string>;
}

export type StepResult = "ok" | "nothing_free" | "dry" | "error";
export type Outcome = "waiting" | "progress" | "done" | "dry" | "error" | "missing";

const id64 = (id: string): { launch_id: string } => ({ launch_id: id });
const big = (v: string): bigint => BigInt(v);
const kind = (status: string): "open" | "passed" | "failed" | "dissolved" | "other" => {
  if (status === "Open") return "open";
  if (status === "Passed") return "passed";
  if (status.startsWith("Failed")) return "failed";
  return status === "Dissolved" ? "dissolved" : "other";
};

/** Sends one method. R_NOTHING_FREE is success (there was nothing to move); any other refusal raises a step_failed alert. */
export async function exec(c: Ctx, id: string, method: string, args: Record<string, unknown>): Promise<StepResult> {
  const r = await c.chain.call(method, args, GAS[method] ?? DEFAULT_GAS);
  if (r.dry) return "dry";
  const key = `step:${id}:${method}`;
  if (r.ok) {
    c.alerts.clear(key);
    c.log("info", "sent", { launch: id, method, tx: r.tx });
    return "ok";
  }
  if (r.code === "R_NOTHING_FREE") {
    c.log("info", "nothing_free", { launch: id, method });
    return "nothing_free";
  }
  await c.alerts.raise(key, "step_failed", { launch: id, method, code: r.code, error: r.error });
  return "error";
}

/** Pure function of chain state: which step is next. Resumable from nothing but the chain. */
export async function driveLaunch(c: Ctx, id: string): Promise<Outcome> {
  const st = await c.chain.view<CoreState | null>("get_state", id64(id));
  if (!st) return "missing";
  switch (kind(st.status)) {
    case "open": return driveOpen(c, id, st);
    case "passed": return drivePassed(c, id, st);
    case "failed": return driveFailed(c, id, st);
    case "dissolved": c.finished.add(id); return "done";
    default: return "waiting";
  }
}

async function driveOpen(c: Ctx, id: string, st: CoreState): Promise<Outcome> {
  if (st.phase !== "Ready") return "waiting";
  const r = await exec(c, id, "settle", id64(id));
  return r === "dry" ? "dry" : r === "error" ? "error" : "progress";
}

async function drivePassed(c: Ctx, id: string, st: CoreState): Promise<Outcome> {
  if (st.positions_unsettled > 0) return settlePages(c, id, st);
  if (!st.residue_swept) {
    const r = await exec(c, id, "sweep_residue", id64(id));
    return r === "dry" ? "dry" : r === "error" ? "error" : "progress";
  }
  return runTail(c, id);
}

async function runTail(c: Ctx, id: string): Promise<Outcome> {
  const ledger = await c.chain.view<CoreLedger>("get_ledger", id64(id));
  const feePaid = big(ledger.launch_fee_paid) >= big(ledger.launch_fee_due);
  if (feePaid && c.quiet.has(id)) return "done";
  const results: StepResult[] = [];
  for (const m of TAIL) results.push(await exec(c, id, m, id64(id)));
  if (results.includes("dry")) return "dry";
  if (results.includes("error")) return "error";
  if (feePaid && results.every((r) => r === "nothing_free")) { c.quiet.add(id); return "done"; }
  return "waiting"; // legs were sent: their callbacks land asynchronously, the next cycle re-checks
}

async function positionsPage(c: Ctx, id: string, from: number): Promise<CorePosition[]> {
  return c.chain.view<CorePosition[]>("list_positions", { ...id64(id), from_seq: from, limit: VIEW_PAGE });
}

/** Scans the position list for the first record that still needs settling, so a restart resumes where the last run stopped. */
async function firstUnsettledSeq(c: Ctx, id: string, holderCount: number): Promise<number> {
  for (let from = 0; from < holderCount; from += VIEW_PAGE) {
    const hit = (await positionsPage(c, id, from)).find((p) => !p.settled);
    if (hit) return hit.seq;
  }
  return 0;
}

async function settlePages(c: Ctx, id: string, st: CoreState): Promise<Outcome> {
  let seq = await firstUnsettledSeq(c, id, st.holder_count);
  let left = st.positions_unsettled;
  for (let n = 0; n < c.cfg.maxPagesPerCycle && left > 0 && seq < Math.max(st.holder_count, 1); n++) {
    const r = await exec(c, id, "settle_positions_page", { ...id64(id), from_seq: seq, limit: PAGE });
    if (r === "dry") return "dry";
    if (r === "error") return "error";
    seq += PAGE;
    left = (await c.chain.view<CoreState>("get_state", id64(id))).positions_unsettled;
  }
  return "progress";
}

async function dueHolders(c: Ctx, id: string, holderCount: number): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; from < holderCount; from += VIEW_PAGE) {
    for (const p of await positionsPage(c, id, from)) if (big(p.due_native) + big(p.due_intents) > 0n) out.push(p.holder);
  }
  return out;
}

const clear = (l: CoreLedger): boolean =>
  [l.due_native, l.due_intents, l.inflight_native, l.inflight_intents, l.open_native, l.open_intents].every((v) => big(v) === 0n);

async function driveFailed(c: Ctx, id: string, st: CoreState): Promise<Outcome> {
  if (st.positions_unsettled > 0) return settlePages(c, id, st);
  const refunds = await refundBatches(c, id, st.holder_count);
  if (refunds !== "waiting") return refunds;
  const [fresh, ledger] = await Promise.all([c.chain.view<CoreState>("get_state", id64(id)), c.chain.view<CoreLedger>("get_ledger", id64(id))]);
  if (!clear(ledger) || fresh.positions_live !== 0 || fresh.positions_unsettled !== 0) return "waiting";
  const r = await exec(c, id, "dissolve", id64(id));
  return r === "dry" ? "dry" : r === "error" ? "error" : "progress";
}

/** claim_refund_batch is permissionless and pays each holder's own destination. It stops early when its gas runs out and reports
 *  how many it handled, so the loop re-reads who is still due instead of trusting the batch. Returns "waiting" when nobody is due. */
async function refundBatches(c: Ctx, id: string, holderCount: number): Promise<Outcome> {
  let sent = false;
  for (let n = 0; n < c.cfg.maxPagesPerCycle; n++) {
    const due = await dueHolders(c, id, holderCount);
    if (due.length === 0) break;
    const r = await exec(c, id, "claim_refund_batch", { ...id64(id), holders: due.slice(0, c.cfg.refundBatch) });
    if (r === "dry") return "dry";
    if (r === "error") return "error";
    sent = true;
  }
  return sent ? "progress" : "waiting";
}
