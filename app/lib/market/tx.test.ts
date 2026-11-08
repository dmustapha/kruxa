import { describe, expect, it } from 'vitest';
import { buildClaimTx, buildTradeTx, describeSignError, tradeMessage } from './tx';
import { WalletError } from '@/lib/wallet/types';

const base = { launchId: '7', minOut: 1000n, receiver: 'bob.testnet', market: 'market.kruxa.testnet' };

describe('trade transactions (MARKET-ABI)', () => {
  it('buy is a USDC ft_transfer_call with a v1 buy message and mandatory min_out', () => {
    const tx = buildTradeTx({ ...base, side: 'buy', amountIn: 5_000_000n, tokenContract: 'usdc.kruxa.testnet' });
    expect(tx.receiverId).toBe('usdc.kruxa.testnet');
    const p = tx.actions[0]!.params;
    expect(p.methodName).toBe('ft_transfer_call');
    expect(p.deposit).toBe('1');
    expect(p.args.receiver_id).toBe('market.kruxa.testnet');
    expect(p.args.amount).toBe('5000000');
    expect(JSON.parse(p.args.msg as string)).toEqual({ v: 1, op: 'buy', launch_id: '7', min_out: '1000', receiver: 'bob.testnet' });
  });
  it('sell goes to the launch token contract', () => {
    const tx = buildTradeTx({ ...base, side: 'sell', amountIn: 123n, tokenContract: 'tok.testnet' });
    expect(tx.receiverId).toBe('tok.testnet');
    expect(JSON.parse(tx.actions[0]!.params.args.msg as string).op).toBe('sell');
  });
  it('refuses to build with min_out zero or an empty amount', () => {
    expect(() => tradeMessage({ side: 'buy', launchId: '1', minOut: 0n, receiver: 'a.testnet' })).toThrow(/min_out/);
    expect(() => buildTradeTx({ ...base, side: 'buy', amountIn: 0n, tokenContract: 'u' })).toThrow();
  });
  it('referrer is only carried on buys', () => {
    expect(JSON.parse(tradeMessage({ side: 'buy', launchId: '1', minOut: 1n, receiver: 'a', referrer: 'r' })).referrer).toBe('r');
    expect(JSON.parse(tradeMessage({ side: 'sell', launchId: '1', minOut: 1n, receiver: 'a', referrer: 'r' })).referrer).toBeUndefined();
  });
  it('claim calls market.claim with no deposit', () => {
    const tx = buildClaimTx('market.kruxa.testnet', '7');
    expect(tx.receiverId).toBe('market.kruxa.testnet');
    expect(tx.actions[0]!.params).toMatchObject({ methodName: 'claim', args: { launch_id: '7' }, deposit: '0' });
  });
  it('explains wallet errors and always says nothing was sent', () => {
    expect(describeSignError(new WalletError('USER_REJECTED', 'x'))).toMatch(/Nothing was sent/);
    expect(describeSignError(new WalletError('MAINNET_LOCKED', 'x'))).toMatch(/locked/);
    expect(describeSignError(new Error('boom'))).toMatch(/boom/);
  });
});
