'use client';
import { useWallet } from '@/components/wallet';
import { ChainActionButton } from '../trial/ChainActionButton';
import { Badge } from '@/components/ui/Badges';
import { TxStatus } from '@/components/ui/TxStatus';
import { useApi } from '@/lib/api/useApi';
import { claimVestedNear } from '@/lib/actions';
import { fmtDate } from '@/lib/format';
import { getVesting, type VestingView } from '@/lib/instant/preview';
import { useTx } from '@/lib/useTx';

const tokens = (base: string): string => (BigInt(base) / 1_000_000n).toLocaleString('en-US');
const secs = (ns: string): number => Number(BigInt(ns) / 1_000_000_000n);

/** Allocation vesting for one instant launch: cliff, unlock, claimed, claimable, and the claim_vested call. The launcher's `get_vesting` view is the authority. */
export function VestPanel({ launchId, symbol, seedLabel }: { launchId: string; symbol?: string; seedLabel?: string }) {
  const { sessions, adapters } = useWallet();
  const tx = useTx();
  const v = useApi<VestingView | null>(() => getVesting(launchId), `vest-${launchId}`, 20000);
  if (v.status === 'loading' || v.status === 'idle') return <p className="hint">Reading the vesting schedule.</p>;
  if (v.status === 'error') return <p className="warn">The vesting schedule could not be read ({v.error.message}). Nothing is guessed.</p>;
  if (!v.data) return <p className="hint">No allocation is recorded for this launch.</p>;
  const d = v.data;
  const total = BigInt(d.total);
  const pct = total === 0n ? 0 : Number((BigInt(d.unlocked) * 10_000n) / total) / 100;
  const cliff = secs(d.cliff_end_ns);
  const opened = cliff > 0;
  const canAct = sessions.near?.address === d.recipient;
  const claimable = BigInt(d.claimable);
  return (
    <div className="stack">
      <div className="row between"><h4 style={{ margin: 0 }}>Allocation vesting{symbol ? ` for $${symbol}` : ''}</h4><Badge tone="chain">Chain read: get_vesting</Badge></div>
      <div className="meter" role="img" aria-label={`${pct} percent of the allocation has unlocked`}><div className="meter-fill clears" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <dl className="kv">
        <div><dt>Allocation</dt><dd>{tokens(d.total)} tokens</dd></div>
        <div><dt>Cliff ends</dt><dd>{opened ? fmtDate(cliff) : 'starts when the pool opens'}</dd></div>
        <div><dt>Fully unlocked</dt><dd>{opened ? fmtDate(secs(d.vest_end_ns)) : 'starts when the pool opens'}</dd></div>
        <div><dt>Unlocked so far</dt><dd>{tokens(d.unlocked)} tokens</dd></div>
        <div><dt>Claimed</dt><dd>{tokens(d.claimed)} tokens</dd></div>
        <div><dt>Claimable now</dt><dd>{tokens(d.claimable)} tokens</dd></div>
      </dl>
      <ChainActionButton chain="near" action="claim" disabled={!canAct || claimable === 0n} loading={tx.state.status === 'pending'}
        onReady={() => void tx.run(() => adapters.near.signAndSendTransaction(claimVestedNear(launchId, null)))}>Claim vested tokens</ChainActionButton>
      <p className="hint">{canAct ? (claimable === 0n ? 'Nothing is claimable yet: the cliff has not passed or everything unlocked is already claimed.' : 'Pays the unlocked, unclaimed amount to the payout recipient.') : `Only the payout recipient (${d.recipient}) can claim. Reading needs no wallet.`}</p>
      <p className="hint">{seedLabel ?? 'The USDC seed is locked in the pool and cannot be withdrawn.'}</p>
      <TxStatus state={tx.state} />
    </div>
  );
}
