use crate::ContractExt;
use kruxa_logic::RuleCode;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::events::emit;
use crate::model::PauseLevel;
use crate::{fail, Contract, CAP_TIMELOCK_NS, FREEZE_MAX_NS};

impl Contract {
    fn require_owner(&self) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
    }

    fn require_owner_or_guardian(&self) {
        let p = env::predecessor_account_id();
        if p != self.cfg.owner && p != self.cfg.guardian {
            fail(RuleCode::RNotAuthorized, "owner or guardian only");
        }
    }
}

#[near]
impl Contract {
    /// Stops NEW risk (create, commit, settle). Exits stay open.
    pub fn pause(&mut self) {
        self.require_owner_or_guardian();
        if self.pause_level() == PauseLevel::None {
            self.cfg.pause = PauseLevel::Paused;
        }
        emit("paused", json!({ "by": env::predecessor_account_id() }));
    }

    /// Stops everything including exits, auto-expires to Paused after 7 days.
    pub fn freeze(&mut self) {
        self.require_owner_or_guardian();
        self.cfg.pause = PauseLevel::Frozen;
        self.cfg.frozen_until = env::block_timestamp() + FREEZE_MAX_NS;
        emit("frozen", json!({ "by": env::predecessor_account_id(), "until": self.cfg.frozen_until.to_string() }));
    }

    pub fn unpause(&mut self) {
        self.require_owner();
        self.cfg.pause = PauseLevel::None;
        emit("unpaused", json!({}));
    }

    /// Lowering a cap is instant for owner or guardian.
    pub fn lower_global_cap(&mut self, value: U128) {
        self.require_owner_or_guardian();
        if value.0 >= self.cfg.global_cap {
            fail(RuleCode::RCapGlobal, "can only lower");
        }
        self.cfg.global_cap = value.0;
        emit("global_cap_lowered", json!({ "value": value.0.to_string() }));
    }

    /// Raising a cap is timelocked 7 days and public.
    pub fn queue_global_cap(&mut self, value: U128) {
        self.require_owner();
        let at = env::block_timestamp() + CAP_TIMELOCK_NS;
        self.cfg.pending_global_cap = Some((value.0, at));
        emit("global_cap_queued", json!({ "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    pub fn apply_global_cap(&mut self) {
        match self.cfg.pending_global_cap {
            Some((v, at)) if env::block_timestamp() >= at => {
                self.cfg.global_cap = v;
                self.cfg.pending_global_cap = None;
                emit("global_cap_applied", json!({ "value": v.to_string() }));
            }
            Some(_) => fail(RuleCode::RNotYet, "timelock has not elapsed"),
            None => fail(RuleCode::RNothing, "nothing queued"),
        }
    }

    /// Per-launch hard cap for NEW launches only (existing Charters are snapshots).
    pub fn queue_launch_cap(&mut self, value: U128) {
        self.require_owner();
        let at = env::block_timestamp() + CAP_TIMELOCK_NS;
        self.cfg.pending_launch_cap = Some((value.0, at));
        emit("launch_cap_queued", json!({ "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    pub fn apply_launch_cap(&mut self) {
        match self.cfg.pending_launch_cap {
            Some((v, at)) if env::block_timestamp() >= at => {
                self.cfg.rules.max_hard_cap = v;
                self.cfg.pending_launch_cap = None;
                emit("launch_cap_applied", json!({ "value": v.to_string() }));
            }
            Some(_) => fail(RuleCode::RNotYet, "timelock has not elapsed"),
            None => fail(RuleCode::RNothing, "nothing queued"),
        }
    }
}
