// Barrel for the wallet layer. Import from '@/lib/wallet/index' (a legacy file lib/wallet.ts shadows '@/lib/wallet').
export * from './types';
export * from './env';
export * from './gating';
export * from './payout';
export * from './intents';
export { NearConnectAdapter } from './near';
export type { NearConnectorLike, NearConnectAdapterOptions } from './near';
export { SolanaWalletStandardAdapter } from './solana';
export { SOLANA_WALLETS } from './solana';
export type { SolanaAdapterOptions } from './solana';
