/** Result of one contract call. Contract-level failures are reported here (never thrown); transport failures throw. */
export interface CallResult {
  ok: boolean;
  tx?: string;
  /** Rule code (R_NOTHING_FREE, R_TOO_EARLY, ...) parsed from the failure, when there is one. */
  code?: string;
  error?: string;
  /** True when dry-run swallowed the call: nothing was sent and chain state did not change. */
  dry?: boolean;
}

/** The only door to the chain. Views are free; calls are signed by the keeper account. */
export interface Chain {
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
  call(method: string, args: Record<string, unknown>, gasTgas: number): Promise<CallResult>;
}

export type LogFn = (level: "info" | "warn" | "error" | "alert", event: string, fields?: Record<string, unknown>) => void;

/** JSON from get_state. Amounts are decimal strings, counts are numbers. */
export interface CoreState {
  status: string;
  phase: string;
  holder_count: number;
  positions_live: number;
  positions_unsettled: number;
  residue_swept: boolean;
}

export interface CoreLedger {
  open_native: string; open_intents: string; due_native: string; due_intents: string;
  inflight_native: string; inflight_intents: string; launch_fee_due: string; launch_fee_paid: string;
}

export interface CorePosition { holder: string; seq: number; settled: boolean; due_native: string; due_intents: string }

export interface Invariants { all_ok: boolean; intents_alert: boolean; [k: string]: unknown }

export interface SolvencyReport {
  counters_ok: boolean;
  intents_alert: boolean;
  last_check: { ok: boolean; intents_alert?: boolean } | null;
}
