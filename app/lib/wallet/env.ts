// Network guard. Mainnet signing is OFF unless BOTH hold: NEXT_PUBLIC_KRUXA_ENV=mainnet AND the existing per-action
// confirmation token is set (the same token lib/config.ts checks). Anything else fails closed to a signing-locked state.
import { WalletError, type KruxaEnv } from './types';

export const MAINNET_CONFIRMATION_TOKEN = 'DAMI-PER-ACTION-CONFIRMED';

export interface EnvInput {
  NEXT_PUBLIC_KRUXA_ENV?: string;
  NEXT_PUBLIC_MAINNET_CONFIRMED?: string;
  /** The legacy network switch read by lib/config.ts. A conflict with KRUXA_ENV locks signing. */
  NEXT_PUBLIC_NEAR_NETWORK?: string;
}

export interface NetworkGuard {
  env: KruxaEnv;
  signingEnabled: boolean;
  /** Short label for the badge. */
  label: string;
  /** Why signing is locked, when it is. */
  lockReason?: string;
  /** Solana cluster used for this env. */
  solanaCluster: 'devnet' | 'mainnet';
}

/** Next inlines only literal `process.env.NEXT_PUBLIC_X` reads, so each key is read explicitly. */
export function readEnvInput(): EnvInput {
  return {
    NEXT_PUBLIC_KRUXA_ENV: process.env.NEXT_PUBLIC_KRUXA_ENV,
    NEXT_PUBLIC_MAINNET_CONFIRMED: process.env.NEXT_PUBLIC_MAINNET_CONFIRMED,
    NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
  };
}

export function resolveNetworkGuard(input: EnvInput = readEnvInput()): NetworkGuard {
  const wantsMainnet = input.NEXT_PUBLIC_KRUXA_ENV === 'mainnet';
  const legacyMainnet = input.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet';
  const confirmed = input.NEXT_PUBLIC_MAINNET_CONFIRMED === MAINNET_CONFIRMATION_TOKEN;

  if (!wantsMainnet && !legacyMainnet) {
    return { env: 'testnet', signingEnabled: true, label: 'Testnet', solanaCluster: 'devnet' };
  }
  if (!wantsMainnet && legacyMainnet) {
    return {
      env: 'testnet', signingEnabled: false, label: 'Testnet (signing locked)', solanaCluster: 'devnet',
      lockReason: 'Network settings conflict: NEXT_PUBLIC_NEAR_NETWORK is mainnet but NEXT_PUBLIC_KRUXA_ENV is not. Signing is locked.',
    };
  }
  if (!confirmed) {
    return {
      env: 'mainnet', signingEnabled: false, label: 'Mainnet (read only)', solanaCluster: 'mainnet',
      lockReason: 'Mainnet signing needs the per-action confirmation token. Signing is locked.',
    };
  }
  return { env: 'mainnet', signingEnabled: true, label: 'Mainnet', solanaCluster: 'mainnet' };
}

/** Called by every adapter before anything is signed. */
export function assertSigningAllowed(guard: NetworkGuard): void {
  if (!guard.signingEnabled) throw new WalletError('MAINNET_LOCKED', guard.lockReason ?? 'Signing is locked.');
}
