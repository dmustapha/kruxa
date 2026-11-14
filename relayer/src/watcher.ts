import type { CoreClient } from "./core.js";

/** The watcher drives a launch through the genesis ceremony state machine, PASS_SEEN to DONE, from chain state alone:
 *  PASS_SEEN    core status Passed, positions still being settled or residue not swept (the keeper's job; the watcher waits)
 *  READY        Passed, settled, swept, genesis status None: run the ceremony (commit_genesis, tx1, tx2, confirm_genesis)
 *  COMMITTED    genesis committed but not confirmed (a crash, or a failed run): F0 resumes, F1 cannot (its key was memory-only)
 *  ABORTED      aborted on chain: only the owner can reopen_genesis; the watcher waits and runs again when status is None again
 *  DONE         genesis confirmed
 *  SKIPPED      not a Solana-genesis launch, not Passed, or not allowed by the operator's filter */
export type Phase = "PASS_SEEN" | "READY" | "COMMITTED" | "ABORTED" | "DONE" | "SKIPPED";

export interface CoreStateView { status: string; positions_unsettled: number; residue_swept: boolean; holder_count: number }
export interface GenesisView {
  status: "None" | "Committed" | "Confirmed" | "Aborted";
  mode: "F0" | "F1";
  g_pub: string | null;
  root_ready: boolean;
  abort_reason?: string;
  plan: { lp_mirror_to_solana: boolean };
}

export interface WatcherPorts {
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /** Runs the EXISTING relayer ceremony (runCeremony) for this launch and writes its record file. Never called in dry-run. */
  runCeremony(launch: bigint, g: GenesisView): Promise<{ mint: string; adopted: boolean; resumed: boolean }>;
  /** Relayer-authorised abort_genesis. Only used for a stranded F1 genesis and only when autoAbortF1 is set. */
  abortGenesis(launch: bigint, reason: string): Promise<void>;
  recordExists(launch: bigint): boolean;
  alert(key: string, kind: string, detail: Record<string, unknown>): Promise<void>;
  log(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void;
}

export interface WatcherOptions {
  dryRun: boolean;
  /** Take every Passed launch, not only those with a Solana plan. */
  all: boolean;
  /** Launch ids the operator names explicitly; always taken. */
  only: Set<string>;
  maxAttempts: number;
  autoAbortF1: boolean;
}

interface Track { attempts: number; sawAborted: boolean; warnedDone: boolean }

export interface Watcher { ports: WatcherPorts; o: WatcherOptions; highest: number; tracks: Map<string, Track>; solana: Map<string, boolean> }

export const newWatcher = (ports: WatcherPorts, o: WatcherOptions): Watcher => ({ ports, o, highest: 0, tracks: new Map(), solana: new Map() });

async function discover(w: Watcher): Promise<string[]> {
  while (await w.ports.view<CoreStateView | null>("get_state", { launch_id: String(w.highest + 1) })) w.highest++;
  return Array.from({ length: w.highest }, (_, i) => String(i + 1));
}

/** A launch has a Solana genesis plan when its charter says so (F0 mode, LP mirror) or it has Solana buyers whose tokens must exist. */
async function hasSolanaPlan(w: Watcher, id: string, g: GenesisView, st: CoreStateView): Promise<boolean> {
  if (w.o.all || w.o.only.has(id) || g.mode === "F0" || g.plan.lp_mirror_to_solana) return true;
  const known = w.solana.get(id);
  if (known !== undefined) return known;
  let found = false;
  for (let from = 0; from < st.holder_count && !found; from += 50) {
    found = (await w.ports.view<unknown[]>("solana_allocations_page", { launch_id: id, from_seq: from, limit: 50 })).length > 0;
  }
  w.solana.set(id, found);
  return found;
}

/** The phase is a pure function of chain state. */
export async function phaseOf(w: Watcher, id: string): Promise<{ phase: Phase; g?: GenesisView }> {
  const st = await w.ports.view<CoreStateView | null>("get_state", { launch_id: id });
  if (!st || st.status !== "Passed") return { phase: "SKIPPED" };
  const g = await w.ports.view<GenesisView | null>("get_genesis", { launch_id: id });
  if (!g) return { phase: "SKIPPED" };
  if (g.status === "Confirmed") return { phase: "DONE", g };
  if (!(await hasSolanaPlan(w, id, g, st))) return { phase: "SKIPPED", g };
  if (g.status === "Aborted") return { phase: "ABORTED", g };
  if (g.status === "Committed") return { phase: "COMMITTED", g };
  return { phase: st.positions_unsettled === 0 && st.residue_swept ? "READY" : "PASS_SEEN", g };
}

const track = (w: Watcher, id: string): Track => {
  const t = w.tracks.get(id) ?? { attempts: 0, sawAborted: false, warnedDone: false };
  w.tracks.set(id, t);
  return t;
};

async function ceremony(w: Watcher, id: string, g: GenesisView): Promise<void> {
  const t = track(w, id);
  if (t.attempts >= w.o.maxAttempts) return;
  const mode = `${g.mode}${g.status === "Committed" ? " (resume)" : ""}`;
  if (w.o.dryRun) { w.ports.log("info", "dry_run_would_run_ceremony", { launch: id, mode }); return; }
  t.attempts++;
  try {
    const r = await w.ports.runCeremony(BigInt(id), g);
    w.ports.log("info", "ceremony_done", { launch: id, ...r });
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e);
    w.ports.log("error", "ceremony_failed", { launch: id, attempt: t.attempts, error });
    if (t.attempts >= w.o.maxAttempts) await w.ports.alert(`give_up:${id}`, "ceremony_gave_up", { launch: id, attempts: t.attempts, error });
  }
}

