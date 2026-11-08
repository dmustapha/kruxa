// A Solana-only buyer's first object is an Intents account named by the lowercase 64-hex of the Solana public key.
import { WalletError } from './types';

export function intentsAccountIdFromPublicKey(publicKey: ArrayLike<number>): string {
  if (publicKey.length !== 32) throw new WalletError('UNKNOWN', `Solana public key must be 32 bytes, got ${publicKey.length}`);
  return Array.from(publicKey, (b) => b.toString(16).padStart(2, '0')).join('');
}
