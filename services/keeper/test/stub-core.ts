import type { CallResult, Chain } from "../src/types.js";

interface Pos { holder: string; seq: number; settled: boolean; due_native: string; due_intents: string }

/** A tiny in-memory core: just enough state transitions to check the keeper's order, idempotency and resume. No network. */
export class StubCore implements Chain {
  calls: Array<{ method: string; args: Record<string, unknown>; gas: number }> = [];
  status = "Open";
  phase = "Ready";
  residueSwept = false;
  positions: Pos[] = [];
  feeDue = 100n;
  feePaid = 0n;
  intentsToMove = 0n;
  inflight = "0";
  nothingFree = new Set<string>();
  refuse = new Map<string, string>();
  invariants: Record<string, unknown> = { all_ok: true, intents_alert: false, l1_ok: true, l1_err: null };
  solvency = { counters_ok: true, intents_alert: false, last_check: { ok: true } as { ok: boolean } | null };
  launches = 1;

  unsettled = (): number => this.positions.filter((p) => !p.settled).length;
  private state() {
    return { status: this.status, phase: this.phase, holder_count: this.positions.length, positions_live: this.positions.length, positions_unsettled: this.unsettled(), residue_swept: this.residueSwept };
  }

  async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const id = Number(args.launch_id);
    const v: Record<string, () => unknown> = {
      get_state: () => (id >= 1 && id <= this.launches ? this.state() : null),
      get_ledger: () => ({ open_native: "0", open_intents: "0", due_native: this.positions.reduce((n, p) => n + BigInt(p.due_native), 0n).toString(), due_intents: "0", inflight_native: this.inflight, inflight_intents: "0", launch_fee_due: this.feeDue.toString(), launch_fee_paid: this.feePaid.toString() }),
      list_positions: () => this.positions.filter((p) => p.seq >= Number(args.from_seq)).slice(0, Number(args.limit)),
      get_invariants: () => this.invariants,
      solvency_report: () => this.solvency,
    };
    return v[method]!() as T;
  }

  async call(method: string, args: Record<string, unknown>, gas: number): Promise<CallResult> {
    this.calls.push({ method, args, gas });
    const code = this.refuse.get(method);
    if (code) return { ok: false, code, error: code };
    if (this.nothingFree.has(method)) return { ok: false, code: "R_NOTHING_FREE", error: "R_NOTHING_FREE" };
    this.apply(method, args);
    return { ok: true, tx: `tx-${this.calls.length}` };
  }

  private apply(method: string, args: Record<string, unknown>): void {
    if (method === "settle") this.status = this.positions.length === 0 && this.status === "Failed" ? "Failed" : "Passed";
    if (method === "settle_positions_page") for (const p of this.positions) if (p.seq >= Number(args.from_seq) && p.seq < Number(args.from_seq) + 25) p.settled = true;
    if (method === "sweep_residue") this.residueSwept = true;
    if (method === "pay_launch_fee") { this.feePaid = this.feeDue; this.nothingFree.add("pay_launch_fee"); }
    if (method === "consolidate") this.nothingFree.add("consolidate");
    if (method === "pay_relay_fees") this.nothingFree.add("pay_relay_fees");
    if (method === "claim_refund_batch") this.positions = this.positions.filter((p) => !(args.holders as string[]).includes(p.holder));
    if (method === "dissolve") this.status = "Dissolved";
  }

  names = (): string[] => this.calls.map((c) => c.method);
}

export const positions = (n: number, due = "0"): Pos[] => Array.from({ length: n }, (_, seq) => ({ holder: `near:h${seq}.testnet`, seq, settled: false, due_native: due, due_intents: "0" }));
