// Reads the contract's public views for one launch and returns what the browser recompute needs. Shared by the verify page and the
// RecomputeButton so both answer from the same reads. An RPC failure is `unavailable`, never a mismatch.
import { getCharter, getSettlement, getState, getVerdictInputs, type Settlement } from './near';
import type { VerdictInputs } from './verdict';
import { bookHashCheck, recompute, summarize, type Check, type CheckStatus } from './verify';

export type Snap =
  | { status: 'unavailable'; message: string }
  | { status: 'ok'; inputs: VerdictInputs; storedHash: string; settlement: Settlement | null; bookHash: string; charter: { sale_bps: number; lp_bps: number; hard_cap: string } };

export async function readChain(id: string): Promise<Snap> {
  try {
    const [vi, st, settlement, charter] = await Promise.all([getVerdictInputs(id), getState(id), getSettlement(id) as Promise<Settlement | null>, getCharter(id)]);
    if (!vi || !st || !charter) return { status: 'unavailable', message: `The contract has no launch ${id} (or the RPC returned nothing).` };
    return {
      status: 'ok', inputs: vi.inputs as unknown as VerdictInputs, storedHash: vi.inputs_hash, settlement, bookHash: st.book_hash,
      charter: { sale_bps: Number(charter.params['sale_bps']), lp_bps: Number(charter.params['lp_bps']), hard_cap: String(charter.params['hard_cap']) },
    };
  } catch (e) {
    return { status: 'unavailable', message: (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'RPC failed' };
  }
}

export function checksFor(snap: Snap & { status: 'ok' }, indexerBookHash: string | null, tamper: boolean): Check[] {
  return [
    ...recompute({ inputs: snap.inputs, storedInputsHash: snap.storedHash, settlement: snap.settlement, state: { total_active: snap.inputs.total_active, active_funders: snap.inputs.active_funders, book_hash: snap.bookHash }, charter: snap.charter }, { tamper }),
    bookHashCheck(indexerBookHash, snap.bookHash),
  ];
}

export const overallOf = (checks: Check[]): CheckStatus | null => (checks.length ? summarize(checks) : null);
