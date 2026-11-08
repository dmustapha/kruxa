'use client';
import { useEffect, useState } from 'react';

/** True when the media query matches. Starts false (mobile layout) so the server and first client render agree. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}
export const useIsDesktop = (): boolean => useMedia('(min-width: 1024px)');
