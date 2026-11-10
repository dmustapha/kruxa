// Local-only preferences (APP-SPEC 4.15). Everything lives in this browser's localStorage, every access is wrapped in try/catch, and the app
// renders correctly when storage is blocked. There is no account and nothing is sent anywhere. Watchlist and hidden tokens are local too.

export interface Settings {
  /** Default max slippage for trades, percent text (0.1 to 50). */
  slippagePct: string;
  /** Buy preset amounts in whole USDC. */
  buyPresets: number[];
  nearRpc: string;
  solanaRpc: string;
  timeDisplay: 'utc' | 'local';
  reducedMotion: boolean;
  showFixture: boolean;
}

export const DEFAULT_SETTINGS: Settings = { slippagePct: '1', buyPresets: [5, 25, 100], nearRpc: '', solanaRpc: '', timeDisplay: 'utc', reducedMotion: false, showFixture: true };

export const KEYS = { settings: 'kruxa.settings.v1', watchlist: 'kruxa.watchlist.v1', hidden: 'kruxa.hidden.v1' } as const;

export const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
export const write = (k: string, v: string | null): boolean => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; } };

/** Parses stored settings defensively: a bad or partial value falls back per field, never throws. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  let o: Partial<Record<keyof Settings, unknown>>;
  try { o = JSON.parse(raw) as typeof o; } catch { return DEFAULT_SETTINGS; }
  if (!o || typeof o !== 'object') return DEFAULT_SETTINGS;
  const slip = typeof o.slippagePct === 'string' && /^\d{1,2}(\.\d{1,2})?$/.test(o.slippagePct) && Number(o.slippagePct) >= 0.1 && Number(o.slippagePct) <= 50 ? o.slippagePct : DEFAULT_SETTINGS.slippagePct;
  const presets = Array.isArray(o.buyPresets) && o.buyPresets.length === 3 && o.buyPresets.every((n) => Number.isInteger(n) && n >= 1 && n <= 1_000_000) ? (o.buyPresets as number[]) : DEFAULT_SETTINGS.buyPresets;
  const url = (v: unknown): string => (typeof v === 'string' && /^https:\/\/[^\s]{3,200}$/.test(v) ? v : '');
  return {
    slippagePct: slip, buyPresets: presets, nearRpc: url(o.nearRpc), solanaRpc: url(o.solanaRpc),
    timeDisplay: o.timeDisplay === 'local' ? 'local' : 'utc', reducedMotion: o.reducedMotion === true, showFixture: o.showFixture !== false,
  };
}

export const loadSettings = (): Settings => parseSettings(read(KEYS.settings));
export const saveSettings = (s: Settings): boolean => write(KEYS.settings, JSON.stringify(s));

// ---- id lists: watchlist (launch ids you follow) and hidden tokens (launch ids you chose not to see) ----
export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw) as unknown; return Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === 'string' && /^[0-9]{1,20}$/.test(x)))] : []; } catch { return []; }
}

export function toggleId(list: string[], id: string): string[] { return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]; }

export function clearLocalData(): void { Object.values(KEYS).forEach((k) => write(k, null)); }
