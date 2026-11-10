import { describe, expect, it } from 'vitest';
import { CLAIM_TOKENS_DEPOSIT_YOCTO, claimCreatorAllocNear, claimTokensNear, sweepTokensNear } from './actions';
import { CONFIG } from './config';
import { ACTION_LABEL, allowedChains, gateAction, intentsPathNote } from './wallet/index';

const call = (i: ReturnType<typeof claimCreatorAllocNear>) => i.actions[0]!.params;

describe('payable delivery calls', () => {
  it('claim_creator_alloc: core, 200 Tgas, 0.00125 NEAR + 1 yocto', () => {
    const i = claimCreatorAllocNear('7');
    expect(i.receiverId).toBe(CONFIG.core);
    expect(call(i)).toEqual({ methodName: 'claim_creator_alloc', args: { launch_id: '7' }, gas: '200000000000000', deposit: CLAIM_TOKENS_DEPOSIT_YOCTO });
    expect(CLAIM_TOKENS_DEPOSIT_YOCTO).toBe('1250000000000000000001');
  });
  it('sweep_tokens: core, 200 Tgas, same deposit shape', () => {
    const p = call(sweepTokensNear('7'));
    expect(p.methodName).toBe('sweep_tokens');
    expect(p.gas).toBe('200000000000000');
    expect(p.deposit).toBe(CLAIM_TOKENS_DEPOSIT_YOCTO);
  });
  it('claim_tokens keeps the same shape', () => {
    expect(call(claimTokensNear('7')).deposit).toBe(CLAIM_TOKENS_DEPOSIT_YOCTO);
  });
});

describe('trade is a first-class wallet action (IR-W1)', () => {
  const guard = { env: 'testnet' as const, signingEnabled: true, label: 'Testnet', solanaCluster: 'devnet' as const };
  const ses = (chain: 'near' | 'solana') => ({ chain, walletId: 'w', walletName: 'W', address: 'a', env: 'testnet' as const });
  it('has a label and is NEAR only', () => {
    expect(ACTION_LABEL.trade).toBe('Trade');
    expect(allowedChains('trade')).toEqual(['near']);
    expect(intentsPathNote('trade')).toMatch(/NEAR wallet/);
  });
  it('asks a Solana-only wallet to connect NEAR instead of using the Intents path', () => {
    expect(gateAction('trade', { near: null, solana: ses('solana') }, guard).status).toBe('needs-near');
    expect(gateAction('trade', { near: null, solana: null }, guard)).toMatchObject({ status: 'connect', chains: ['near'] });
    expect(gateAction('trade', { near: ses('near'), solana: null }, guard)).toMatchObject({ status: 'ready', path: 'near-native' });
  });
});
