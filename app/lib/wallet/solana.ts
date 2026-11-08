// Solana adapter over the wallet-standard (Phantom, Solflare, Backpack). Only `standard:connect` and `solana:signMessage`
// are used: the Solana-only buyer signs Intents messages and never sends a Solana transaction through this app.
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { assertSigningAllowed, resolveNetworkGuard, type NetworkGuard } from './env';
import { intentsAccountIdFromPublicKey } from './intents';
import {
  WalletError, type SessionListener, type SignAndSendResult, type SignMessageInput, type SignedMessage, type WalletAdapter,
  type WalletOption, type WalletSession,
} from './types';

const CONNECT = 'standard:connect';
const DISCONNECT = 'standard:disconnect';
const SIGN_MESSAGE = 'solana:signMessage';

/** The three wallets Kruxa offers. `match` is compared to the wallet-standard name, case-insensitively. */
export const SOLANA_WALLETS = [
  { id: 'phantom', match: 'phantom', name: 'Phantom', installUrl: 'https://phantom.app' },
  { id: 'solflare', match: 'solflare', name: 'Solflare', installUrl: 'https://solflare.com' },
  { id: 'backpack', match: 'backpack', name: 'Backpack', installUrl: 'https://backpack.app' },
] as const;

type Registry = { get(): readonly Wallet[]; on(event: 'register' | 'unregister', cb: () => void): () => void };
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
type SignMessageFeature = { signMessage(...inputs: { account: WalletAccount; message: Uint8Array }[]): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> };
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SolanaAdapterOptions {
  guard?: NetworkGuard;
  registry?: Registry;
  /** Remembers the last wallet id so a reload can reconnect silently. Defaults to sessionStorage when present. */
  storage?: KeyValueStore | null;
}

const STORE_KEY = 'kruxa.solana.wallet';
const rejected = (e: unknown): boolean => /reject|cancel|denied|declin|closed/i.test(e instanceof Error ? e.message : String(e));

function defaultStorage(): KeyValueStore | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

export class SolanaWalletStandardAdapter implements WalletAdapter {
  readonly chain = 'solana' as const;
  private readonly guard: NetworkGuard;
  private readonly registry: Registry;
  private readonly storage: KeyValueStore | null;
  private session: WalletSession | null = null;
  private active: { wallet: Wallet; account: WalletAccount } | null = null;
  private readonly listeners = new Set<SessionListener>();

  constructor(options: SolanaAdapterOptions = {}) {
    this.guard = options.guard ?? resolveNetworkGuard();
    this.registry = options.registry ?? (getWallets() as unknown as Registry);
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
  }

  private find(id: string): Wallet | undefined {
    const spec = SOLANA_WALLETS.find((w) => w.id === id);
    if (!spec) return undefined;
    return this.registry.get().find((w) => w.name.toLowerCase().includes(spec.match) && SIGN_MESSAGE in w.features && CONNECT in w.features);
  }

  async listWallets(): Promise<WalletOption[]> {
    return SOLANA_WALLETS.map((spec) => {
      const w = this.find(spec.id);
      return { id: spec.id, chain: 'solana', name: spec.name, icon: w?.icon, installed: Boolean(w), installUrl: spec.installUrl };
    });
  }

  /** Called by the provider when wallets register after load, so the chooser can refresh. */
  onRegistryChange(cb: () => void): () => void {
    const offs = [this.registry.on('register', cb), this.registry.on('unregister', cb)];
    return () => offs.forEach((off) => off());
  }

  private setSession(session: WalletSession | null, active: SolanaWalletStandardAdapter['active']): void {
    this.session = session;
    this.active = active;
    this.listeners.forEach((l) => l(session));
  }

  private async open(id: string, silent: boolean): Promise<WalletSession> {
    const wallet = this.find(id);
    const spec = SOLANA_WALLETS.find((w) => w.id === id);
    if (!wallet || !spec) throw new WalletError('WALLET_NOT_FOUND', `${spec?.name ?? id} is not installed in this browser.`);
    try {
      const { accounts } = await (wallet.features[CONNECT] as ConnectFeature).connect(silent ? { silent: true } : undefined);
      const account = accounts[0];
      if (!account) throw new WalletError('NOT_CONNECTED', 'The wallet returned no account.');
      const s: WalletSession = {
        chain: 'solana', walletId: id, walletName: spec.name, address: account.address, env: this.guard.env,
        intentsAccountId: intentsAccountIdFromPublicKey(account.publicKey),
      };
      this.setSession(s, { wallet, account });
      try { this.storage?.setItem(STORE_KEY, id); } catch { /* storage is optional */ }
      return s;
    } catch (e) {
      if (e instanceof WalletError) throw e;
      throw new WalletError(rejected(e) ? 'USER_REJECTED' : 'UNKNOWN', rejected(e) ? 'Connection was cancelled.' : 'The wallet could not connect.', { cause: e });
    }
  }

  connect(walletId: string): Promise<WalletSession> { return this.open(walletId, false); }

  /** Silent reconnect to the wallet used earlier in this tab. Never shows a prompt; resolves null on any failure. */
  async restore(): Promise<WalletSession | null> {
    let id: string | null = null;
    try { id = this.storage?.getItem(STORE_KEY) ?? null; } catch { id = null; }
    if (!id) return null;
    return this.open(id, true).catch(() => null);
  }

  async disconnect(): Promise<void> {
    const active = this.active;
    this.setSession(null, null);
    try { this.storage?.removeItem(STORE_KEY); } catch { /* ignore */ }
    const feature = active?.wallet.features[DISCONNECT] as { disconnect(): Promise<void> } | undefined;
    try { await feature?.disconnect(); } catch { /* local state is already cleared */ }
  }

  getSession(): WalletSession | null { return this.session; }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  signAndSendTransaction(): Promise<SignAndSendResult> {
    return Promise.reject(new WalletError('UNSUPPORTED_ACTION', 'Solana wallets cannot send NEAR transactions. Connect a NEAR account.'));
  }

  async signMessage(input: SignMessageInput): Promise<SignedMessage> {
    assertSigningAllowed(this.guard);
    if (!this.active || !this.session) throw new WalletError('NOT_CONNECTED', 'Connect a Solana wallet first.');
    const { wallet, account } = this.active;
    try {
      const [out] = await (wallet.features[SIGN_MESSAGE] as SignMessageFeature).signMessage({ account, message: input.message });
      if (!out) throw new WalletError('UNKNOWN', 'The wallet returned no signature.');
      return { chain: 'solana', address: account.address, signature: out.signature, signedMessage: out.signedMessage };
    } catch (e) {
      if (e instanceof WalletError) throw e;
      throw new WalletError(rejected(e) ? 'USER_REJECTED' : 'UNKNOWN', rejected(e) ? 'You rejected the signature request.' : 'The wallet could not sign.', { cause: e });
    }
  }
}
