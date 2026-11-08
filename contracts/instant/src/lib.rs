//! kruxa-instant-contract: the instant launcher (CHANGE-ORDER-7). Creates a fixed-supply factory token, takes the creator's
//! USDC seed, hands both legs to the market, and vests the creator allocation. Core is not involved.
//! Dependency direction: contract -> kruxa-instant -> kruxa-market / kruxa-logic -> kruxa-math.
#![forbid(unsafe_code)]
#![allow(clippy::too_many_arguments)]

mod admin;
mod claims;
mod create;
mod events;
mod ext;
mod model;
mod open;
mod seed;
mod views;

use model::*;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const GAS_OUT: Gas = Gas::from_tgas(15);
pub const GAS_CB: Gas = Gas::from_tgas(20);
pub const GAS_VIEW: Gas = Gas::from_tgas(10);
pub const GAS_FACTORY: Gas = Gas::from_tgas(80);
pub const GAS_LEG: Gas = Gas::from_tgas(70);
/// Callback of the seed leg: its own work plus sending the token leg and that leg's callback.
pub const GAS_SEED_CB: Gas = Gas::from_tgas(130);
pub const GAS_TOKEN_CB: Gas = Gas::from_tgas(30);
/// The first launch id. The market gives ids at or above this to the launcher and below it to core.
pub const INSTANT_ID_BASE: u64 = 1_000_000_000;
pub const SEC_NS: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * SEC_NS;
/// Demo profile only (labelled demo account and sandbox tests): one "day" lasts 10 s.
pub const DEMO_DAY_NS: u64 = 10 * SEC_NS;
/// 0.06 NEAR; the factory keeps it on the token account (docs/benchmarks.md B-FACTORY).
pub const FACTORY_DEPOSIT_YOCTO: u128 = 60_000_000_000_000_000_000_000;
/// Record storage the launcher keeps for good: 0.02 NEAR.
pub const RECORD_STORAGE_YOCTO: u128 = 20_000_000_000_000_000_000_000;
/// NEP-145 registration of the market on the launch token: 0.00125 NEAR.
pub const TOKEN_REG_YOCTO: u128 = 1_250_000_000_000_000_000_000;
/// Forwarded to the market once, toward its pool-row storage: 0.05 NEAR.
pub const MARKET_STORAGE_YOCTO: u128 = 50_000_000_000_000_000_000_000;
/// $10 in micro-USDC; mainnet profile only.
pub const MAINNET_LAUNCH_FEE: u128 = 10_000_000;
/// Aggregate of seeds the market has not consumed yet: $3,000.
pub const AGG_SEED_CAP: u128 = 3_000_000_000;
pub const RATE_LIMIT_UNITS: u64 = 1;
pub const ABANDON_UNITS: u64 = 1;
pub const ABORT_UNITS: u64 = 3;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Instants,
    Symbols,
    Reserved,
    LastLaunch,
    ByCreator,
    Owed,
    OwedTotal,
    OwedNear,
    Custody,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Launcher {
    cfg: Config,
    instants: LookupMap<u64, Instant>,
    next_id: u64,
    symbols: LookupSet<String>,
    reserved: LookupSet<String>,
    last_launch: LookupMap<AccountId, u64>,
    by_creator: LookupMap<AccountId, Vec<u64>>,
    /// (account, token) -> amount an outbound transfer failed to deliver.
    owed: LookupMap<(AccountId, AccountId), u128>,
    owed_total: LookupMap<AccountId, u128>,
    owed_near: LookupMap<AccountId, u128>,
    owed_near_total: u128,
    /// Expected balance held per token at rest (in-flight amounts are outside). A test compares it with `ft_balance_of`.
    custody: LookupMap<AccountId, u128>,
    /// Launch fees whose seed was consumed, not yet withdrawn.
    platform_unpaid: u128,
    /// Sum of `seed_due` and of `fee_held` over all launches (the USDC custody identity).
    seed_due_total: u128,
    fee_held_total: u128,
    /// Seeds accepted whose seed leg the market has not consumed, launch fees included: the aggregate cap counts these.
    seeds_held: u128,
}

/// Panic with a rule code first. Used only by user-called methods, never by callbacks or `ft_on_transfer`.
pub(crate) fn fail(code: &str, detail: &str) -> ! {
    env::panic_str(&format!("{code}: {detail}"))
}

