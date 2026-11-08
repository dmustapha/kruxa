use kruxa_logic::FeeTerms;
use kruxa_market::EpochAccrual;
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// Which authenticated issuer opened the pool. Derived from the handoff sender, never from the message.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Trial,
    Instant,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Trial => "trial",
            Mode::Instant => "instant",
        }
    }
}

/// Launch ids below this belong to core (trial), at or above it to the instant launcher.
pub const INSTANT_ID_BASE: u64 = 1_000_000_000;

/// Per-pool fee ledger (ARCHITECTURE 5.1 FeeLedger, M-A subset). Slices are in micro-USDC.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct FeeLedger {
    pub fee_total: u128,
    pub acc_creator: u128,
    pub acc_platform: u128,
    pub acc_lp: u128,
    pub paid_creator: u128,
    pub red_holders: u128,
    pub red_referral: u128,
    pub surcharge: u128,
    pub folded_unlocked: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Pool {
    pub launch_id: u64,
    pub mode: Mode,
    pub creator: Option<AccountId>,
    pub token: AccountId,
    pub payout_recipient: AccountId,
    pub total_supply: u128,
    pub charter_hash: String,
    /// Token authorities as reported by core at the handoff (None = revoked). Display only; the market never acts on them.
    pub mint_authority: Option<String>,
    pub freeze_authority: Option<String>,
    pub terms: FeeTerms,
    pub open: bool,
    pub q: u128,
    pub t: u128,
    pub q0: u128,
    pub t0: u128,
    pub opened_ns: u64,
    pub ledger: FeeLedger,
    pub epochs: Vec<EpochAccrual>,
}

/// `ft_on_transfer` message. Unknown fields are ignored; every op reads only what it needs.
#[near(serializers = [json])]
pub struct Msg {
    pub v: u8,
    pub op: String,
    pub launch_id: U64,
    pub min_out: Option<U128>,
    pub receiver: Option<AccountId>,
    pub token: Option<AccountId>,
    pub payout_recipient: Option<AccountId>,
    pub creator: Option<AccountId>,
    pub total_supply: Option<U128>,
    pub charter_hash: Option<String>,
    pub mint_authority: Option<String>,
    pub freeze_authority: Option<String>,
    pub terms: Option<FeeTerms>,
}
