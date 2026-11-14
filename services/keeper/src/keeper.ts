import type { Ctx, Outcome } from "./launch.js";
import { driveLaunch } from "./launch.js";
import type { LaunchLock } from "./lock.js";
import { checkInvariants, checkSolvency, checkStuckLegs, type StuckTracker } from "./monitor.js";
import type { CoreState } from "./types.js";

const MAX_STEPS_PER_CYCLE = 6;

export interface Keeper {
  ctx: Ctx;
  lock: LaunchLock;
  stuck: StuckTracker;
  /** Highest launch id known to exist; discovery probes the next id until get_state answers null. */
  highest: number;
  lastSolvencyCall: number;
}

export interface CycleReport { launches: Record<string, Outcome | "locked">; solvencyCalled: boolean }

async function discover(k: Keeper): Promise<string[]> {
  for (;;) {
    const next = k.highest + 1;
    if (!(await k.ctx.chain.view<CoreState | null>("get_state", { launch_id: String(next) }))) break;
    k.highest = next;
  }
  return Array.from({ length: k.highest }, (_, i) => String(i + 1)).filter((id) => !k.ctx.finished.has(id));
}

/** Chains steps within one cycle (settle, pages, sweep, tail) for as long as each one made progress. */
async function advance(k: Keeper, id: string): Promise<Outcome> {
  let out: Outcome = "waiting";
  for (let step = 0; step < MAX_STEPS_PER_CYCLE; step++) {
    out = await driveLaunch(k.ctx, id);
    if (out !== "progress") break;
  }
  return out;
}

async function serve(k: Keeper, id: string): Promise<Outcome | "locked"> {
  const release = k.lock.tryAcquire(id);
  if (!release) return "locked";
  try {
    await checkInvariants(k.ctx, id);
    await checkStuckLegs(k.ctx, k.stuck, id);
    return await advance(k, id);
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e);
    await k.ctx.alerts.raise(`launch_error:${id}`, "launch_error", { launch: id, error });
    return "error";
  } finally {
    release();
  }
}

/** One pass: solvency, then every unfinished launch in id order. A failing launch never stops the others. */
export async function runCycle(k: Keeper): Promise<CycleReport> {
  const { ctx } = k;
  const due = ctx.now() - k.lastSolvencyCall >= ctx.cfg.solvencyEveryMs;
  try {
    await checkSolvency(ctx, due);
    if (due) k.lastSolvencyCall = ctx.now();
  } catch (e) {
    await ctx.alerts.raise("solvency:error", "solvency_check_error", { error: String(e instanceof Error ? e.message : e) });
  }
  const launches: CycleReport["launches"] = {};
  for (const id of await discover(k)) launches[id] = await serve(k, id);
  ctx.log("info", "cycle", { launches, dry_run: ctx.cfg.dryRun });
  return { launches, solvencyCalled: due };
}

/** Loops until `stop()` is true; --once runs a single cycle. A cycle that throws (RPC down) is logged and retried next tick. */
export async function runLoop(k: Keeper, o: { once: boolean; stop: () => boolean; sleep: (ms: number) => Promise<void> }): Promise<void> {
  do {
    try {
      await runCycle(k);
    } catch (e) {
      k.ctx.log("error", "cycle_failed", { error: String(e instanceof Error ? e.message : e) });
      if (o.once) throw e;
    }
    if (!o.once && !o.stop()) await o.sleep(k.ctx.cfg.intervalMs);
  } while (!o.once && !o.stop());
}

export function newKeeper(ctx: Ctx, lock: LaunchLock, stuck: StuckTracker): Keeper {
  return { ctx, lock, stuck, highest: 0, lastSolvencyCall: Number.NEGATIVE_INFINITY };
}
