// NEAR adapter over @hot-labs/near-connect 0.12.0. The library is loaded lazily and only in the browser, and only when
// a wallet is listed or connected, so browsing and verifying never touch it. The connector is injectable for tests.
import { assertSigningAllowed, resolveNetworkGuard, type NetworkGuard } from './env';
import {
  WalletError, type SessionListener, type SignAndSendInput, type SignAndSendResult, type SignMessageInput, type SignedMessage,
  type WalletAdapter, type WalletOption, type WalletSession,
} from './types';

interface WalletManifestLike { id: string; name: string; icon?: string; website?: string }
interface NearWalletLike {
  manifest: WalletManifestLike;
  getAccounts(): Promise<Array<{ accountId: string }>>;
  signAndSendTransaction(p: { receiverId: string; signerId?: string; network?: string; actions: unknown[] }): Promise<unknown>;
  signMessage(p: { message: string; recipient: string; nonce: Uint8Array; signerId?: string; network?: string }): Promise<{ accountId: string; publicKey: string; signature: string }>;
}

/** The slice of NearConnector this adapter uses. */
export interface NearConnectorLike {
  whenManifestLoaded: Promise<void>;
  availableWallets: NearWalletLike[];
  connect(input?: { walletId?: string }): Promise<NearWalletLike>;
  disconnect(wallet?: NearWalletLike): Promise<void>;
  getConnectedWallet(): Promise<{ wallet: NearWalletLike; accounts: Array<{ accountId: string }> }>;
  on(event: 'wallet:signIn' | 'wallet:signOut', cb: (payload: never) => void): void;
}

export interface NearConnectAdapterOptions {
  guard?: NetworkGuard;
  createConnector?: (network: 'testnet' | 'mainnet') => Promise<NearConnectorLike>;
}

async function defaultCreateConnector(network: 'testnet' | 'mainnet'): Promise<NearConnectorLike> {
  if (typeof window === 'undefined') throw new WalletError('NETWORK_UNAVAILABLE', 'NEAR wallets are only available in the browser.');
  const { NearConnector } = await import('@hot-labs/near-connect');
  return new NearConnector({ network, features: { signAndSendTransaction: true }, footerBranding: null }) as unknown as NearConnectorLike;
}

const rejected = (e: unknown): boolean => /reject|cancel|denied|closed|declin/i.test(e instanceof Error ? e.message : String(e));

export class NearConnectAdapter implements WalletAdapter {
  readonly chain = 'near' as const;
  private readonly guard: NetworkGuard;
  private readonly makeConnector: (n: 'testnet' | 'mainnet') => Promise<NearConnectorLike>;
  private connectorPromise: Promise<NearConnectorLike> | null = null;
  private session: WalletSession | null = null;
  private wallet: NearWalletLike | null = null;
  private readonly listeners = new Set<SessionListener>();

  constructor(options: NearConnectAdapterOptions = {}) {
    this.guard = options.guard ?? resolveNetworkGuard();
    this.makeConnector = options.createConnector ?? defaultCreateConnector;
  }

  private connector(): Promise<NearConnectorLike> {
    this.connectorPromise ??= this.makeConnector(this.guard.env).then((c) => {
      c.on('wallet:signOut', () => this.setSession(null, null));
      return c;
    }).catch((e: unknown) => {
      this.connectorPromise = null;
      throw new WalletError('NETWORK_UNAVAILABLE', 'Could not load the NEAR wallet list. Check your connection and try again.', { cause: e });
    });
    return this.connectorPromise;
  }

  private setSession(session: WalletSession | null, wallet: NearWalletLike | null): void {
    this.session = session;
    this.wallet = wallet;
    this.listeners.forEach((l) => l(session));
  }

  private toSession(wallet: NearWalletLike, accountId: string): WalletSession {
    return { chain: 'near', walletId: wallet.manifest.id, walletName: wallet.manifest.name, address: accountId, env: this.guard.env };
  }

