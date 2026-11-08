'use client';
// One state machine for every wallet action: idle, waiting for the wallet, done (with the tx hash when the wallet reports one), failed.
import { useCallback, useState } from 'react';
import { WalletError, type SignAndSendResult } from './wallet/index';

export type TxState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; txHash?: string; note?: string }
  | { status: 'failed'; message: string; code?: string };

export function describeError(e: unknown): { message: string; code?: string } {
  if (e instanceof WalletError) return { message: e.message, code: e.code };
  const text = e instanceof Error ? e.message : String(e);
  const rule = text.match(/\b(R_[A-Z0-9_]+|STREAM_CAP)\b/);
  return { message: text.split('\n')[0] ?? 'The action failed.', code: rule?.[1] };
}

export function useTx() {
  const [state, setState] = useState<TxState>({ status: 'idle' });
  const run = useCallback(async (fn: () => Promise<SignAndSendResult | { note: string } | void>) => {
    setState({ status: 'pending' });
    try {
      const out = await fn();
      const r = (out ?? {}) as { txHash?: string; note?: string };
      setState({ status: 'done', txHash: r.txHash, note: r.note });
    } catch (e) {
      setState({ status: 'failed', ...describeError(e) });
    }
  }, []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, run, reset };
}
