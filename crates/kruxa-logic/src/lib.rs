//! kruxa-logic: the deterministic core. Pure functions over integers and byte strings.
//! One-way dependency flow: kruxa-logic imports kruxa-math only. The contract, the CLI and the
//! tests import kruxa-logic; kruxa-logic never imports an I/O or chain crate.
#![forbid(unsafe_code)]

pub mod book;
pub mod controls;
pub mod genesis;
pub mod ledger;
pub mod rules;
pub mod settle;
pub mod verdict;

pub use book::{fold_book, BookEvent, FoldError, Folded};
pub use controls::{
    freeze_allowed, freeze_barrier, frozen_until, pause_at, timelock_effective_at, timelock_elapsed, Pause, CAP_TIMELOCK_NS, DAY_NS,
    FREEZE_MAX_NS, GLOBAL_CAP_USDC,
};
pub use ledger::{
    check_flow, check_pass_conservation, i2_position_count, i3_inputs_frozen, i4_status_monotone, i5_no_overpay, BookSums, Buckets,
    LedgerTotals, StatusClass,
};
pub use rules::{
    bond_required, check_payees, check_stream_init, validate_all, validate_params, Derived, FeeTerms, RuleCode, RuleViolation, Rules,
    TrialParams,
};
pub use settle::{allocate, launch_fee, phase_at, settle_position, walk_window_open, Allocation, Phase, PositionSettlement};
pub use verdict::{book_next, hex, inputs_hash, verdict, Outcome, VerdictInputs};

/// The one name constant (RULING R6). No other crate or account may hard-code the string.
pub const PROJECT_NAME: &str = "Kruxa";
pub const EVENT_STANDARD: &str = "kruxa";
pub const EVENT_VERSION: &str = "1.0.0";
/// Ticker ruling 2026-11-07: $KRUXA.
pub const TICKER: &str = "KRUXA";
/// Storage price: 1e-5 NEAR per byte = 1e19 yocto (S1-A patch 3.2; NOT 1e-4).
pub const STORAGE_BYTE_COST_YOCTO: u128 = 10_000_000_000_000_000_000;
