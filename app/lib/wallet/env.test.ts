import { describe, expect, it } from 'vitest';
import { MAINNET_CONFIRMATION_TOKEN, assertSigningAllowed, resolveNetworkGuard } from './env';

describe('network guard', () => {
  it('defaults to testnet with signing enabled', () => {
    const g = resolveNetworkGuard({});
    expect(g).toMatchObject({ env: 'testnet', signingEnabled: true, label: 'Testnet', solanaCluster: 'devnet' });
  });
  it('mainnet without the token is locked', () => {
    const g = resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet' });
    expect(g.env).toBe('mainnet');
    expect(g.signingEnabled).toBe(false);
    expect(() => assertSigningAllowed(g)).toThrowError(/confirmation token/);
  });
  it('token alone (env not mainnet) never enables mainnet', () => {
    const g = resolveNetworkGuard({ NEXT_PUBLIC_MAINNET_CONFIRMED: MAINNET_CONFIRMATION_TOKEN });
    expect(g.env).toBe('testnet');
  });
  it('a wrong token does not unlock', () => {
    expect(resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet', NEXT_PUBLIC_MAINNET_CONFIRMED: 'yes' }).signingEnabled).toBe(false);
  });
  it('both conditions together enable mainnet signing', () => {
    const g = resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet', NEXT_PUBLIC_MAINNET_CONFIRMED: MAINNET_CONFIRMATION_TOKEN });
    expect(g).toMatchObject({ env: 'mainnet', signingEnabled: true, solanaCluster: 'mainnet' });
    expect(() => assertSigningAllowed(g)).not.toThrow();
  });
  it('a legacy mainnet switch without KRUXA_ENV fails closed', () => {
    const g = resolveNetworkGuard({ NEXT_PUBLIC_NEAR_NETWORK: 'mainnet', NEXT_PUBLIC_MAINNET_CONFIRMED: MAINNET_CONFIRMATION_TOKEN });
    expect(g.signingEnabled).toBe(false);
  });
  it('unknown KRUXA_ENV values are treated as testnet', () => {
    expect(resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'Mainnet ' }).env).toBe('testnet');
  });
});
