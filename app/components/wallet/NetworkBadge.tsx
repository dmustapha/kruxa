'use client';
import { useWallet } from './WalletProvider';

/** Testnet / mainnet label. Locked mainnet is called out so nobody expects a signature prompt. */
export function NetworkBadge() {
  const { guard } = useWallet();
  const tone = guard.env === 'mainnet' ? (guard.signingEnabled ? 'wlt-net-main' : 'wlt-net-locked') : 'wlt-net-test';
  return (
    <span className={`wlt-net ${tone}`} title={guard.lockReason} data-env={guard.env} data-signing={guard.signingEnabled}>
      {guard.label}
    </span>
  );
}
