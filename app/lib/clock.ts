'use client';
// Time for countdowns. A fixture dataset has its own clock (the as_of block time); counting down against the wall clock would
// show nonsense, so fixture data freezes at as_of and says so. Chain data ticks once a second.
import { useEffect, useState } from 'react';
import type { AsOf, Source } from './api/types';

export function referenceNow(source: Source | undefined, asOf: AsOf | undefined, wall: number = Math.floor(Date.now() / 1000)): number {
  if (source === 'fixture' && asOf?.block_time) return asOf.block_time;
  return wall;
}

export function useNow(source: Source | undefined, asOf: AsOf | undefined): number {
  const [wall, setWall] = useState(() => Math.floor(Date.now() / 1000));
  const frozen = source === 'fixture' && !!asOf?.block_time;
  useEffect(() => {
    if (frozen) return;
    const t = setInterval(() => setWall(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [frozen]);
  return referenceNow(source, asOf, wall);
}
