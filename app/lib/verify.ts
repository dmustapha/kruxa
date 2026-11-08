// Browser-side recompute for /launch/[id]/verify. Reads the contract's public views over RPC, recomputes the verdict, the inputs
// hash and the settlement arithmetic with the TypeScript port in verdict.ts (pinned to the Rust output by verdict.test.ts), and compares.
// MISMATCH means a recomputed value differs from the stored one. An unreachable RPC is "UNAVAILABLE", never a MISMATCH (CO-6 E-4).
import { allocate, inputsHash, verdict, type VerdictInputs } from './verdict';
import type { Settlement } from './near';

export type CheckStatus = 'MATCH' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE';
export interface Check { id: string; label: string; status: CheckStatus; recomputed?: string; stored?: string; note?: string }

export interface ChainSnapshot {
  inputs: VerdictInputs;
  storedInputsHash: string;
  settlement: Settlement | null;
  state: { total_active: string; active_funders: number; book_hash: string };
  charter: { sale_bps: number; lp_bps: number; hard_cap: string };
}

export interface RecomputeOptions { tamper: boolean }

/** Flip one unit of total_active, exactly as `verify.sh --tamper` does. Only the recomputation sees it. */
export function tampered(i: VerdictInputs): VerdictInputs {
  return { ...i, total_active: (BigInt(i.total_active) + 1n).toString() };
}

const label = (pass: boolean, reasons = 0): string => (pass ? 'PASS' : `FAIL (reasons ${reasons})`);

export function recompute(s: ChainSnapshot, opts: RecomputeOptions): Check[] {
  const used = opts.tamper ? tampered(s.inputs) : s.inputs;
  const out = verdict(used);
  const hash = inputsHash(used);
  const checks: Check[] = [
    {
      id: 'V1', label: 'Inputs hash', status: hash === s.storedInputsHash ? 'MATCH' : 'MISMATCH', recomputed: hash, stored: s.storedInputsHash,
      note: opts.tamper ? 'Tamper is ON: total_active was raised by 1 unit before recomputing, so this must print MISMATCH.' : undefined,
    },
  ];
  if (!s.settlement) {
    checks.push({ id: 'V2', label: 'Verdict', status: 'PENDING', recomputed: label(out.pass, out.pass ? 0 : out.reasons), note: 'Not settled yet. The verdict you see is what settle would record on these inputs right now.' });
    return checks;
  }
  const st = s.settlement;
  const settledHashOk = hash === st.inputs_hash;
  checks.push({ id: 'V2', label: 'Verdict vs stored settlement', status: out.pass === st.pass ? 'MATCH' : 'MISMATCH', recomputed: label(out.pass, out.pass ? 0 : out.reasons), stored: label(st.pass, st.reasons) });
  checks.push({ id: 'V3', label: 'Settled inputs hash', status: settledHashOk ? 'MATCH' : 'MISMATCH', recomputed: hash, stored: st.inputs_hash });
  if (st.pass) {
    const a = allocate(BigInt(used.total_active), BigInt(s.charter.hard_cap), BigInt(s.charter.sale_bps), BigInt(s.charter.lp_bps));
    const same = a.accepted.toString() === st.accepted && a.launchFee.toString() === st.launch_fee && a.lpQuote.toString() === st.lp_quote
      && a.stream.toString() === st.stream && a.excessPool.toString() === st.excess_pool;
    checks.push({
      id: 'V4', label: 'Allocation (accepted, launch fee, LP, stream, refund pool)', status: same ? 'MATCH' : 'MISMATCH',
      recomputed: `${a.accepted}/${a.launchFee}/${a.lpQuote}/${a.stream}/${a.excessPool}`, stored: `${st.accepted}/${st.launch_fee}/${st.lp_quote}/${st.stream}/${st.excess_pool}`,
    });
  }
  return checks;
}

export function summarize(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'MISMATCH')) return 'MISMATCH';
  if (checks.some((c) => c.status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (checks.some((c) => c.status === 'PENDING')) return 'PENDING';
  return 'MATCH';
}

/** Compare the indexer's folded book hash with the contract's own `get_state` book hash. Neither side is trusted over the other. */
export function bookHashCheck(indexer: string | null | undefined, chain: string | null): Check {
  if (!chain) return { id: 'V5', label: 'Indexer book hash vs contract get_state', status: 'UNAVAILABLE', note: 'The contract view could not be read.' };
  if (!indexer) return { id: 'V5', label: 'Indexer book hash vs contract get_state', status: 'UNAVAILABLE', note: 'The indexer returned no book hash.' };
  return { id: 'V5', label: 'Indexer book hash vs contract get_state', status: indexer === chain ? 'MATCH' : 'MISMATCH', recomputed: indexer, stored: chain, note: 'recomputed = indexer fold, stored = contract view' };
}
