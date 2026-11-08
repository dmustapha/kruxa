// What the core contract answers to a stream draw, computed from its own `stream_status` numbers (payout.rs `draw`).
// This is a COMPUTATION from chain-read numbers, not an on-chain result, and the UI labels it so.

export interface StreamNumbers { total: string; cap: string; drawn: string; inflight: string; drawable: string }

export type DrawOutcome = { wouldRevert: true; message: string } | { wouldRevert: false; amount: string };

/** `requested` null means "everything drawable" (the contract's default). Anything above drawable panics with STREAM_CAP. */
export function drawOutcome(s: Pick<StreamNumbers, 'drawable'>, requested: bigint | null): DrawOutcome {
  const drawable = BigInt(s.drawable);
  const want = requested ?? drawable;
  if (want > drawable) return { wouldRevert: true, message: `STREAM_CAP: requested ${want} > drawable ${drawable}` };
  if (want === 0n) return { wouldRevert: true, message: 'R_NOTHING_FREE: nothing drawable or funds not consolidated' };
  return { wouldRevert: false, amount: want.toString() };
}

/** Unlocked fraction in basis points, for the meter. */
export function unlockedBps(s: Pick<StreamNumbers, 'total' | 'cap'>): number {
  const t = BigInt(s.total);
  return t === 0n ? 0 : Number((BigInt(s.cap) * 10_000n) / t);
}
