import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertMainnetGate } from './config';

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
    vi.resetModules();
    expect((await import('./config')).NETWORK).toBe('mainnet');
    vi.stubEnv('NEXT_PUBLIC_NEAR_NETWORK', '');
    vi.resetModules();
    expect((await import('./config')).NETWORK).toBe('testnet');
  });
});
