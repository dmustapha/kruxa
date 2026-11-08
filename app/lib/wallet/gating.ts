// Action gating. Pure: sessions + action + network guard in, one decision out. The UI renders the decision; it never decides.
import type { NetworkGuard } from './env';
import type { Chain, WalletAction, WalletSession } from './types';

export interface SessionSet {
  near: WalletSession | null;
  solana: WalletSession | null;
}

export type GateDecision =
  /** Go ahead. `path` says which signing path the action uses. */
  | { status: 'ready'; path: 'near-native' | 'solana-intents'; session: WalletSession }
  /** No usable session yet: open the chooser limited to `chains`. */
  | { status: 'connect'; chains: Chain[]; message: string }
  /** Solana-only session on a NEAR-only action. */
  | { status: 'needs-near'; message: string }
  | { status: 'blocked'; message: string };

export const ACTION_LABEL: Record<WalletAction, string> = { create: 'Create', commit: 'Commit', walk: 'Walk', claim: 'Claim' };

const NEEDS_NEAR_CREATE = 'Creating a launch needs a NEAR account. Your Solana wallet can back a launch, but it cannot create one. Connect a NEAR wallet to continue.';

/** Which chains may sign each action. Create is NEAR only. Buyer actions accept both (Solana goes through the Intents path). */
export function allowedChains(action: WalletAction): Chain[] {
  return action === 'create' ? ['near'] : ['near', 'solana'];
}

export function gateAction(action: WalletAction, sessions: SessionSet, guard: NetworkGuard): GateDecision {
  if (!guard.signingEnabled) return { status: 'blocked', message: guard.lockReason ?? 'Signing is locked on this network.' };
  const label = ACTION_LABEL[action];

  if (sessions.near) return { status: 'ready', path: 'near-native', session: sessions.near };

  if (action === 'create') {
    if (sessions.solana) return { status: 'needs-near', message: NEEDS_NEAR_CREATE };
    return { status: 'connect', chains: ['near'], message: `Connect a NEAR wallet to ${label.toLowerCase()} a launch.` };
  }
  if (sessions.solana) return { status: 'ready', path: 'solana-intents', session: sessions.solana };
  return { status: 'connect', chains: ['near', 'solana'], message: `Connect a wallet to ${label.toLowerCase()}.` };
}

/** Plain-language note shown beside a ready Solana-only action. */
export function intentsPathNote(action: WalletAction): string {
  switch (action) {
    case 'commit': return 'You are connected with Solana only. This goes through the Intents buyer path: you sign one message in your wallet and a relayer submits it. A flat relay fee comes out of the amount.';
    case 'walk': return 'You are connected with Solana only. You sign one Walk message in your wallet; anyone can submit it and the refund lands in your Intents account.';
    case 'claim': return 'You are connected with Solana only. Refunds land in your Intents account; token claims for Solana holders use the Solana distributor.';
    case 'create': return NEEDS_NEAR_CREATE;
  }
}
