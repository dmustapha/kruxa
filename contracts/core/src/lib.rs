//! kruxa-core: the NEAR contract. Wave 1 = trial lifecycle (create, commit, Walk, settle, refunds, claims).
//! Dependency direction: kruxa-core -> kruxa-logic -> kruxa-math. The pure crates never import this one.
#![forbid(unsafe_code)]
// The one init method takes the eight account/profile parameters explicitly; the near macro repeats the lint on its wrapper.
#![allow(clippy::too_many_arguments)]

mod admin;
mod events;
mod ext;
mod intake;
mod lifecycle;
mod model;
mod payout;
#[cfg(feature = "s4-fallback")]
mod s4;
mod token;
mod views;

use kruxa_logic::{RuleCode, Rules};
use model::*;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const GAS_OUT: Gas = Gas::from_tgas(20);
pub const GAS_CB: Gas = Gas::from_tgas(25);
pub const CREATION_TIMEOUT_NS: u64 = 600_000_000_000;
pub use kruxa_logic::{CAP_TIMELOCK_NS, FREEZE_MAX_NS, GLOBAL_CAP_USDC};
pub const FACTORY_DEPOSIT_YOCTO: u128 = 60_000_000_000_000_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Charters,
    States,
    Positions,
    SeqIndex,
    ActiveByCreator,
    Symbols,
    WalkNonces,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    cfg: Config,
    charters: LookupMap<u64, Charter>,
    states: LookupMap<u64, LaunchState>,
    positions: LookupMap<(u64, HolderId), Position>,
    seq_index: LookupMap<(u64, u32), HolderId>,
    active_by_creator: LookupMap<AccountId, u64>,
    symbols: LookupSet<String>,
    walk_nonces: LookupMap<[u8; 32], u64>,
    next_launch_id: u64,
}

/// Every panic message starts with the rule code so a UI or agent can match on the prefix.
pub(crate) fn fail(code: RuleCode, text: &str) -> ! {
    env::panic_str(&format!("{}: {}", code.as_str(), text))
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        treasury: AccountId,
        relay_fees: AccountId,
        usdc: AccountId,
        intents: AccountId,
        factory: AccountId,
        profile: String,
    ) -> Self {
        let rules = if profile == "demo" { Rules::demo_clock() } else { Rules::ladder() };
        let cfg = Config {
            owner,
            guardian,
            treasury,
            relay_fees,
            usdc_token_id: format!("nep141:{}", usdc),
            usdc,
            intents,
            factory,
            rules,
            global_cap: GLOBAL_CAP_USDC,
            pending_global_cap: None,
            pending_launch_cap: None,
            global_held: 0,
            pause: PauseLevel::None,
            frozen_until: 0,
            factory_deposit: FACTORY_DEPOSIT_YOCTO,
            profile,
        };
        Self {
            cfg,
            charters: LookupMap::new(Key::Charters),
            states: LookupMap::new(Key::States),
            positions: LookupMap::new(Key::Positions),
            seq_index: LookupMap::new(Key::SeqIndex),
            active_by_creator: LookupMap::new(Key::ActiveByCreator),
            symbols: LookupSet::new(Key::Symbols),
            walk_nonces: LookupMap::new(Key::WalkNonces),
            next_launch_id: 1,
        }
    }
}

impl Contract {
    pub(crate) fn charter(&self, id: u64) -> Charter {
        self.charters.get(&id).cloned().unwrap_or_else(|| fail(RuleCode::RNoLaunch, &format!("launch {} not found", id)))
    }

    pub(crate) fn state(&self, id: u64) -> LaunchState {
        self.states.get(&id).cloned().unwrap_or_else(|| fail(RuleCode::RNoLaunch, &format!("launch {} not found", id)))
    }

    pub(crate) fn save_state(&mut self, id: u64, st: LaunchState) {
        self.states.insert(id, st);
    }

    /// Pause level with the FROZEN auto-expiry applied on read: no transaction is needed to lift it.
    pub(crate) fn pause_level(&self) -> PauseLevel {
        kruxa_logic::pause_at(self.cfg.pause.into(), self.cfg.frozen_until, env::block_timestamp()).into()
    }

    /// New risk is blocked while PAUSED or FROZEN.
    pub(crate) fn require_live(&self) {
        match self.pause_level() {
            PauseLevel::None => {}
            PauseLevel::Paused => fail(RuleCode::RPaused, "new activity is paused; exits stay open"),
            PauseLevel::Frozen => fail(RuleCode::RFrozen, "frozen by guardian"),
        }
    }

    /// Exits (Walk, refunds, claims) stay open while PAUSED, close only while FROZEN.
    pub(crate) fn require_exit_open(&self) {
        if self.pause_level() == PauseLevel::Frozen {
            fail(RuleCode::RFrozen, "frozen by guardian");
        }
    }
}
