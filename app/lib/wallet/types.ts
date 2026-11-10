// WalletAdapter contract (ARCHITECTURE 5.12). Other workstreams import this through the barrel `lib/wallet/index.ts` only.
// A session is always chain-labelled. Nothing here connects on import or on render: connect happens only inside an action.

export type Chain = 'near' | 'solana';

/** App environment. `testnet` means NEAR testnet and Solana devnet. `mainnet` signing is additionally locked by the confirmation token (see env.ts). */
export type KruxaEnv = 'testnet' | 'mainnet';

/** Actions that need a signature. Browsing and verifying are not actions and never ask for a wallet. */
export type WalletAction = 'create' | 'commit' | 'walk' | 'claim' | 'trade';

export interface WalletOption {
  /** Stable id inside the chain's registry (near-connect manifest id, or a lowercase wallet-standard name). */
  id: string;
  chain: Chain;
  name: string;
  icon?: string;
  /** Solana only: false when the wallet is not detected in this browser (the UI shows an install hint). */
  installed: boolean;
  /** Where to get the wallet when not installed. */
  installUrl?: string;
}

export interface WalletSession {
  chain: Chain;
  walletId: string;
  walletName: string;
  /** NEAR: the account id (alice.testnet). Solana: the base58 public key. */
  address: string;
  env: KruxaEnv;
  /** Solana only: the Intents account id, the lowercase 64-hex of the public key (no registration step). */
  intentsAccountId?: string;
}

/** One NEAR function call, in the string-only form that near-connect accepts (no bigint, JSON safe). */
export interface NearFunctionCallAction {
  type: 'FunctionCall';
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
}

export interface SignAndSendInput {
  receiverId: string;
  actions: NearFunctionCallAction[];
}

export interface SignAndSendResult {
  /** Transaction hash when the wallet reports one. */
  txHash?: string;
  /** Raw wallet outcome, untouched, for callers that need it. */
  raw: unknown;
}

export interface SignMessageInput {
  message: Uint8Array;
  /** NEAR (NEP-413) only. */
  recipient?: string;
  /** NEAR (NEP-413) only, 32 bytes. */
  nonce?: Uint8Array;
}

export type SignedMessage =
  | { chain: 'solana'; address: string; signature: Uint8Array; signedMessage: Uint8Array }
  | { chain: 'near'; address: string; publicKey: string; signature: string };

export type WalletErrorCode =
  | 'NOT_CONNECTED'
  | 'UNSUPPORTED_ACTION'
  | 'WALLET_NOT_FOUND'
  | 'USER_REJECTED'
  | 'MAINNET_LOCKED'
  | 'NETWORK_UNAVAILABLE'
  | 'UNKNOWN';

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WalletError';
    this.code = code;
  }
}

export type SessionListener = (session: WalletSession | null) => void;

export interface WalletAdapter {
  readonly chain: Chain;
  /** Wallets this adapter can offer right now. May load a registry or manifest. Never prompts. */
  listWallets(): Promise<WalletOption[]>;
  /** Opens the chosen wallet's approval. Call it only from an action. */
  connect(walletId: string): Promise<WalletSession>;
  disconnect(): Promise<void>;
  /** Current session, or null. Synchronous and side-effect free. */
  getSession(): WalletSession | null;
  /** Notified on connect, disconnect and external account changes. Returns an unsubscribe function. */
  subscribe(listener: SessionListener): () => void;
  /** NEAR only. Solana adapters reject with UNSUPPORTED_ACTION. Refuses on locked mainnet. */
  signAndSendTransaction(input: SignAndSendInput): Promise<SignAndSendResult>;
  /** Solana: raw wallet-standard `solana:signMessage`. NEAR: NEP-413. Refuses on locked mainnet. */
  signMessage(input: SignMessageInput): Promise<SignedMessage>;
}
