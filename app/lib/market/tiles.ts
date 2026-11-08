// Safety tiles for the header (APP-SPEC 5.4). Each tile states a fact, its status and its basis. A fact the data does not carry is
// "unknown", never a pass. Nothing here says a token is "safe" or an LP is "locked": the pool has no LP withdrawal method, and that is
// all the NEAR contract's ABI says (INVARIANTS MUST NOT CLAIM).
import { fmtBps, fmtUnits } from './format';
import type { Holder, LaunchDetail, SafetyIndicator, StreamMeter, TokenPageData } from './types';

export type TileStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'info';
export interface SafetyTile { id: string; label: string; value: string; status: TileStatus; basis: string; detail?: string }

const indicator = (rows: SafetyIndicator[], id: string): SafetyIndicator | undefined => rows.find((r) => r.id === id);

function authorityTile(rows: SafetyIndicator[], id: string, label: string): SafetyTile {
  const i = indicator(rows, id);
  if (!i || i.basis === 'not_indexed' || i.status === 'unknown') return { id, label, value: 'unknown', status: 'unknown', basis: 'not logged', detail: i?.detail ?? 'The indexer did not log this authority.' };
  return { id, label, value: i.status === 'pass' ? 'None (null)' : 'Set', status: i.status === 'pass' ? 'pass' : i.status, basis: i.basis, detail: i.detail };
}

/** Share of the supply held by the ten largest non-pool holders, in bps, from the indexed holders list. Null when it cannot be known. */
export function top10ShareBps(items: Holder[] | undefined): number | null {
  if (!items || items.length === 0) return null;
  return items.filter((h) => !h.is_pool).slice(0, 10).reduce((s, h) => s + h.share_bps, 0);
}

export function safetyTiles(page: TokenPageData, holders: Holder[] | undefined, stream: StreamMeter | null | undefined, detail: LaunchDetail | undefined): SafetyTile[] {
  const rows = page.safety;
  const top = top10ShareBps(holders);
  const lp = indicator(rows, 'lp_in_pool');
  const v = detail?.verdict_inputs;
  let verdictTile: SafetyTile = { id: 'verdict_inputs', label: 'Verdict inputs', value: 'unknown', status: 'unknown', basis: 'not loaded' };
  if (v?.soft_cap && v.min_funders !== undefined && v.min_funders !== null) {
    const pass = BigInt(v.total_active) >= BigInt(v.soft_cap) && v.funders >= v.min_funders;
    verdictTile = {
      id: 'verdict_inputs', label: 'Verdict inputs', status: pass ? 'pass' : 'fail', basis: 'event',
      value: `$${fmtUnits(v.total_active, 6, 0)} of $${fmtUnits(v.soft_cap, 6, 0)} soft cap, ${v.funders} of ${v.min_funders} backers`,
      detail: 'Recompute it in the Verify tab.',
    };
  }
  return [
    authorityTile(rows, 'mint_authority_null', 'Mint authority'),
    authorityTile(rows, 'freeze_authority_null', 'Freeze authority'),
    top === null
      ? { id: 'top10', label: 'Top 10 holders', value: 'unknown', status: 'unknown', basis: 'not loaded' }
      : { id: 'top10', label: 'Top 10 holders', value: fmtBps(top), status: 'info', basis: 'indexed estimate', detail: 'Excludes the liquidity pool. Trial claims plus net market flow, not a token-contract read.' },
    lp && lp.status === 'pass' && lp.basis !== 'not_indexed'
      ? { id: 'lp', label: 'Liquidity', value: 'Seeded; no LP withdrawal method', status: 'pass', basis: lp.basis, detail: 'A property of the unreviewed NEAR market contract, not an audit.' }
      : { id: 'lp', label: 'Liquidity', value: 'unknown', status: 'unknown', basis: 'not logged' },
    stream
      ? { id: 'stream', label: 'Creator stream cap', value: `$${fmtUnits(stream.drawn, 6, 2)} of $${fmtUnits(stream.total, 6, 2)} drawn`, status: 'info', basis: 'indexer estimate', detail: 'The contract refuses a withdraw-all (STREAM_CAP).' }
      : { id: 'stream', label: 'Creator stream cap', value: 'unknown', status: 'unknown', basis: 'not loaded' },
    verdictTile,
  ];
}

export function tileSummary(tiles: SafetyTile[]): { pass: number; unknown: number; fail: number; total: number } {
  return {
    pass: tiles.filter((t) => t.status === 'pass').length, unknown: tiles.filter((t) => t.status === 'unknown').length,
    fail: tiles.filter((t) => t.status === 'fail' || t.status === 'warn').length, total: tiles.length,
  };
}
