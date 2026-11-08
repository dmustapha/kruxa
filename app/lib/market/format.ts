// Display helpers. Amounts stay bigint until the last step so u128 never loses precision.

/** Decimal string of base units to a human string with `decimals` places, trimmed. */
export function fmtUnits(raw: string | bigint | null | undefined, decimals = 6, maxFrac = 2): string {
  if (raw === null || raw === undefined || raw === '') return 'unknown';
  let n: bigint;
  try { n = BigInt(raw); } catch { return 'unknown'; }
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  let frac = (n % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  if (maxFrac === 0) frac = '';
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${w}.${frac}` : w;
}

export const fmtUsdcMicro = (raw: string | bigint | null | undefined, maxFrac = 2): string => {
  const s = fmtUnits(raw, 6, maxFrac);
  return s === 'unknown' ? s : `$${s}`;
};

/** Compact token amounts: 794.35B, 24.3M, 1,234. Input is base units with 6 decimals. */
export function fmtTokensCompact(raw: string | bigint | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return 'unknown';
  let n: bigint;
  try { n = BigInt(raw); } catch { return 'unknown'; }
  const whole = Number(n / 1_000_000n) + Number(n % 1_000_000n) / 1e6;
  return fmtCompact(whole);
}

export function fmtCompact(x: number): string {
  if (!Number.isFinite(x)) return 'unknown';
  const abs = Math.abs(x);
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) if (abs >= v) return `${trimZeros((x / v).toFixed(2))}${s}`;
  return trimZeros(x.toFixed(2));
}
const trimZeros = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** Price in whole USDC per whole token. Four significant digits below 1, no exponent notation. */
export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'unknown';
  if (p === 0) return '$0';
  const abs = Math.abs(p);
  if (abs >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (abs >= 1) return `$${p.toFixed(4)}`;
  const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(abs))));
  return `$${p.toFixed(digits)}`;
}

export const fmtUsd = (x: number | null | undefined, frac = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? 'unknown' : `$${x.toLocaleString('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

export function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'unknown';
  return `${x > 0 ? '+' : ''}${x.toFixed(2)}%`;
}

export const fmtBps = (bps: number): string => `${trimZeros((bps / 100).toFixed(2))}%`;

export function shortAccount(a: string, head = 10, tail = 6): string {
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function timeAgo(unixSec: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, nowSec - unixSec);
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Decimal input like "12.5" to base units. Returns null when malformed or too precise. */
export function parseUnits(input: string, decimals = 6): bigint | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [w = '0', f = ''] = t.split('.');
  if (f.length > decimals) return null;
  return BigInt(w === '' ? '0' : w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}
