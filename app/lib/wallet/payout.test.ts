import { describe, expect, it } from 'vitest';
import { resolvePayoutRecipient, validateNearAccountId } from './payout';

describe('validateNearAccountId', () => {
  it.each(['alice.testnet', 'dao-1.alice.testnet', 'a_b.testnet', 'ab.testnet', 'a'.repeat(64).replace(/a/g, '1') + ''])('accepts %s', (id) => {
    expect(validateNearAccountId(id, 'testnet').ok).toBe(true);
  });
  it.each(['', 'a', 'Alice.testnet', 'al..ice.testnet', '.alice.testnet', 'alice.testnet.', '-alice.testnet', 'al ice.testnet', 'a--b.testnet', 'x'.repeat(65)])('rejects %j', (id) => {
    expect(validateNearAccountId(id, 'testnet').ok).toBe(false);
  });
  it('names a Solana address as unsupported', () => {
    const r = validateNearAccountId('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Solana/);
  });
  it('accepts a 64-hex implicit account', () => {
    expect(validateNearAccountId('ab'.repeat(32)).ok).toBe(true);
  });
  it('warns for a non-.testnet name on testnet and rejects .testnet on mainnet', () => {
    const w = validateNearAccountId('dao.near', 'testnet');
    expect(w.ok && w.warning).toMatch(/\.testnet/);
    expect(validateNearAccountId('dao.testnet', 'mainnet').ok).toBe(false);
    expect(validateNearAccountId('dao.near', 'mainnet')).toEqual({ ok: true, accountId: 'dao.near' });
  });
  it('trims whitespace', () => {
    expect(validateNearAccountId('  alice.testnet ')).toEqual({ ok: true, accountId: 'alice.testnet' });
  });
});

describe('resolvePayoutRecipient', () => {
  it('defaults to the signer', () => {
    expect(resolvePayoutRecipient({ signer: 'maya.testnet', mode: 'self', other: '' })).toEqual({ ok: true, accountId: 'maya.testnet', isSeparate: false });
  });
  it('needs a signer in self mode', () => {
    expect(resolvePayoutRecipient({ signer: null, mode: 'self', other: '' }).ok).toBe(false);
  });
  it('uses a separate account when chosen', () => {
    expect(resolvePayoutRecipient({ signer: 'maya.testnet', mode: 'other', other: 'dao.testnet' })).toMatchObject({ ok: true, accountId: 'dao.testnet', isSeparate: true });
  });
  it('rejects an invalid separate account', () => {
    expect(resolvePayoutRecipient({ signer: 'maya.testnet', mode: 'other', other: 'NOPE' }).ok).toBe(false);
  });
});
