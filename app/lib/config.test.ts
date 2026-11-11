import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertExplicitMainnetAccounts, assertMainnetGate } from './config';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('mainnet gate (R_MAINNET_GATE)', () => {
  it('refuses mainnet without the exact confirmation token', () => {
    expect(() => assertMainnetGate('mainnet', undefined)).toThrow('R_MAINNET_GATE');
    expect(() => assertMainnetGate('mainnet', '')).toThrow('R_MAINNET_GATE');
    expect(() => assertMainnetGate('mainnet', 'yes')).toThrow('R_MAINNET_GATE');
    expect(() => assertMainnetGate('mainnet', 'dami-per-action-confirmed')).toThrow('R_MAINNET_GATE');
  });
  it('lets mainnet start only with the exact token', () => {
    expect(() => assertMainnetGate('mainnet', 'DAMI-PER-ACTION-CONFIRMED')).not.toThrow();
  });
  it('never blocks testnet', () => {
    expect(() => assertMainnetGate('testnet', undefined)).not.toThrow();
  });
  it('the module itself refuses to load on mainnet without the token', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEAR_NETWORK', 'mainnet');
    vi.stubEnv('NEXT_PUBLIC_MAINNET_CONFIRMED', '');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow('R_MAINNET_GATE');
  });
  it('the module loads on mainnet with the token, and defaults to testnet', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEAR_NETWORK', 'mainnet');
    vi.stubEnv('NEXT_PUBLIC_MAINNET_CONFIRMED', 'DAMI-PER-ACTION-CONFIRMED');
    for (const k of ['CORE', 'USDC', 'INTENTS', 'MARKET', 'INSTANT']) vi.stubEnv(`NEXT_PUBLIC_${k}_ACCOUNT`, 'x.near');
    vi.stubEnv('NEXT_PUBLIC_USDC_TOKEN_ID', 'nep141:x.near');
    vi.resetModules();
    expect((await import('./config')).NETWORK).toBe('mainnet');
    vi.stubEnv('NEXT_PUBLIC_NEAR_NETWORK', '');
    vi.resetModules();
    expect((await import('./config')).NETWORK).toBe('testnet');
  });
});

describe('mainnet has no default accounts (R_MAINNET_ACCOUNTS)', () => {
  const full = { NEXT_PUBLIC_CORE_ACCOUNT: 'a', NEXT_PUBLIC_USDC_ACCOUNT: 'b', NEXT_PUBLIC_USDC_TOKEN_ID: 'c', NEXT_PUBLIC_INTENTS_ACCOUNT: 'd', NEXT_PUBLIC_MARKET_ACCOUNT: 'e', NEXT_PUBLIC_INSTANT_ACCOUNT: 'f' };
  it('refuses mainnet when any contract account is unset', () => {
    expect(() => assertExplicitMainnetAccounts('mainnet', {})).toThrow('R_MAINNET_ACCOUNTS');
    expect(() => assertExplicitMainnetAccounts('mainnet', { ...full, NEXT_PUBLIC_CORE_ACCOUNT: '' })).toThrow('NEXT_PUBLIC_CORE_ACCOUNT');
  });
  it('passes mainnet when all are named, and never constrains testnet', () => {
    expect(() => assertExplicitMainnetAccounts('mainnet', full)).not.toThrow();
    expect(() => assertExplicitMainnetAccounts('testnet', {})).not.toThrow();
  });
  it('the module refuses mainnet with the token but no accounts', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEAR_NETWORK', 'mainnet');
    vi.stubEnv('NEXT_PUBLIC_MAINNET_CONFIRMED', 'DAMI-PER-ACTION-CONFIRMED');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow('R_MAINNET_ACCOUNTS');
  });
});
