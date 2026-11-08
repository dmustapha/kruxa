//! Owner and guardian controls: pause levels, the one-way creator gate, the market account, reserved symbols and timelocked caps.
use crate::model::*;
use crate::events::{emit, Obj};
use crate::{fail, Launcher, LauncherExt};
use near_sdk::json_types::U128;
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
        emit("paused", Obj::new().s("by", env::predecessor_account_id()));
    }

    /// Stops everything including exits; auto-expires to Paused after 7 days.
    pub fn freeze(&mut self) {
        self.require_owner_or_guardian();
        self.cfg.pause = PauseLevel::Frozen;
        self.cfg.frozen_until = kruxa_logic::frozen_until(env::block_timestamp());
        emit("frozen", Obj::new().s("by", env::predecessor_account_id()).s("until", self.cfg.frozen_until));
    }

    pub fn unpause(&mut self) {
        self.require_owner();
        self.cfg.pause = PauseLevel::None;
        emit("unpaused", Obj::new());
    }

    /// One-way: opens `create_instant` to every account. Owner only, after the brand token has launched and BLK-1 is closed.
    pub fn open_beta(&mut self) {
        self.require_owner();
        if !self.cfg.creator_gate {
            fail("R_NOTHING", "creator gate is already open");
        }
        self.cfg.creator_gate = false;
        emit("beta_opened", Obj::new().s("by", env::predecessor_account_id()));
    }

    /// Owner, before the first `open_instant`: names the market that receives every seed and pool bucket.
    pub fn set_market(&mut self, account: AccountId) {
        self.require_owner();
        if self.cfg.market_locked {
            fail("R_NOTHING", "market is locked after the first open_instant");
        }
        emit("market_set", Obj::new().s("market", &account));
        self.cfg.market = Some(account);
    }

    /// Owner. Impersonation guard on top of the built-in list (KRUXA and the core list).
    pub fn reserve_symbol(&mut self, symbol: String) {
        self.require_owner();
        emit("symbol_reserved", Obj::new().s("symbol", &symbol));
        self.reserved.insert(symbol, 1);
    }

    /// Owner or guardian. Lowering a cap is instant; raising it is owner only and timelocked 7 days (see `apply_seed_cap`).
    pub fn set_seed_cap(&mut self, kind: CapKind, value: U128) {
        self.require_owner_or_guardian();
        let (cur, floor) = match kind {
            CapKind::Aggregate => (self.cfg.agg_cap, 0),
            CapKind::PerLaunch => (self.cfg.seed_max, self.cfg.seed_min),
        };
        if value.0 < cur {
            if value.0 < floor {
                fail("R_CAP_GLOBAL", "not below the minimum seed");
            }
            match kind {
                CapKind::Aggregate => self.cfg.agg_cap = value.0,
                CapKind::PerLaunch => self.cfg.seed_max = value.0,
            }
            emit("cap_lowered", Obj::new().s("kind", kind.name()).s("value", value.0));
            return;
        }
        self.require_owner();
        let at = kruxa_logic::timelock_effective_at(env::block_timestamp());
        match kind {
            CapKind::Aggregate => self.cfg.pending_agg_cap = Some((value.0, at)),
            CapKind::PerLaunch => self.cfg.pending_seed_max = Some((value.0, at)),
        }
        emit("cap_queued", Obj::new().s("kind", kind.name()).s("value", value.0).s("effective_at", at));
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
                emit("cap_applied", Obj::new().s("kind", kind.name()).s("value", v));
            }
            Some(_) => fail("R_NOT_YET", "timelock has not elapsed"),
            None => fail("R_NOTHING", "nothing queued"),
        }
    }
}
