import { describe, expect, it, vi } from 'vitest';
import { MAINNET_CONFIRMATION_TOKEN, resolveNetworkGuard } from './env';
import { NearConnectAdapter, type NearConnectorLike } from './near';
import { WalletError } from './types';

function mockWallet(id = 'meteor-wallet') {
  return {
    manifest: { id, name: 'Meteor', icon: 'i.png', website: 'https://w' },
    getAccounts: vi.fn(async () => [{ accountId: 'maya.testnet' }]),
    signAndSendTransaction: vi.fn(async () => ({ transaction: { hash: 'H1' } })),
    signMessage: vi.fn(async () => ({ accountId: 'maya.testnet', publicKey: 'ed25519:K', signature: 'sig' })),
  };
}
function mockConnector(wallet = mockWallet()) {
  const handlers: Record<string, () => void> = {};
  const c = {
    whenManifestLoaded: Promise.resolve(),
    availableWallets: [wallet],
    connect: vi.fn(async () => wallet),
    disconnect: vi.fn(async () => {}),
    getConnectedWallet: vi.fn(async () => { throw new Error('none'); }),
    on: vi.fn((e: string, cb: () => void) => { handlers[e] = cb; }),
  } as unknown as NearConnectorLike & { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  return { c, wallet, handlers };
}
const adapterFor = (c: NearConnectorLike, guard = resolveNetworkGuard({})) => new NearConnectAdapter({ guard, createConnector: async () => c });

describe('NearConnectAdapter', () => {
  it('does not load the connector until asked', () => {
    const create = vi.fn();
    const a = new NearConnectAdapter({ createConnector: create });
    expect(a.getSession()).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it('lists wallets from the manifest', async () => {
    const { c } = mockConnector();
    expect(await adapterFor(c).listWallets()).toEqual([{ id: 'meteor-wallet', chain: 'near', name: 'Meteor', icon: 'i.png', installed: true, installUrl: 'https://w' }]);
  });
  it('connect yields a chain-labelled session and notifies subscribers', async () => {
    const { c } = mockConnector();
    const a = adapterFor(c);
    const seen: unknown[] = [];
    a.subscribe((s) => seen.push(s));
    const s = await a.connect('meteor-wallet');
    expect(s).toEqual({ chain: 'near', walletId: 'meteor-wallet', walletName: 'Meteor', address: 'maya.testnet', env: 'testnet' });
    expect(seen).toHaveLength(1);
  });
  it('rejects an unknown wallet id without prompting', async () => {
    const { c } = mockConnector();
    await expect(adapterFor(c).connect('nope')).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
    expect(c.connect).not.toHaveBeenCalled();
  });
  it('maps a user cancel to USER_REJECTED', async () => {
    const { c } = mockConnector();
    c.connect.mockRejectedValueOnce(new Error('User rejected'));
    await expect(adapterFor(c).connect('meteor-wallet')).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });
  it('signAndSendTransaction forwards actions and returns the hash', async () => {
    const { c, wallet } = mockConnector();
    const a = adapterFor(c);
    await a.connect('meteor-wallet');
    const actions = [{ type: 'FunctionCall' as const, params: { methodName: 'walk', args: { launch_id: '1' }, gas: '300000000000000', deposit: '1' } }];
    const r = await a.signAndSendTransaction({ receiverId: 'core.kruxa.testnet', actions });
    expect(r.txHash).toBe('H1');
    expect(wallet.signAndSendTransaction).toHaveBeenCalledWith({ receiverId: 'core.kruxa.testnet', signerId: 'maya.testnet', network: 'testnet', actions });
  });
  it('refuses to sign before connecting', async () => {
    const { c } = mockConnector();
    await expect(adapterFor(c).signAndSendTransaction({ receiverId: 'x.testnet', actions: [] })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
  it('refuses to sign when mainnet is locked and never reaches the wallet', async () => {
    const { c, wallet } = mockConnector();
    const a = adapterFor(c, resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet' }));
    await a.connect('meteor-wallet');
    await expect(a.signAndSendTransaction({ receiverId: 'x.near', actions: [] })).rejects.toMatchObject({ code: 'MAINNET_LOCKED' });
    expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it('signs on mainnet only with both conditions', async () => {
    const { c, wallet } = mockConnector();
    const a = adapterFor(c, resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet', NEXT_PUBLIC_MAINNET_CONFIRMED: MAINNET_CONFIRMATION_TOKEN }));
    await a.connect('meteor-wallet');
    await a.signAndSendTransaction({ receiverId: 'x.near', actions: [] });
    expect(wallet.signAndSendTransaction).toHaveBeenCalledOnce();
  });
  it('disconnect clears the session and calls the connector', async () => {
    const { c } = mockConnector();
    const a = adapterFor(c);
    await a.connect('meteor-wallet');
    await a.disconnect();
    expect(a.getSession()).toBeNull();
    expect(c.disconnect).toHaveBeenCalledOnce();
  });
  it('an external signOut event clears the session', async () => {
    const { c, handlers } = mockConnector();
    const a = adapterFor(c);
    await a.connect('meteor-wallet');
    handlers['wallet:signOut']?.();
    expect(a.getSession()).toBeNull();
  });
  it('surfaces a manifest load failure as NETWORK_UNAVAILABLE and allows retry', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const a = new NearConnectAdapter({ createConnector: create });
    await expect(a.listWallets()).rejects.toBeInstanceOf(WalletError);
    create.mockResolvedValueOnce(mockConnector().c);
    await expect(a.listWallets()).resolves.toHaveLength(1);
  });
  it('signMessage requires a recipient and 32 byte nonce', async () => {
    const { c } = mockConnector();
    const a = adapterFor(c);
    await a.connect('meteor-wallet');
    await expect(a.signMessage({ message: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'UNSUPPORTED_ACTION' });
    await expect(a.signMessage({ message: new Uint8Array([104]), recipient: 'kruxa', nonce: new Uint8Array(32) })).resolves.toMatchObject({ chain: 'near', signature: 'sig' });
  });
});
