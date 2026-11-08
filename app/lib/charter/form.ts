// Studio form <-> TrialParams. All inputs are strings in the form; parsing is explicit so a typo is a field error, not a crash.
import { microFromDollars } from '../format';
import type { Preset } from './presets';
import { STANDARD_FEES, USDC, type TrialParams } from './rules';

export interface FormState {
  symbol: string; name: string; hardCap: string; softCap: string; minBuy: string; minFunders: string; walletBps: string;
  commitHours: string; tailHours: string; streamDays: string; saleBps: string; lpBps: string; creatorBps: string; backerBps: string; supply: string;
}

const dollars = (m: bigint): string => { const w = m / USDC; const f = (m % USDC).toString().padStart(6, '0').replace(/0+$/, ''); return f ? `${w}.${f}` : `${w}`; };
const hours = (secs: number): string => String(Number((secs / 3600).toFixed(4)));

export function formFromPreset(p: Preset, keep?: Pick<FormState, 'symbol' | 'name'>): FormState {
  const t = p.params;
  return {
    symbol: keep?.symbol || t.symbol, name: keep?.name || t.name, hardCap: dollars(t.hard_cap), softCap: dollars(t.soft_cap), minBuy: dollars(t.min_buy),
    minFunders: String(t.min_funders), walletBps: String(t.wallet_bps), commitHours: hours(t.commit_secs), tailHours: hours(t.tail_secs), streamDays: String(t.stream_days),
    saleBps: String(t.sale_bps), lpBps: String(t.lp_bps), creatorBps: String(t.creator_bps), backerBps: String(t.backer_bps), supply: String(t.total_supply_whole),
  };
}

export type FieldErrors = Partial<Record<keyof FormState, string>>;

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const dec = (s: string): number | null => (/^\d+(\.\d{1,4})?$/.test(s.trim()) ? Number(s.trim()) : null);

/** Returns the params, or the per-field parse errors. Rule violations are not parse errors: they come from validateAll. */
export function paramsFromForm(f: FormState): { ok: true; params: TrialParams } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const money = (k: 'hardCap' | 'softCap' | 'minBuy'): bigint => { const m = microFromDollars(f[k]); if (m === null) errors[k] = 'Enter dollars, up to 6 decimals.'; return m ?? 0n; };
  const whole = (k: keyof FormState): number => { const n = int(f[k]); if (n === null) errors[k] = 'Enter a whole number.'; return n ?? 0; };
  const hrs = (k: 'commitHours' | 'tailHours'): number => { const n = dec(f[k]); if (n === null) errors[k] = 'Enter hours, up to 4 decimals.'; return Math.round((n ?? 0) * 3600); };
  const params: TrialParams = {
    symbol: f.symbol.trim(), name: f.name.trim(), total_supply_whole: whole('supply'),
    sale_bps: whole('saleBps'), lp_bps: whole('lpBps'), creator_bps: whole('creatorBps'), backer_bps: whole('backerBps'),
    hard_cap: money('hardCap'), soft_cap: money('softCap'), min_buy: money('minBuy'), wallet_bps: whole('walletBps'), min_funders: whole('minFunders'),
    open_delay_secs: 0, commit_secs: hrs('commitHours'), tail_secs: hrs('tailHours'), stream_days: whole('streamDays'), fees: STANDARD_FEES,
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, params };
}

/** Fee preview at the committed standard terms: each slice as a share of trade VOLUME, in percent with 2 decimals. Not an income claim. */
export function feePreview(p: { fees: TrialParams['fees'] }): { label: string; pct: string }[] {
  const f = p.fees;
  const of = (slice: number): string => `${((f.total_fee_bps * slice) / 10_000 / 100).toFixed(2)}%`;
  return [
    { label: 'Total fee on each trade', pct: `${(f.total_fee_bps / 100).toFixed(2)}%` },
    { label: 'Creator slice of volume', pct: of(f.creator_bps) }, { label: 'Platform slice', pct: of(f.platform_bps) },
    { label: 'Holders slice', pct: of(f.holders_bps) }, { label: 'Locked LP slice', pct: of(f.lp_bps) }, { label: 'Referral slice', pct: of(f.referral_bps) },
  ];
}
