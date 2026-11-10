'use client';
// React hooks over lib/settings.ts (kept apart so server components can import the pure helpers).
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, KEYS, loadSettings, parseIds, parseSettings, read, saveSettings, toggleId, write, type Settings } from './settings';

export function useSettings(): [Settings, (patch: Partial<Settings>) => boolean, () => void] {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { setS(loadSettings()); }, []);
  const update = useCallback((patch: Partial<Settings>): boolean => {
    let ok = true;
    setS((prev) => { const stored = read(KEYS.settings); const next = { ...(stored ? parseSettings(stored) : prev), ...patch }; ok = saveSettings(next); return next; });
    return ok;
  }, []);
  const reset = useCallback(() => { write(KEYS.settings, null); setS(DEFAULT_SETTINGS); }, []);
  return [s, update, reset];
}

function useIdList(key: string): [string[], (id: string) => void, () => void] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(parseIds(read(key)));
    const on = (e: StorageEvent) => { if (e.key === key) setIds(parseIds(e.newValue)); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [key]);
  const toggle = useCallback((id: string) => setIds((prev) => { const next = toggleId(prev, id); write(key, JSON.stringify(next)); return next; }), [key]);
  const clear = useCallback(() => { write(key, null); setIds([]); }, [key]);
  return [ids, toggle, clear];
}

export const useWatchlist = () => useIdList(KEYS.watchlist);
/** Hidden tokens are a LOCAL preference of this browser. They are not a Kruxa moderation action and nothing is hidden for anyone else. */
export const useHiddenTokens = () => useIdList(KEYS.hidden);
