'use client';
import { WalletActionButton, useWallet } from '@/components/wallet';
import { TxStatus } from '@/components/ui/TxStatus';
import { claimCreatorAllocNear, sweepTokensNear } from '@/lib/actions';
import { useTx } from '@/lib/useTx';

/** Trial launches after PASS: the creator allocation claim (payout recipient only) and the permissionless sweep of unowed supply. */
export function AllocPanel({ launchId, symbol, canAct }: { launchId: string; symbol: string; canAct: boolean }) {
  const { adapters } = useWallet();
  const claim = useTx();
  const sweep = useTx();
  return (
    <div className="stack">
      <p>If the Charter set aside an allocation for the creator, it unlocks after a cliff and then linearly. Only the payout recipient can claim it.</p>
      <WalletActionButton action="claim" disabled={!canAct} loading={claim.state.status === 'pending'}
        onReady={(d) => { if (d.path === 'near-native') void claim.run(() => adapters.near.signAndSendTransaction(claimCreatorAllocNear(launchId))); }}>Claim vested {symbol} allocation</WalletActionButton>
      <p className="hint">Payable: 0.00125 NEAR plus 1 yocto is attached to register your account on the token if it is not registered yet; the rest is refunded. If nothing has vested, the contract refuses and says why.</p>
      <TxStatus state={claim.state} />
      <details>
        <summary>Sweep unclaimed supply (anyone can call)</summary>
        <p className="hint">Releases supply nobody is owed, once the backer bonus vest and the sweep window have ended. It goes only to the contract&apos;s burn mode: by default Hold, which marks the supply as held and moves nothing. Never to the creator or to Kruxa.</p>
        <WalletActionButton action="claim" loading={sweep.state.status === 'pending'}
          onReady={(d) => { if (d.path === 'near-native') void sweep.run(() => adapters.near.signAndSendTransaction(sweepTokensNear(launchId))); }}>Sweep unclaimed supply</WalletActionButton>
        <TxStatus state={sweep.state} />
      </details>
    </div>
  );
}
