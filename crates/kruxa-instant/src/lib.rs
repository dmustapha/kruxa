//! kruxa-instant: pure logic of the instant launcher (CHANGE-ORDER-7). No near-sdk, no I/O.
//! Supply split, creator-allocation vesting, parameter validation and the rule codes. Linked by `contracts/instant`.
//! Dependency direction: contract -> kruxa-instant -> kruxa-market / kruxa-logic -> kruxa-math.
#![forbid(unsafe_code)]

mod params;
mod vest;

pub use params::{
    total_supply_base,
    default_fees, derive, is_reserved_symbol, validate_instant, Derived, InstantParams, Limits, Violation, DEFAULT_ALLOC_BPS, DEFAULT_CLIFF_DAYS,
    DEFAULT_DELAY_SECS, DEFAULT_SEED_Q, DEFAULT_VEST_DAYS, MAX_ALLOC_BPS, MAX_CLIFF_DAYS, MAX_DELAY_SECS, MAX_VEST_DAYS, MIN_CLIFF_DAYS,
    MIN_SEED_Q, MIN_VEST_DAYS, MAX_SEED_Q, TOKEN_DECIMALS, TOTAL_SUPPLY_WHOLE,
};
pub use vest::{alloc_unlocked, claimable, Schedule};

/// Rule code strings added by the launcher (fee codes come from `kruxa_logic::RuleCode`).
pub mod code {
    pub const ALLOC: &str = "R_ALLOC";
    pub const VEST: &str = "R_VEST";
    pub const SEED_RANGE: &str = "R_SEED_RANGE";
    pub const DELAY: &str = "R_DELAY";
    pub const SYMBOL: &str = "R_SYMBOL";
    pub const SYMBOL_RESERVED: &str = "R_SYMBOL_RESERVED";
    pub const FEE_TERMS: &str = "R_FEE_TERMS";
    pub const MATH: &str = "R_MATH";
}
