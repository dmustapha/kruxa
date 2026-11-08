import { describe, expect, it } from 'vitest';
import { resolveNetworkGuard } from './env';
import { allowedChains, gateAction } from './gating';
import type { WalletSession } from './types';

const near: WalletSession = { chain: 'near', walletId: 'meteor-wallet', walletName: 'Meteor', address: 'maya.testnet', env: 'testnet' };
const sol: WalletSession = { chain: 'solana', walletId: 'phantom', walletName: 'Phantom', address: 'So1anaKey', env: 'testnet', intentsAccountId: 'ab'.repeat(32) };
const open = resolveNetworkGuard({});
const locked = resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet' });

describe('gateAction', () => {
  it('create with no session asks for NEAR only', () => {
    expect(gateAction('create', { near: null, solana: null }, open)).toMatchObject({ status: 'connect', chains: ['near'] });
  });
  it('create with a Solana-only session says it needs a NEAR account', () => {
    const d = gateAction('create', { near: null, solana: sol }, open);
    expect(d.status).toBe('needs-near');
    expect(d.status === 'needs-near' && d.message).toMatch(/needs a NEAR account/);
  });
  it('create with NEAR is ready on the native path', () => {
    expect(gateAction('create', { near: near, solana: sol }, open)).toMatchObject({ status: 'ready', path: 'near-native' });
  });
  it.each(['commit', 'walk', 'claim'] as const)('%s with no session offers both groups', (a) => {
    expect(gateAction(a, { near: null, solana: null }, open)).toMatchObject({ status: 'connect', chains: ['near', 'solana'] });
  });
  it.each(['commit', 'walk', 'claim'] as const)('%s with Solana only routes to the Intents path', (a) => {
    expect(gateAction(a, { near: null, solana: sol }, open)).toMatchObject({ status: 'ready', path: 'solana-intents' });
  });
  it('prefers the NEAR native path when both are connected', () => {
    expect(gateAction('commit', { near, solana: sol }, open)).toMatchObject({ path: 'near-native' });
  });
  it('blocks everything when signing is locked, even with sessions', () => {
    for (const a of ['create', 'commit', 'walk', 'claim'] as const) {
      expect(gateAction(a, { near, solana: sol }, locked).status).toBe('blocked');
    }
  });
  it('create only allows the NEAR chain', () => {
    expect(allowedChains('create')).toEqual(['near']);
    expect(allowedChains('commit')).toEqual(['near', 'solana']);
  });
});
