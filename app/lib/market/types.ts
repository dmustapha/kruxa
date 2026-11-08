// Shapes of docs/interfaces/api.openapi.yaml (token page, candles, trades, holders, depth, creator desk, SSE) that this UI reads.
// Amounts are decimal strings of base units (USDC 6 decimals, launch tokens 6 decimals). Optional fields marked REQ are not in the
// frozen API yet: the UI reads them when present and shows "unknown" when absent (see docs/interfaces/REQ-ui-market.md).

export type DataSource = 'chain' | 'fixture';
export interface AsOf { block_height: number | null; block_time: number | null }

export interface FeeTerms {
  total_fee_bps: number;
  creator_bps: number;
  platform_bps: number;
  holders_bps: number;
  lp_bps: number;
  referral_bps: number;
  opening_fee_start_bps: number;
  opening_decay_minutes: number;
  fee_vest_bps: number;
  fee_vest_days: number;
}

export interface LaunchSummary {
  launch_id: string;
  symbol: string;
  creator: string;
  payout_recipient: string;
  status: string;
  stage: string;
  verdict?: 'PASS' | 'FAIL' | null;
  has_market?: boolean;
  last_price?: number | null;
  volume_24h?: number;
  source: DataSource;
}

export interface PoolInfo {
  open: boolean;
  paused: boolean;
  opened_at?: number | null;
  quote_reserve?: string | null;
  token_reserve?: string | null;
  fee_bps?: number | null;
  price?: number | null;
  tvl_quote?: number | null;
  /** REQ-UI-1: the launch token account (needed to sell). */
  token?: string | null;
  /** REQ-UI-1: the market contract account. */
  market?: string | null;
  /** REQ-UI-1: FeeTerms as logged by pool_opened. */
  fee_terms?: FeeTerms | null;
}

export type SafetyStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export interface SafetyIndicator { id: string; label: string; status: SafetyStatus; basis: 'event' | 'derived' | 'not_indexed'; detail?: string }

export interface TokenStats {
  last_price?: number | null;
  change_24h_pct?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  volume_24h?: number;
  trades_24h?: number;
  fees_total?: string;
}

export interface ExternalPool { venue: string; pool: string; url?: string | null }

export interface TokenPageData {
  launch: LaunchSummary;
  pool: PoolInfo;
  stats: TokenStats;
  creator?: { account?: string; payout_recipient?: string; creator_claimed?: string };
  safety: SafetyIndicator[];
  /** REQ-UI-1: external venues (the Meteora pool) when one exists. */
  external_pools?: ExternalPool[] | null;
  as_of: AsOf;
  source: DataSource;
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; n?: number; filled?: boolean; source?: DataSource }
export type Interval = '1m' | '5m' | '1h' | '1d';
export const INTERVALS: readonly Interval[] = ['1m', '5m', '1h', '1d'];
export const INTERVAL_SECONDS: Record<Interval, number> = { '1m': 60, '5m': 300, '1h': 3600, '1d': 86400 };
export interface CandleSeries { launch_id: string; interval: Interval; candles: Candle[]; as_of: AsOf; source: DataSource }

export interface FeeSlices { creator?: string; platform?: string; holders?: string; lp?: string; referral?: string }
export interface Trade {
  launch_id: string;
  side: 'buy' | 'sell';
  trader: string;
  amount_in: string;
  amount_out: string;
  price: number;
  quote_amount?: string;
  token_amount?: string;
  fee_total: string;
  fee_slices?: FeeSlices;
  block_height: number;
  receipt_id: string;
  time: number;
  source: DataSource;
}
export interface TradeList { items: Trade[]; next_cursor: string | null; as_of: AsOf; source: DataSource }

export interface Holder { holder: string; balance: string; share_bps: number; is_creator?: boolean; is_pool?: boolean }
export interface HolderList { basis: string; holder_count?: number; items: Holder[]; as_of: AsOf; source: DataSource }

export interface DepthRung { side: 'buy' | 'sell'; amount_in: string; amount_out: string; avg_price?: number; price_impact_bps: number }
export interface PoolDepth { pool: PoolInfo; ladder: DepthRung[]; as_of: AsOf; source: DataSource }

export interface CreatorEarnings { market_fees_creator_slice?: string; claimed?: string; claimable_estimate?: string; stream_drawn?: string }
export interface CreatorLaunch { launch: LaunchSummary; role: 'creator' | 'payout_recipient' | 'both'; earnings: CreatorEarnings }
export interface CreatorDesk { account: string; launches: CreatorLaunch[]; as_of: AsOf; source: DataSource }

/** Market contract `creator_status` view (chain read). */
export interface CreatorStatus { recipient: string; accrued: string; unlocked: string; paid: string; claimable: string; epochs?: number }

export type StreamEvent =
  | { kind: 'trade'; trade: Trade }
  | { kind: 'candle'; candle: Candle & { launch_id?: string } }
  | { kind: 'launch'; launch: LaunchSummary }
  | { kind: 'hello' };
