// Resolves the facts the trade and fee panels need from the API first and a chain read second. Nothing is guessed:
// a missing fact stays null and the UI says "unknown".
import { MARKET_CONFIG } from './config';
import type { ChainPool } from './chain';
import type { FeeTerms, TokenPageData } from './types';

export interface MarketFacts {
  market: string;
  token: string | null;
  terms: FeeTerms | null;
  openedAtSec: number | null;
  /** Where the terms and token came from, for the badge text. */
  basis: 'api' | 'chain' | 'none';
}

export function resolveFacts(page: TokenPageData, chain: ChainPool | null): MarketFacts {
  const p = page.pool;
  const market = p.market ?? MARKET_CONFIG.marketAccount;
  if (p.fee_terms && p.token) return { market, token: p.token, terms: p.fee_terms, openedAtSec: p.opened_at ?? null, basis: 'api' };
  if (chain && chain.state === 'Open') {
    const ns = Number(chain.opened_ns);
    return {
      market,
      token: p.token ?? chain.token,
      terms: p.fee_terms ?? chain.terms,
      openedAtSec: p.opened_at ?? (Number.isFinite(ns) ? Math.floor(ns / 1e9) : null),
      basis: 'chain',
    };
  }
  return { market, token: p.token ?? null, terms: p.fee_terms ?? null, openedAtSec: p.opened_at ?? null, basis: p.fee_terms || p.token ? 'api' : 'none' };
}

/** The five slices as shares of the base fee, straight from the terms. */
export function sliceRows(t: FeeTerms): { id: 'creator' | 'platform' | 'holders' | 'lp' | 'referral'; label: string; bps: number; redirected: boolean }[] {
  return [
    { id: 'creator', label: 'Creator', bps: t.creator_bps, redirected: false },
    { id: 'platform', label: 'Platform', bps: t.platform_bps, redirected: false },
    { id: 'holders', label: 'Holders', bps: t.holders_bps, redirected: true },
    { id: 'lp', label: 'Liquidity', bps: t.lp_bps, redirected: false },
    { id: 'referral', label: 'Referral', bps: t.referral_bps, redirected: true },
  ];
}