#[near]
impl Launcher {
    #[init]
    pub fn new(owner: AccountId, guardian: AccountId, treasury: AccountId, usdc: AccountId, factory: AccountId, profile: String) -> Self {
        let mainnet = profile == "mainnet";
        let cfg = Config {
            owner,
            guardian,
            treasury,
            usdc,
            factory,
            market: None,
            market_locked: false,
            creator_gate: mainnet,
            pause: PauseLevel::None,
            frozen_until: 0,
            launch_fee: if mainnet { MAINNET_LAUNCH_FEE } else { 0 },
            factory_deposit: FACTORY_DEPOSIT_YOCTO,
            seed_min: kruxa_instant::MIN_SEED_Q,
            seed_max: kruxa_instant::MAX_SEED_Q,
            agg_cap: AGG_SEED_CAP,
            pending_seed_max: None,
            pending_agg_cap: None,
            unit_ns: if profile == "demo" { DEMO_DAY_NS } else { DAY_NS },
            profile,
        };
        Self {
            cfg,
            instants: LookupMap::new(Key::Instants),
            next_id: 0,
            symbols: LookupSet::new(Key::Symbols),
            reserved: LookupSet::new(Key::Reserved),
            last_launch: LookupMap::new(Key::LastLaunch),
            by_creator: LookupMap::new(Key::ByCreator),
            owed: LookupMap::new(Key::Owed),
            owed_total: LookupMap::new(Key::OwedTotal),
            owed_near: LookupMap::new(Key::OwedNear),
            owed_near_total: 0,
            custody: LookupMap::new(Key::Custody),
            platform_unpaid: 0,
            seed_due_total: 0,
            fee_held_total: 0,
            seeds_held: 0,
        }
    }
}

impl Launcher {
    pub(crate) fn instant(&self, id: u64) -> Instant {
        self.instants.get(&id).cloned().unwrap_or_else(|| fail("R_NO_LAUNCH", &format!("launch {id} not found")))
    }

    pub(crate) fn save(&mut self, r: Instant) {
        self.instants.insert(r.launch_id, r);
    }

    pub(crate) fn pause_level(&self) -> PauseLevel {
        kruxa_logic::pause_at(self.cfg.pause.into(), self.cfg.frozen_until, env::block_timestamp()).into()
    }

    /// New risk is blocked while PAUSED or FROZEN.
    pub(crate) fn require_live(&self) {
        match self.pause_level() {
            PauseLevel::None => {}
            PauseLevel::Paused => fail("R_PAUSED", "new activity is paused; exits stay open"),
            PauseLevel::Frozen => fail("R_FROZEN", "frozen by guardian"),
        }
    }

    /// Exits stay open while PAUSED, close only while FROZEN.
    pub(crate) fn require_exit_open(&self) {
        if self.pause_level() == PauseLevel::Frozen {
            fail("R_FROZEN", "frozen by guardian");
        }
    }

    pub(crate) fn custody_of(&self, token: &AccountId) -> u128 {
        self.custody.get(token).copied().unwrap_or(0)
    }

    pub(crate) fn custody_add(&mut self, token: &AccountId, amount: u128) {
        let v = self.custody_of(token).saturating_add(amount);
        self.custody.insert(token.clone(), v);
    }

    pub(crate) fn custody_sub(&mut self, token: &AccountId, amount: u128) {
        let v = self.custody_of(token).saturating_sub(amount);
        self.custody.insert(token.clone(), v);
    }

    pub(crate) fn owed_of(&self, account: &AccountId, token: &AccountId) -> u128 {
        self.owed.get(&(account.clone(), token.clone())).copied().unwrap_or(0)
    }

    pub(crate) fn owed_total_of(&self, token: &AccountId) -> u128 {
        self.owed_total.get(token).copied().unwrap_or(0)
    }

    /// An outbound transfer failed: the amount is still held, so custody grows back and the account can pull it later.
    pub(crate) fn owed_credit(&mut self, account: &AccountId, token: &AccountId, amount: u128) {
        let v = self.owed_of(account, token).saturating_add(amount);
        self.owed.insert((account.clone(), token.clone()), v);
        let tot = self.owed_total_of(token).saturating_add(amount);
        self.owed_total.insert(token.clone(), tot);
        self.custody_add(token, amount);
    }

    pub(crate) fn owed_debit(&mut self, account: &AccountId, token: &AccountId, amount: u128) {
        let v = self.owed_of(account, token).saturating_sub(amount);
        self.owed.insert((account.clone(), token.clone()), v);
        let tot = self.owed_total_of(token).saturating_sub(amount);
        self.owed_total.insert(token.clone(), tot);
        self.custody_sub(token, amount);
    }
}
