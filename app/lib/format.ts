// Pure formatting helpers. Amounts are base-unit integer strings (USDC has 6 decimals); nothing here touches floats for money.
import { fmtUsdc } from './config';

export { fmtUsdc };

/** Signed margin, always with an explicit sign so "+0" and "-0" never hide a boundary. */
export function fmtSignedUsdc(micro: string | bigint): string {
  const n = BigInt(micro);
  return `${n >= 0n ? '+' : ''}${fmtUsdc(n)}`;
}

export const fmtSigned = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

export function fmtPct(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return 'n/a';
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function shortHash(h: string | null | undefined, head = 8, tail = 6): string {
  if (!h) return 'n/a';
  return h.length <= head + tail + 3 ? h : `${h.slice(0, head)}...${h.slice(-tail)}`;
}

export function shortAccount(a: string): string {
  return a.length > 28 ? `${a.slice(0, 10)}...${a.slice(-8)}` : a;
}

/** 90061 -> "1d 1h 1m". Seconds in, no negative output. */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}

export function fmtDate(unix: number | null | undefined): string {
  if (unix === null || unix === undefined) return 'n/a';
  return new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** USDC micro -> a plain integer-dollars input value string, no float math. */
export function microFromDollars(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, '0'));
}

/** yoctoNEAR -> "1.234 NEAR" (3 decimals, truncated). */
export function fmtNear(yocto: string | bigint): string {
  const n = BigInt(yocto);
  const whole = n / 10n ** 24n;
  const frac = ((n % 10n ** 24n) / 10n ** 21n).toString().padStart(3, '0');
  return `${whole.toString()}.${frac} NEAR`;
}

export const titleCase = (s: string): string => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
