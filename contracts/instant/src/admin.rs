//! Owner and guardian controls: pause levels, the one-way creator gate, the market account, reserved symbols and timelocked caps.
use crate::model::*;
use crate::{events::emit, fail, Launcher, LauncherExt};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId};

impl Launcher {
    fn require_owner(&self) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail("R_NOT_AUTHORIZED", "owner only");
        }
    }

    fn require_owner_or_guardian(&self) {
        let p = env::predecessor_account_id();
        if p != self.cfg.owner && p != self.cfg.guardian {
            fail("R_NOT_AUTHORIZED", "owner or guardian only");
        }
    }
}

#[near]
impl Launcher {
    /// Stops NEW risk (create, seed, open). Exits stay open.
    pub fn pause(&mut self) {
        self.require_owner_or_guardian();
        if self.pause_level() == PauseLevel::None {
            self.cfg.pause = PauseLevel::Paused;
        }
        emit("paused", json!({ "by": env::predecessor_account_id() }));
    }

    /// Stops everything including exits; auto-expires to Paused after 7 days.
    pub fn freeze(&mut self) {
        self.require_owner_or_guardian();
        self.cfg.pause = PauseLevel::Frozen;
        self.cfg.frozen_until = kruxa_logic::frozen_until(env::block_timestamp());
        emit("frozen", json!({ "by": env::predecessor_account_id(), "until": self.cfg.frozen_until.to_string() }));
    }

    pub fn unpause(&mut self) {
        self.require_owner();
        self.cfg.pause = PauseLevel::None;
        emit("unpaused", json!({}));
    }

    /// One-way: opens `create_instant` to every account. Owner only, after the brand token has launched and BLK-1 is closed.
    pub fn open_beta(&mut self) {
        self.require_owner();
        if !self.cfg.creator_gate {
            fail("R_NOTHING", "creator gate is already open");
        }
        self.cfg.creator_gate = false;
        emit("beta_opened", json!({ "by": env::predecessor_account_id() }));
    }

    /// Owner, before the first `open_instant`: names the market that receives every seed and pool bucket.
    pub fn set_market(&mut self, account: AccountId) {
        self.require_owner();
        if self.cfg.market_locked {
            fail("R_NOTHING", "market is locked after the first open_instant");
        }
        emit("market_set", json!({ "market": account }));
        self.cfg.market = Some(account);
    }

    /// Owner. Impersonation guard on top of the built-in list (KRUXA and the core list).
    pub fn reserve_symbol(&mut self, symbol: String) {
        self.require_owner();
        emit("symbol_reserved", json!({ "symbol": symbol }));
        self.reserved.insert(symbol);
    }

    /// Lowering a cap is instant for owner or guardian.
    pub fn lower_seed_cap(&mut self, kind: CapKind, value: U128) {
        self.require_owner_or_guardian();
        let (cur, floor) = match kind {
            CapKind::Aggregate => (self.cfg.agg_cap, 0),
            CapKind::PerLaunch => (self.cfg.seed_max, self.cfg.seed_min),
        };
        if value.0 >= cur || value.0 < floor {
            fail("R_CAP_GLOBAL", "can only lower, and not below the minimum seed");
        }
        match kind {
            CapKind::Aggregate => self.cfg.agg_cap = value.0,
            CapKind::PerLaunch => self.cfg.seed_max = value.0,
        }
        emit("cap_lowered", json!({ "kind": kind, "value": value.0.to_string() }));
    }

    /// Raising a cap is timelocked 7 days and public.
    pub fn queue_seed_cap(&mut self, kind: CapKind, value: U128) {
        self.require_owner();
        let at = kruxa_logic::timelock_effective_at(env::block_timestamp());
        match kind {
            CapKind::Aggregate => self.cfg.pending_agg_cap = Some((value.0, at)),
            CapKind::PerLaunch => self.cfg.pending_seed_max = Some((value.0, at)),
        }
        emit("cap_queued", json!({ "kind": kind, "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    pub fn apply_seed_cap(&mut self, kind: CapKind) {
        let pending = match kind {
            CapKind::Aggregate => self.cfg.pending_agg_cap,
            CapKind::PerLaunch => self.cfg.pending_seed_max,
        };
        match pending {
            Some((v, at)) if kruxa_logic::timelock_elapsed(at, env::block_timestamp()) => {
                match kind {
                    CapKind::Aggregate => {
                        self.cfg.agg_cap = v;
                        self.cfg.pending_agg_cap = None;
                    }
                    CapKind::PerLaunch => {
                        self.cfg.seed_max = v;
                        self.cfg.pending_seed_max = None;
                    }
                }
                emit("cap_applied", json!({ "kind": kind, "value": v.to_string() }));
            }
            Some(_) => fail("R_NOT_YET", "timelock has not elapsed"),
            None => fail("R_NOTHING", "nothing queued"),
        }
    }
}
