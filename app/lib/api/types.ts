// Hand-written mirror of docs/interfaces/api.openapi.yaml (indexer read API 1.0.0). Amounts are base-unit decimal strings.
export type Source = 'chain' | 'fixture';
export type Stage = 'new' | 'open' | 'closing' | 'passed' | 'failed';
export type LaunchStatus = 'creating' | 'open' | 'passed' | 'failed' | 'creation_failed' | 'dissolved' | 'launching' | 'trading';
/** OpenAPI 1.2.0 (pending): how a launch started. Missing means trial. */
export type LaunchMode = 'trial' | 'instant';

export interface AsOf { block_height: number | null; block_time: number | null }

export interface Health {
  status: 'ok' | 'stale' | 'fixture';
  network: string;
  source: Source;
  data_source?: string;
  as_of: AsOf;
  head_height: number | null;
  lag_blocks: number | null;
  max_lag_blocks: number;
  event_count: number;
  launch_count?: number;
  trade_count?: number;
  state_hash: string;
  last_error?: string | null;
  uptime_s: number;
}

export interface LaunchSummary {
  launch_id: string;
  symbol: string;
  /** IR-A1: not in the OpenAPI 1.0.0 yet. Shown when present, otherwise the symbol stands alone. */
  name?: string | null;
  /** IR-A10: a computed phase string, when the indexer provides one. */
  phase?: string | null;
  /** OpenAPI 1.2.0 (pending). A missing value is read as `trial`. */
  mode?: LaunchMode | null;
  creator: string;
  payout_recipient: string;
  status: LaunchStatus;
  stage: Stage;
  created_at?: number | null;
  opens_at?: number | null;
  commit_end?: number | null;
  walk_end?: number | null;
  total_active: string;
  funders: number;
  soft_cap?: string | null;
  min_funders?: number | null;
  progress_bps?: number | null;
  verdict?: 'PASS' | 'FAIL' | null;
  has_market?: boolean;
  last_price?: number | null;
  volume_24h?: number;
  last_block?: number;
  source: Source;
}

export interface LaunchList { items: LaunchSummary[]; next_cursor: string | null; total?: number; as_of: AsOf; source: Source }

export interface VerdictInputsView {
  total_active: string;
  funders: number;
  soft_cap?: string | null;
  min_funders?: number | null;
  margin_to_soft_cap?: string | null;
  margin_funders?: number | null;
  book_hash_folded: string;
  inputs_hash?: string | null;
}

export interface Allocation { accepted?: string; launch_fee?: string; lp_quote?: string; stream?: string; excess_pool?: string }

export interface EventRef { event: string; block_height: number; receipt_id: string; log_index?: number; time?: number; source: Source }

/** IR-A4: genesis progress. Every field is optional; a missing field renders as unknown. */
export interface GenesisView {
  network?: string; path?: 'F0' | 'F1'; stage?: string; spec_hash?: string | null; mint?: string | null;
  tx_create?: string | null; tx_authority?: string | null; distributor?: string | null; root?: string | null; verified_checks?: string[]; updated_at?: number | null;
}

/** Allocation vesting of an instant launch (CHANGE-ORDER-7 2.12). Optional: the launcher's `get_vesting` view is the authority. */
export interface AllocView { total?: string; unlocked?: string; claimed?: string; claimable?: string; cliff_end?: number | null; vest_end?: number | null; alloc_bps?: number; cliff_days?: number; vest_days?: number; seed_q?: string }

export interface LaunchDetail extends LaunchSummary {
  alloc?: AllocView | null;
  genesis?: GenesisView | null;
  charter_hash: string;
  verdict_inputs: VerdictInputsView;
  verdict_reasons?: string[];
  allocation?: Allocation | null;
  walked_total?: string;
  contributed_total?: string;
  timeline?: EventRef[];
}

export interface StreamMeter {
  recipient?: string;
  total: string;
  drawn: string;
  unlocked: string | null;
  drawable_estimate: string | null;
  starts_at: number;
  ends_at: number | null;
  progress_bps?: number | null;
}

export interface CreatorLaunch {
  launch: LaunchSummary;
  role: 'creator' | 'payout_recipient' | 'both';
  stream?: StreamMeter | null;
  earnings: { market_fees_creator_slice?: string; claimed?: string; claimable_estimate?: string; stream_drawn?: string };
}

export interface CreatorDesk {
  account: string;
  launches: CreatorLaunch[];
  totals: { stream_drawn?: string; market_fees_creator_slice?: string; claimed?: string };
  claims: { launch_id: string; kind: 'stream_draw' | 'creator_claimed'; amount: string; block_height: number; receipt_id: string; time: number; source: Source }[];
  as_of: AsOf;
  source: Source;
}

export type PositionStatus = 'active' | 'walked' | 'awaiting_settle' | 'refundable' | 'claimable' | 'claimed' | 'market_only';

export interface PortfolioPosition {
  launch: LaunchSummary;
  contributed: string;
  walked: string;
  active?: string;
  tokens_claimed?: string;
  status: PositionStatus;
  market_balance?: string;
  market_value_quote?: number | null;
}

export interface FundsInMotion { launch_id?: string; kind?: string; amount?: string; ok?: boolean; receipt_id?: string }

export interface Portfolio { account: string; positions: PortfolioPosition[]; funds_in_motion: FundsInMotion[]; as_of: AsOf; source: Source }

export interface VerifyData {
  launch_id: string;
  charter_hash: string;
  inputs_hash?: string | null;
  book_hash_folded: string;
  book_hash_stored?: string | null;
  fold_ok: boolean | null;
  fold_note?: string;
  ledger_consistent: boolean;
  book_events?: number;
  verdict?: 'PASS' | 'FAIL' | null;
  event_count?: number;
  events: EventRef[];
  recompute?: string;
  as_of: AsOf;
  source: Source;
}

export interface ApiErrorBody { error: { code: string; message: string } }