async function committed(w: Watcher, id: string, g: GenesisView): Promise<void> {
  if (g.mode === "F0") return ceremony(w, id, g);
  await w.ports.alert(`f1_stranded:${id}`, "f1_genesis_stranded", { launch: id, note: "committed F1 genesis, its memory-only key is gone; abort_genesis then owner reopen_genesis" });
  if (!w.o.autoAbortF1 || w.o.dryRun) return;
  await w.ports.abortGenesis(BigInt(id), "F1 key lost: relayer restarted before the ceremony finished");
}

async function step(w: Watcher, id: string): Promise<Phase> {
  const { phase, g } = await phaseOf(w, id);
  const t = track(w, id);
  if (phase === "ABORTED") t.sawAborted = true;
  if (g && g.status === "None" && t.sawAborted) { t.attempts = 0; t.sawAborted = false; w.ports.log("info", "genesis_reopened_seen", { launch: id }); }
  if (phase === "READY" && g) await ceremony(w, id, g);
  else if (phase === "COMMITTED" && g) await committed(w, id, g);
  else if (phase === "ABORTED") w.ports.log("info", "waiting_for_owner_reopen", { launch: id, reason: g?.abort_reason });
  else if (phase === "DONE" && !w.ports.recordExists(BigInt(id)) && !t.warnedDone) {
    t.warnedDone = true;
    await w.ports.alert(`no_record:${id}`, "confirmed_without_record", { launch: id, note: "genesis is confirmed on chain but this host has no record file for it" });
  }
  return phase;
}

/** One pass over every launch. One launch failing never stops the others. */
export async function watchOnce(w: Watcher): Promise<Record<string, Phase | "ERROR">> {
  const out: Record<string, Phase | "ERROR"> = {};
  for (const id of await discover(w)) {
    try {
      out[id] = await step(w, id);
    } catch (e) {
      out[id] = "ERROR";
      w.ports.log("error", "watch_failed", { launch: id, error: String(e instanceof Error ? e.message : e) });
    }
  }
  w.ports.log("info", "watch_cycle", { launches: out, dry_run: w.o.dryRun });
  return out;
}

/** commit_genesis is one-shot. When the core already holds this exact committed genesis (same key, root complete), a resumed F0
 *  ceremony must not commit again: this wrapper skips only that call and delegates everything else to the real core client. */
export class ResumingCore implements CoreClient {
  readonly label: string;
  constructor(private readonly inner: CoreClient, private readonly status: (id: bigint) => Promise<Pick<GenesisView, "status" | "g_pub" | "root_ready">>) {
    this.label = inner.label;
  }

  async commitGenesis(id: bigint, gPub: Uint8Array): Promise<void> {
    const g = await this.status(id);
    if (g.status === "Committed") {
      if (g.g_pub !== Buffer.from(gPub).toString("hex") || !g.root_ready) throw new Error("committed genesis has a different key or an incomplete root; refusing to resume");
      return;
    }
    return this.inner.commitGenesis(id, gPub);
  }

  specBytes = (id: bigint): Promise<Uint8Array> => this.inner.specBytes(id);
  specHashOnChain = (id: bigint): Promise<string> => this.inner.specHashOnChain(id);
  confirmGenesis = (id: bigint, mint: Uint8Array, sigs: string[], slot: number, hash: string): Promise<void> => this.inner.confirmGenesis(id, mint, sigs, slot, hash);
  abortGenesis = (id: bigint, reason: string): Promise<void> => this.inner.abortGenesis(id, reason);
}
