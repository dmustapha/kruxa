//! kruxa-market: pure market math. No near-sdk, no I/O. Linked by `contracts/market` and `tools/market-sim`.
//! Constant-product AMM with a five-slice fee router, an opening-fee decay and 24 h creator-fee epochs.
#![forbid(unsafe_code)]

pub mod amm;
pub mod fees;
pub mod trading;
pub mod vest;

pub use amm::{quote_buy, quote_sell, Reserves, Swap};
pub use fees::{base_rate_ppm, route_fee, validate_market_terms, FeeSlices, Routing};
pub use trading::{fee_elapsed_ns, trade_from_in_range, trading_open, MAX_TRADE_DELAY_NS, R_NOT_YET_TRADING, R_TRADE_FROM};
pub use vest::{creator_unlocked, epoch_of, fold_vested, record_creator_fee, EpochAccrual, EPOCH_NS};

/// Fee denominator for rates in parts per million (finer than bps so the opening decay is smooth).
pub const FEE_DENOM_PPM: u128 = 1_000_000;
/// $1 in micro-USDC: minimum quote leg of a swap.
pub const MIN_TRADE_QUOTE: u128 = 1_000_000;
/// $1 in micro-USDC: minimum creator or platform claim.
pub const MIN_CLAIM_QUOTE: u128 = 1_000_000;
/// 1e18 micro-USDC: reserve bound so `q * t` stays far below U256.
pub const RESERVE_BOUND_Q: u128 = 1_000_000_000_000_000_000;
/// Interim DN-17 caps in micro-USDC.
pub const MAX_POOL_RESERVE_Q: u128 = 5_000_000_000;
pub const MAX_GLOBAL_RESERVE_Q: u128 = 15_000_000_000;
/// Instant-launch pools together, inside the global cap (CO-7 D-4).
pub const MAX_INSTANT_RESERVE_Q: u128 = 5_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketError {
    /// `min_out` missing (zero) or not met.
    MinOut,
    /// Quote leg below `MIN_TRADE_QUOTE`.
    MinTrade,
    /// Overflow, divide by zero, empty pool or a reserve above the bound.
    Math,
    /// Fee terms break a rule.
    FeeTerms,
}

impl MarketError {
    /// Stable rule code string, matched by tests and the indexer.
    pub fn code(self) -> &'static str {
        match self {
            MarketError::MinOut => "R_MIN_OUT",
            MarketError::MinTrade => "R_MIN_TRADE",
            MarketError::Math => "R_MATH",
            MarketError::FeeTerms => "R_FEE_TERMS",
        }
    }
}

impl From<kruxa_math::MathError> for MarketError {
    fn from(_: kruxa_math::MathError) -> Self {
        MarketError::Math
    }
}
