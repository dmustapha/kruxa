'use client';
import { useMemo } from 'react';
import { useWallet } from '@/components/wallet';

export interface HolderKeys { near: string | null; solana: string | null; keys: string[] }

/** The holder keys the contract and the indexer use: `near:<account>` and `sol:<base58>`. Empty when nothing is connected. */
export function useHolderKeys(): HolderKeys {
  const { sessions } = useWallet();
  return useMemo(() => {
    const near = sessions.near ? `near:${sessions.near.address}` : null;
    const solana = sessions.solana ? `sol:${sessions.solana.address}` : null;
    return { near, solana, keys: [near, solana].filter((k): k is string => k !== null) };
  }, [sessions]);
}
