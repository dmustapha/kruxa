import { describe, expect, it, vi } from 'vitest';
import { resolveNetworkGuard } from './env';
import { SolanaWalletStandardAdapter } from './solana';

const PK = Uint8Array.from({ length: 32 }, (_, i) => i);
const HEX = Array.from(PK, (b) => b.toString(16).padStart(2, '0')).join('');

function mockWallet(name = 'Phantom', opts: { sign?: boolean } = {}) {
  const account = { address: 'PhantomBase58Addr', publicKey: PK, chains: ['solana:devnet'], features: [] };
  const connect = vi.fn(async () => ({ accounts: [account] }));
  const disconnect = vi.fn(async () => {});
  const signMessage = vi.fn(async () => [{ signedMessage: Uint8Array.of(1, 2), signature: Uint8Array.of(9, 9) }]);
  const features: Record<string, unknown> = { 'standard:connect': { connect }, 'standard:disconnect': { disconnect } };
  if (opts.sign !== false) features['solana:signMessage'] = { signMessage };
  return { wallet: { name, icon: 'data:,', version: '1.0.0', chains: ['solana:devnet'], accounts: [], features }, connect, disconnect, signMessage };
}
const registryOf = (...wallets: unknown[]) => ({ get: () => wallets as never, on: () => () => {} });
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const make = (reg = registryOf(), guard = resolveNetworkGuard({}), storage = memStore()) => new SolanaWalletStandardAdapter({ registry: reg, guard, storage });

describe('SolanaWalletStandardAdapter', () => {
  it('always lists Phantom, Solflare and Backpack and marks which are installed', async () => {
    const list = await make(registryOf(mockWallet('Phantom').wallet)).listWallets();
    expect(list.map((w) => [w.id, w.installed])).toEqual([['phantom', true], ['solflare', false], ['backpack', false]]);
    expect(list[1]?.installUrl).toMatch(/^https:/);
  });
  it('ignores wallets that cannot signMessage', async () => {
    const list = await make(registryOf(mockWallet('Phantom', { sign: false }).wallet)).listWallets();
    expect(list[0]?.installed).toBe(false);
  });
  it('connect builds a session with the Intents account id', async () => {
    const m = mockWallet();
    const s = await make(registryOf(m.wallet)).connect('phantom');
    expect(s).toEqual({ chain: 'solana', walletId: 'phantom', walletName: 'Phantom', address: 'PhantomBase58Addr', env: 'testnet', intentsAccountId: HEX });
    expect(HEX).toHaveLength(64);
  });
  it('connect to a missing wallet fails without prompting', async () => {
    await expect(make().connect('backpack')).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
  });
  it('maps a rejected connect', async () => {
    const m = mockWallet();
    m.connect.mockRejectedValueOnce(new Error('User rejected the request'));
    await expect(make(registryOf(m.wallet)).connect('phantom')).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });
  it('signMessage returns raw signature bytes untouched', async () => {
    const m = mockWallet();
    const a = make(registryOf(m.wallet));
    await a.connect('phantom');
    const msg = new Uint8Array([7, 7]);
    const out = await a.signMessage({ message: msg });
    expect(out).toEqual({ chain: 'solana', address: 'PhantomBase58Addr', signature: Uint8Array.of(9, 9), signedMessage: Uint8Array.of(1, 2) });
    expect(m.signMessage).toHaveBeenCalledWith({ account: expect.objectContaining({ address: 'PhantomBase58Addr' }), message: msg });
  });
  it('refuses signMessage when mainnet is locked', async () => {
    const m = mockWallet();
    const a = make(registryOf(m.wallet), resolveNetworkGuard({ NEXT_PUBLIC_KRUXA_ENV: 'mainnet' }));
    await a.connect('phantom');
    await expect(a.signMessage({ message: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'MAINNET_LOCKED' });
    expect(m.signMessage).not.toHaveBeenCalled();
  });
  it('cannot send NEAR transactions', async () => {
    await expect(make().signAndSendTransaction()).rejects.toMatchObject({ code: 'UNSUPPORTED_ACTION' });
  });
  it('signMessage before connect is NOT_CONNECTED', async () => {
    await expect(make().signMessage({ message: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
  it('disconnect clears the session, the stored hint and calls the wallet', async () => {
    const m = mockWallet();
    const store = memStore();
    const a = make(registryOf(m.wallet), undefined, store);
    await a.connect('phantom');
    expect(store.getItem('kruxa.solana.wallet')).toBe('phantom');
    await a.disconnect();
    expect(a.getSession()).toBeNull();
    expect(store.getItem('kruxa.solana.wallet')).toBeNull();
    expect(m.disconnect).toHaveBeenCalledOnce();
  });
  it('restore reconnects silently and never prompts when nothing is stored', async () => {
    const m = mockWallet();
    const store = memStore();
    expect(await make(registryOf(m.wallet), undefined, store).restore()).toBeNull();
    expect(m.connect).not.toHaveBeenCalled();
    store.setItem('kruxa.solana.wallet', 'phantom');
    const s = await make(registryOf(m.wallet), undefined, store).restore();
    expect(s?.address).toBe('PhantomBase58Addr');
    expect(m.connect).toHaveBeenCalledWith({ silent: true });
  });
});