  async listWallets(): Promise<WalletOption[]> {
    const c = await this.connector();
    await c.whenManifestLoaded;
    return c.availableWallets.map((w) => ({
      id: w.manifest.id, chain: 'near', name: w.manifest.name, icon: w.manifest.icon, installed: true, installUrl: w.manifest.website,
    }));
  }

  /** Restores a previous session without any prompt. Resolves null when there is none. */
  async restore(): Promise<WalletSession | null> {
    try {
      const c = await this.connector();
      const { wallet, accounts } = await c.getConnectedWallet();
      const id = accounts[0]?.accountId;
      if (!id) return null;
      const s = this.toSession(wallet, id);
      this.setSession(s, wallet);
      return s;
    } catch {
      return null;
    }
  }

  async connect(walletId: string): Promise<WalletSession> {
    const c = await this.connector();
    await c.whenManifestLoaded;
    if (!c.availableWallets.some((w) => w.manifest.id === walletId)) throw new WalletError('WALLET_NOT_FOUND', `Wallet "${walletId}" is not available on ${this.guard.env}.`);
    try {
      const wallet = await c.connect({ walletId });
      const accountId = (await wallet.getAccounts())[0]?.accountId;
      if (!accountId) throw new WalletError('NOT_CONNECTED', 'The wallet returned no account.');
      const s = this.toSession(wallet, accountId);
      this.setSession(s, wallet);
      return s;
    } catch (e) {
      if (e instanceof WalletError) throw e;
      throw new WalletError(rejected(e) ? 'USER_REJECTED' : 'UNKNOWN', rejected(e) ? 'Connection was cancelled.' : 'The wallet could not connect.', { cause: e });
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this.wallet;
    this.setSession(null, null);
    if (!wallet || !this.connectorPromise) return;
    try { await (await this.connectorPromise).disconnect(wallet); } catch { /* local state is already cleared */ }
  }

  getSession(): WalletSession | null { return this.session; }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private requireWallet(): { wallet: NearWalletLike; session: WalletSession } {
    if (!this.wallet || !this.session) throw new WalletError('NOT_CONNECTED', 'Connect a NEAR wallet first.');
    return { wallet: this.wallet, session: this.session };
  }

  async signAndSendTransaction(input: SignAndSendInput): Promise<SignAndSendResult> {
    assertSigningAllowed(this.guard);
    const { wallet, session } = this.requireWallet();
    try {
      const raw = await wallet.signAndSendTransaction({ receiverId: input.receiverId, signerId: session.address, network: this.guard.env, actions: input.actions });
      const hash = (raw as { transaction?: { hash?: string } } | null)?.transaction?.hash;
      return { txHash: hash, raw };
    } catch (e) {
      throw new WalletError(rejected(e) ? 'USER_REJECTED' : 'UNKNOWN', rejected(e) ? 'You rejected the transaction.' : 'The wallet could not send the transaction.', { cause: e });
    }
  }

  async signMessage(input: SignMessageInput): Promise<SignedMessage> {
    assertSigningAllowed(this.guard);
    const { wallet, session } = this.requireWallet();
    if (!input.recipient || !input.nonce || input.nonce.length !== 32) throw new WalletError('UNSUPPORTED_ACTION', 'NEAR signMessage needs a recipient and a 32 byte nonce.');
    try {
      const r = await wallet.signMessage({ message: new TextDecoder().decode(input.message), recipient: input.recipient, nonce: input.nonce, signerId: session.address, network: this.guard.env });
      return { chain: 'near', address: r.accountId, publicKey: r.publicKey, signature: r.signature };
    } catch (e) {
      throw new WalletError(rejected(e) ? 'USER_REJECTED' : 'UNKNOWN', rejected(e) ? 'You rejected the signature request.' : 'The wallet could not sign.', { cause: e });
    }
  }
}
