use kruxa_instant::{Derived, InstantParams};
use near_sdk::{near, AccountId};

/// Deployment profile. A typo cannot silently weaken the gate or the fee: `new` accepts exactly these names, and each
/// profile is tied to the kind of account it may live on.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    Mainnet,
    Testnet,
    /// One "day" lasts 10 s. Sandbox and labelled demo accounts only.
    Demo,
}

impl Profile {
    pub fn parse(s: &str) -> Option<Profile> {
        match s {
            "mainnet" => Some(Profile::Mainnet),
            "testnet" => Some(Profile::Testnet),
            "demo" => Some(Profile::Demo),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Profile::Mainnet => "mainnet",
            Profile::Testnet => "testnet",
            Profile::Demo => "demo",
        }
    }

    /// `mainnet` needs a `.near` account; `testnet` and `demo` need a `.testnet` or `.localnet` one, or the sandbox's
    /// `.test.near` (nobody can create an account under the real `test.near` without its key). The 10-second-day `demo`
    /// profile therefore cannot be initialised on `instant.kruxa.near`.
    pub fn fits_account(&self, account: &str) -> bool {
        let test_like = account.ends_with(".testnet") || account.ends_with(".localnet") || account.ends_with(".test.near");
        match self {
            Profile::Mainnet => account.ends_with(".near") && !account.ends_with(".testnet") && !account.ends_with(".localnet"),
            _ => test_like,
        }
    }
}

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
    pub profile: Profile,
    /// The guardian cannot freeze again before this time (the owner can). Set when a freeze starts.
    pub freeze_barrier: u64,
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
    /// When the leg now in flight was sent (0 = none). `reconcile` waits five minutes after it.
    pub inflight_since: u64,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_three_profile_names_parse() {
        for ok in ["mainnet", "testnet", "demo"] {
            assert!(Profile::parse(ok).is_some());
        }
        for bad in ["Mainnet", "prod", "main", "", "testnet ", "DEMO", "production"] {
            assert!(Profile::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn demo_and_testnet_cannot_live_on_a_mainnet_account() {
        for p in [Profile::Demo, Profile::Testnet] {
            assert!(!p.fits_account("instant.kruxa.near"));
            assert!(!p.fits_account("kruxa.near"));
            assert!(p.fits_account("instant.kruxa.testnet"));
            assert!(p.fits_account("instant.localnet"));
        }
        assert!(Profile::Mainnet.fits_account("instant.kruxa.near"));
        assert!(!Profile::Mainnet.fits_account("instant.kruxa.testnet"));
        assert!(!Profile::Mainnet.fits_account("instant.localnet"));
    }
}
