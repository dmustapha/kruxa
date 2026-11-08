// Studio presets. Each is a plain TrialParams; the rule engine decides whether it is legal. The hostile preset is the one
// committed in fixtures/hostile.json (it must be refused, that is its job).
import { STANDARD_FEES, USDC, type TrialParams } from './rules';

export interface Preset { id: string; label: string; blurb: string; expectRefusal: boolean; params: TrialParams }

const base: TrialParams = {
  symbol: '', name: '', total_supply_whole: 1_000_000_000,
  sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
  hard_cap: 1000n * USDC, soft_cap: 350n * USDC, min_buy: 20n * USDC, wallet_bps: 200, min_funders: 10,
  open_delay_secs: 0, commit_secs: 72 * 3600, tail_secs: 6 * 3600, stream_days: 90, fees: STANDARD_FEES,
};

export const PRESETS: Preset[] = [
  { id: 'standard', label: 'Standard trial', blurb: 'The defaults: $1,000 hard cap, 72 h to commit, 6 h Walk tail, 90 day stream.', expectRefusal: false, params: base },
  {
    id: 'quick', label: 'Small and quick', blurb: '$500 hard cap, the shortest legal commit window (24 h) and a 30 day stream.', expectRefusal: false,
    params: { ...base, hard_cap: 500n * USDC, soft_cap: 350n * USDC, commit_secs: 24 * 3600, stream_days: 30 },
  },
  {
    id: 'edge', label: 'Edge of legal', blurb: 'Creator allocation at its 20% ceiling. Legal, and nothing more generous passes.', expectRefusal: false,
    params: { ...base, sale_bps: 6000, lp_bps: 1500, creator_bps: 2000, backer_bps: 500 },
  },
  {
    id: 'hostile', label: 'Hostile (must be refused)', blurb: 'Creator plus backer share of 26% and a commit window one second short of 24 h.', expectRefusal: true,
    params: { ...base, symbol: 'HOSTILE', name: 'Hostile preset', sale_bps: 5400, lp_bps: 2000, creator_bps: 1900, backer_bps: 700, commit_secs: 86_399 },
  },
];

export const presetById = (id: string): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
