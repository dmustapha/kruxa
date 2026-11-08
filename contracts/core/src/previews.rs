//! View-only helpers for the app (APP-SPEC IR-C1 to IR-C4). Nothing here writes state.
use crate::ContractExt;
use kruxa_logic::{
    allocate, bond_required, hex, phase_at, settle_position, validate_all, validate_params, verdict, Outcome, RuleCode, TrialParams,
};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

use crate::model::*;
use crate::Contract;

#[near]
impl Contract {
    /// Live phase of a launch: Scheduled, Open, Closing or Ready, with the three clock edges.
    pub fn get_phase(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let now = env::block_timestamp();
        Some(
            json!({ "phase": format!("{:?}", phase_at(now, ch.opens_at, ch.commit_end, ch.walk_end)), "status": format!("{:?}", st.status), "now": now.to_string(),
                     "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string() }),
        )
    }

    /// What `create_trial` would say about these params from `creator`: every rule violation, the creator gate, and the deposit if clean.
    pub fn preview_charter(&self, params: TrialParams, creator: Option<AccountId>) -> Value {
        let is_owner = creator.as_ref() == Some(&self.cfg.owner);
        let headroom = self.cfg.global_cap.saturating_sub(self.cfg.global_held);
        let mut violations: Vec<Value> = Vec::new();
        if self.cfg.creator_gate && !is_owner {
            let code = RuleCode::RCreatorGate.as_str();
            violations.push(json!({ "code": code, "field": "creator", "got": creator, "limit": "owner until open_beta" }));
        }
        for v in validate_all(&params, &self.cfg.rules, headroom, is_owner) {
            violations.push(json!({ "code": v.code.as_str(), "field": v.field, "got": v.got, "limit": v.limit }));
        }
        let deposit = validate_params(&params, &self.cfg.rules, headroom, is_owner)
            .ok()
            .filter(|_| violations.is_empty())
            .map(|d| (bond_required(d.max_holders) + self.cfg.factory_deposit + crate::TOKEN_REG_YOCTO).to_string());
        json!({ "ok": violations.is_empty(), "violations": violations, "required_deposit": deposit })
    }

    /// "Tokens if closed now" for one holder at the live totals, plus the verdict margins. After settlement it reports the real numbers.
    pub fn preview_settlement(&self, launch_id: U64, holder: String) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let refuse = |code: &str| Some(json!({ "ok": false, "code": code }));
        let Some(h) = HolderId::parse(&holder) else { return refuse("R_DELIVER") };
        let Some(pos) = self.positions.get(&(launch_id.0, h)) else { return refuse("R_NO_POSITION") };
        let i = st.verdict_inputs(ch);
        let pass = verdict(&i) == Outcome::Pass;
        let margin = |a: u128, b: u128| (a as i128 - b as i128).to_string();
        let mut out = json!({ "ok": true, "would_pass": pass, "total_active": st.total_active.to_string(), "soft_cap": ch.params.soft_cap.to_string(),
                              "soft_cap_margin": margin(st.total_active, ch.params.soft_cap), "funders": st.active_funders, "min_funders": ch.params.min_funders,
                              "funders_margin": st.active_funders as i64 - ch.params.min_funders as i64, "provisional": st.settlement.is_none() });
        let (spend, refund, tokens, bonus) = if pos.settled || st.settlement.is_some() && pos.open() == 0 {
            (pos.spent, pos.owed() + pos.inflight() + pos.refunded, pos.tokens_entitled, pos.bonus_entitled)
        } else if !pass || st.total_active == 0 {
            (0, pos.open(), 0, 0)
        } else {
            let accepted =
                allocate(st.total_active, ch.params.hard_cap, ch.params.sale_bps, ch.params.lp_bps, &ch.rules).map_or(0, |a| a.accepted);
            let r = settle_position(pos.open(), st.total_active, accepted, ch.derived.n_sale, ch.derived.n_backer);
            r.map_or((0, pos.open(), 0, 0), |r| (r.spend, r.refund, r.tokens, r.bonus))
        };
        for (k, v) in [("spend", spend), ("refund", refund), ("tokens", tokens), ("bonus", bonus)] {
            out[k] = json!(v.to_string());
        }
        Some(out)
    }

    /// The accounts the Charter names: the creator and the payout recipient (once when they are the same). Not sold as sybil resistance.
    pub fn declared_wallets(&self, launch_id: U64) -> Option<Value> {
        let ch = self.charters.get(&launch_id.0)?;
        let mut wallets = vec![ch.creator.clone()];
        if ch.stream_recipient != ch.creator {
            wallets.push(ch.stream_recipient.clone());
        }
        Some(json!({ "creator": ch.creator, "payout_recipient": ch.stream_recipient, "wallets": wallets }))
    }

    pub fn get_book_hash(&self, launch_id: U64) -> Option<String> {
        self.states.get(&launch_id.0).map(|s| hex(&s.book_hash))
    }
}
