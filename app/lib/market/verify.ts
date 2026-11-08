// Browser recompute for the Verify tab. Same semantics as U1's /launch/[id]/verify (MATCH, MISMATCH, PENDING, UNAVAILABLE; an unreachable
// RPC is UNAVAILABLE, never MISMATCH). Built on lib/verdict.ts, which is pinned to the Rust output by tests. When U1's lib/verify.ts
// lands on main, the two should be merged into one module and this file should re-export it (REQ-ui-market-2.md).
import { allocate, inputsHash, verdict, type VerdictInputs } from '@/lib/verdict';

export type CheckStatus = 'MATCH' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE';
export interface Check { id: string; label: string; status: CheckStatus; recomputed?: string; stored?: string; note?: string }

export interface Settlement {
  pass: boolean; reasons: number; settled_at?: string; total_active: string; accepted: string; launch_fee: string; lp_quote: string;
  stream: string; excess_pool: string; inputs_hash: string; book_hash?: string;
}
export interface ChainSnapshot {
  inputs: VerdictInputs;
  storedInputsHash: string;
  settlement: Settlement | null;
  bookHash: string | null;
  charter: { sale_bps: number; lp_bps: number; hard_cap: string };
}

/** Flip one unit of total_active, exactly as `verify.sh --tamper` does. Only the recomputation sees it. */
export function tampered(i: VerdictInputs): VerdictInputs {
  return { ...i, total_active: (BigInt(i.total_active) + 1n).toString() };
}
const label = (pass: boolean, reasons = 0): string => (pass ? 'PASS' : `FAIL (reasons ${reasons})`);

export function recompute(s: ChainSnapshot, tamper: boolean): Check[] {
  const used = tamper ? tampered(s.inputs) : s.inputs;
  const out = verdict(used);
  const hash = inputsHash(used);
  const checks: Check[] = [{
    id: 'V1', label: 'Inputs hash', status: hash === s.storedInputsHash ? 'MATCH' : 'MISMATCH', recomputed: hash, stored: s.storedInputsHash,
    note: tamper ? 'Tamper is ON: total_active was raised by 1 unit before recomputing, so this must print MISMATCH.' : undefined,
  }];
  if (!s.settlement) {
    checks.push({ id: 'V2', label: 'Verdict', status: 'PENDING', recomputed: label(out.pass, out.pass ? 0 : out.reasons), note: 'Not settled yet. This is what settle would record on these inputs right now.' });
    return checks;
  }
  const st = s.settlement;
  checks.push({ id: 'V2', label: 'Verdict vs stored settlement', status: out.pass === st.pass ? 'MATCH' : 'MISMATCH', recomputed: label(out.pass, out.pass ? 0 : out.reasons), stored: label(st.pass, st.reasons) });
  checks.push({ id: 'V3', label: 'Settled inputs hash', status: hash === st.inputs_hash ? 'MATCH' : 'MISMATCH', recomputed: hash, stored: st.inputs_hash });
  if (st.pass) {
    const a = allocate(BigInt(used.total_active), BigInt(s.charter.hard_cap), BigInt(s.charter.sale_bps), BigInt(s.charter.lp_bps));
    const same = a.accepted.toString() === st.accepted && a.launchFee.toString() === st.launch_fee && a.lpQuote.toString() === st.lp_quote
      && a.stream.toString() === st.stream && a.excessPool.toString() === st.excess_pool;
    checks.push({ id: 'V4', label: 'Allocation (accepted, launch fee, LP, stream, refund pool)', status: same ? 'MATCH' : 'MISMATCH',
      recomputed: `${a.accepted}/${a.launchFee}/${a.lpQuote}/${a.stream}/${a.excessPool}`, stored: `${st.accepted}/${st.launch_fee}/${st.lp_quote}/${st.stream}/${st.excess_pool}` });
  }
  return checks;
}

export function bookHashCheck(indexer: string | null | undefined, chain: string | null): Check {
  const id = 'V5'; const lab = 'Indexer book hash vs contract get_state';
  if (!chain) return { id, label: lab, status: 'UNAVAILABLE', note: 'The contract view could not be read.' };
  if (!indexer) return { id, label: lab, status: 'UNAVAILABLE', note: 'The indexer returned no book hash.' };
  return { id, label: lab, status: indexer === chain ? 'MATCH' : 'MISMATCH', recomputed: indexer, stored: chain, note: 'recomputed = indexer fold, stored = contract view' };
}

export function summarize(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'MISMATCH')) return 'MISMATCH';
  if (checks.some((c) => c.status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (checks.some((c) => c.status === 'PENDING')) return 'PENDING';
  return 'MATCH';
}

export type SnapshotResult = { status: 'ok'; snapshot: ChainSnapshot } | { status: 'unavailable'; message: string };
export interface ChainReaders {
  getVerdictInputs(id: string): Promise<{ inputs: Record<string, unknown>; inputs_hash: string } | null>;
  getState(id: string): Promise<{ book_hash: string } | null>;
  getSettlement(id: string): Promise<Record<string, unknown> | null>;
  getCharter(id: string): Promise<{ params: Record<string, string | number> } | null>;
}

/** Reads the contract's public views. Any failure is `unavailable`, which the UI shows as UNAVAILABLE and never as MISMATCH. */
export async function readSnapshot(id: string, r: ChainReaders): Promise<SnapshotResult> {
  try {
    const [vi, st, settlement, charter] = await Promise.all([r.getVerdictInputs(id), r.getState(id), r.getSettlement(id), r.getCharter(id)]);
    if (!vi || !st || !charter) return { status: 'unavailable', message: `The contract has no launch ${id}, or the RPC returned nothing.` };
    return { status: 'ok', snapshot: {
      inputs: vi.inputs as unknown as VerdictInputs, storedInputsHash: vi.inputs_hash, settlement: settlement as unknown as Settlement | null, bookHash: st.book_hash,
      charter: { sale_bps: Number(charter.params['sale_bps']), lp_bps: Number(charter.params['lp_bps']), hard_cap: String(charter.params['hard_cap']) },
    } };
  } catch (e) { return { status: 'unavailable', message: (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'RPC failed' }; }
}

export const verifyCommand = (id: string, tamper = false): string => `./scripts/verify.sh ${id}${tamper ? ' --tamper' : ''}`;
