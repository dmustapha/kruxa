use kruxa_instant::{Derived, InstantParams};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseLevel {
    None,
    Paused,
    Frozen,
}

impl From<PauseLevel> for kruxa_logic::Pause {
    fn from(p: PauseLevel) -> Self {
        match p {
            PauseLevel::None => Self::None,
            PauseLevel::Paused => Self::Paused,
            PauseLevel::Frozen => Self::Frozen,
        }
    }
}

impl From<kruxa_logic::Pause> for PauseLevel {
    fn from(p: kruxa_logic::Pause) -> Self {
        match p {
            kruxa_logic::Pause::None => Self::None,
            kruxa_logic::Pause::Paused => Self::Paused,
            kruxa_logic::Pause::Frozen => Self::Frozen,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Creating,
    TokenReady,
    Seeded,
    Handoff,
    Open,
    CreationFailed,
    Abandoned,
    Aborted,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapKind {
    Aggregate,
    PerLaunch,
}

impl CapKind {
    pub fn name(&self) -> &'static str {
        match self {
            CapKind::Aggregate => "aggregate",
            CapKind::PerLaunch => "per_launch",
        }
    }
}

impl PauseLevel {
    pub fn name(&self) -> &'static str {
        match self {
            PauseLevel::None => "None",
            PauseLevel::Paused => "Paused",
            PauseLevel::Frozen => "Frozen",
        }
    }
}

impl Status {
    pub fn name(&self) -> &'static str {
        match self {
            Status::Creating => "Creating",
            Status::TokenReady => "TokenReady",
            Status::Seeded => "Seeded",
            Status::Handoff => "Handoff",
            Status::Open => "Open",
            Status::CreationFailed => "CreationFailed",
            Status::Abandoned => "Abandoned",
            Status::Aborted => "Aborted",
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leg {
    Seed,
    Token,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub treasury: AccountId,
    pub usdc: AccountId,
    pub factory: AccountId,
    pub market: Option<AccountId>,
    pub market_locked: bool,
    pub profile: String,
    /// While true NOBODY can `create_instant`, the owner included, until the one-way `open_beta`.
    pub creator_gate: bool,
    pub pause: PauseLevel,
    pub frozen_until: u64,
    pub launch_fee: u128,
    pub factory_deposit: u128,
    pub seed_min: u128,
    pub seed_max: u128,
    pub agg_cap: u128,
    pub pending_seed_max: Option<(u128, u64)>,
    pub pending_agg_cap: Option<(u128, u64)>,
    /// One "day" in ns: 86 400 s, or 10 s on the demo profile.
    pub unit_ns: u64,
}

/// The immutable inputs, hashed at creation. `charter_hash = sha256(borsh(Charter))`.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Charter {
    pub launch_id: u64,
    pub launcher: AccountId,
    pub creator: AccountId,
    pub payout_recipient: AccountId,
    pub created_at: u64,
    pub unit_ns: u64,
    pub params: InstantParams,
    pub derived: Derived,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Instant {
    pub launch_id: u64,
    pub creator: AccountId,
    pub payout_recipient: AccountId,
    pub params: InstantParams,
    pub derived: Derived,
    pub charter_hash: [u8; 32],
    pub token: AccountId,
    pub status: Status,
    pub created_at: u64,
    pub seeded_at: u64,
    pub opened_at: u64,
    /// The creator's whole seed, launch fee included.
    pub seed_total: u128,
    pub seed_due: u128,
    pub seed_inflight: u128,
    pub seed_sent: u128,
    /// The launch fee, held until the market consumed the seed.
    pub fee_held: u128,
    pub tokens_sent: u128,
    pub tokens_inflight: u128,
    /// Allocation paid out, in flight, or moved to an owed balance.
    pub claimed: u128,
    pub deposit_paid: u128,
    pub deposit_refundable: u128,
    /// Registration of the market on the token and the market's storage top-up were sent.
    pub market_prepared: bool,
}

impl Instant {
    pub fn tokens_unsent(&self) -> u128 {
        self.derived.n_pool.saturating_sub(self.tokens_sent + self.tokens_inflight)
    }
}
