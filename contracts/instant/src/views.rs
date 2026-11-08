//! Read-only views (docs/interfaces/INSTANT-ABI.md section 7). u128 and u64 are decimal strings.
use crate::model::*;
use crate::{Launcher, LauncherExt};
use kruxa_instant::{derive, InstantParams};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, to_value, Value};
use near_sdk::{env, near, AccountId};

fn s(v: u128) -> String {
    v.to_string()
}

fn pending(p: Option<(u128, u64)>) -> Value {
    p.map_or(Value::Null, |(v, t)| json!({ "value": s(v), "effective_at": t.to_string() }))
}

impl Launcher {
    fn instant_json(&self, r: &Instant) -> Value {
        json!({ "launch_id": r.launch_id.to_string(), "mode": "instant", "status": r.status, "creator": r.creator, "payout_recipient": r.payout_recipient,
                "name": r.params.name, "symbol": r.params.symbol, "token": r.token, "total_supply": s(r.derived.n_total), "n_alloc": s(r.derived.n_alloc),
                "n_pool": s(r.derived.n_pool), "creator_alloc_bps": r.params.creator_alloc_bps, "cliff_days": r.params.cliff_days,
                "vest_days": r.params.vest_days, "seed_q": s(r.params.seed_q), "launch_fee": s(r.derived.launch_fee), "pool_seed_q": s(r.derived.pool_seed_q),
                "open_price_micro_per_token": s(r.derived.open_price), "terms": r.params.fees,
                "charter_hash": kruxa_logic::hex(&r.charter_hash), "created_at_ns": r.created_at.to_string(), "seeded_at_ns": r.seeded_at.to_string(),
                "opened_at_ns": r.opened_at.to_string(), "seed_due": s(r.seed_due),
                "seed_inflight": s(r.seed_inflight), "seed_sent": s(r.seed_sent), "fee_held": s(r.fee_held), "tokens_unsent": s(r.tokens_unsent()),
                "tokens_inflight": s(r.tokens_inflight), "tokens_sent": s(r.tokens_sent), "alloc_claimed": s(r.claimed), "deposit_paid": s(r.deposit_paid),
                "deposit_refundable": s(r.deposit_refundable) })
    }

    fn preview_violations(&self, p: &InstantParams, creator: Option<&AccountId>) -> Vec<Value> {
        let mut out: Vec<Value> = Vec::new();
        let mut add = |code: &str, field: &str, got: String, limit: &str| out.push(json!({ "code": code, "field": field, "got": got, "limit": limit }));
        if let Some(c) = creator {
            if self.cfg.creator_gate {
                add("R_CREATOR_GATE", "creator", c.to_string(), "open_beta must be called first");
            }
            if self.pause_level() != PauseLevel::None {
                add("R_PAUSED", "paused", format!("{:?}", self.pause_level()), "None");
            }
            if let Some(until) = self.rate_limited_until(c, env::block_timestamp()) {
                add("R_RATE_LIMIT", "creator", c.to_string(), &format!("next launch at {until}"));
            }
        }
        if self.symbol_taken(&p.symbol) {
            add("R_SYMBOL", "symbol", p.symbol.clone(), "unused");
        }
        if self.symbol_reserved(&p.symbol) {
            add("R_SYMBOL_RESERVED", "symbol", p.symbol.clone(), "not reserved");
        }
        for v in kruxa_instant::validate_instant(p, &self.limits()) {
            out.push(to_value(&v).expect("violation serializes"));
        }
        out
    }
}

#[near]
impl Launcher {
    pub fn get_config(&self) -> Value {
        let c = &self.cfg;
        json!({ "owner": c.owner, "guardian": c.guardian, "treasury": c.treasury, "usdc": c.usdc, "factory": c.factory, "market": c.market,
                "market_locked": c.market_locked, "profile": c.profile, "creator_gate": c.creator_gate, "paused": format!("{:?}", self.pause_level()),
                "launch_fee": s(c.launch_fee), "factory_deposit": s(c.factory_deposit), "seed_min": s(c.seed_min), "seed_max": s(c.seed_max),
                "seed_cap_aggregate": s(c.agg_cap), "pending_caps": json!({ "aggregate": pending(c.pending_agg_cap), "per_launch": pending(c.pending_seed_max) }),
                "unit_ns": c.unit_ns.to_string(), "next_launch_id": (crate::INSTANT_ID_BASE + self.next_id).to_string(), "platform_unpaid": s(self.platform_unpaid) })
    }

    pub fn required_deposit(&self) -> String {
        s(self.required())
    }

    /// The same checks `create_instant` runs, all violations at once. With `creator` it also reports gate, pause and rate limit.
    pub fn preview_instant(&self, params: InstantParams, creator: Option<AccountId>) -> Value {
        let violations = self.preview_violations(&params, creator.as_ref());
        let d = derive(&params, &self.limits()).ok();
        json!({ "ok": violations.is_empty(), "violations": violations, "required_deposit": s(self.required()),
                "n_total": d.as_ref().map(|d| s(d.n_total)), "n_alloc": d.as_ref().map(|d| s(d.n_alloc)), "n_pool": d.as_ref().map(|d| s(d.n_pool)),
                "pool_seed_q": d.as_ref().map(|d| s(d.pool_seed_q)), "launch_fee": s(self.cfg.launch_fee),
                "open_price_micro_per_token": d.as_ref().map(|d| s(d.open_price)) })
    }

    pub fn get_instant(&self, launch_id: U64) -> Option<Value> {
        self.instants.get(&launch_id.0).map(|r| self.instant_json(r))
    }

    pub fn get_phase(&self, launch_id: U64) -> Option<Value> {
        let r = self.instants.get(&launch_id.0)?;
        let (step, next) = match r.status {
            Status::Creating => ("create", "none"),
            Status::TokenReady => ("seed", "seed"),
            Status::Seeded => ("open", "open_instant"),
            Status::Handoff if r.seed_inflight > 0 || r.tokens_inflight > 0 => ("open", "none"),
            Status::Handoff => ("open", "retry_open_instant"),
            Status::Open => ("done", "none"),
            Status::CreationFailed | Status::Abandoned | Status::Aborted => ("dead", "none"),
        };
        let unit = self.cfg.unit_ns;
        Some(json!({ "status": r.status, "step": step, "next_action": next, "can_cancel": r.status == Status::TokenReady,
                     "can_abandon_at_ns": (r.created_at + crate::ABANDON_UNITS * unit).to_string(),
                     "can_abort_at_ns": (r.seeded_at + crate::ABORT_UNITS * unit).to_string() }))
    }

    pub fn get_vesting(&self, launch_id: U64) -> Option<Value> {
        let r = self.instants.get(&launch_id.0)?;
        let (unlocked, can) = self.vested(r, env::block_timestamp());
        let sc = self.schedule(r);
        Some(json!({ "recipient": r.payout_recipient, "total": s(r.derived.n_alloc), "unlocked": s(unlocked), "claimed": s(r.claimed), "claimable": s(can),
                     "cliff_end_ns": (r.opened_at + sc.cliff_ns).to_string(), "vest_end_ns": (r.opened_at + sc.vest_ns).to_string() }))
    }

    pub fn instants_by_creator(&self, account: AccountId) -> Vec<String> {
        self.by_creator.get(&account).map(|v| v.iter().map(|i| i.to_string()).collect()).unwrap_or_default()
    }

    pub fn declared_wallets(&self, launch_id: U64) -> Vec<AccountId> {
        self.instants.get(&launch_id.0).map(|r| vec![r.creator.clone(), r.payout_recipient.clone()]).unwrap_or_default()
    }

    pub fn owed_of_account(&self, account: AccountId, token_id: AccountId) -> String {
        s(self.owed_of(&account, &token_id))
    }

    pub fn owed_near_of(&self, account: AccountId) -> String {
        s(self.owed_near.get(&account).copied().unwrap_or(0))
    }

    /// Expected balances AT REST (nothing in flight). Custody >= expected means solvent; donations only add.
    pub fn solvency_report(&self, tokens: Option<Vec<AccountId>>) -> Value {
        let usdc = &self.cfg.usdc;
        let toks: Vec<Value> = tokens.unwrap_or_default().iter().map(|t| json!({ "token": t, "amount": s(self.custody_of(t)) })).collect();
        json!({ "expected_usdc_custody": s(self.custody_of(usdc)), "expected_token_custody": toks, "owed_near_total": s(self.owed_near_total) })
    }

    /// Global USDC identity; with `launch_id` also that launch's token identity, supply conservation (IL-1) and vest bounds (IL-5).
    pub fn get_invariants(&self, launch_id: Option<U64>) -> Value {
        let usdc = &self.cfg.usdc;
        let rhs = self.seed_due_total + self.fee_held_total + self.platform_unpaid + self.owed_total_of(usdc);
        let mut out = json!({ "usdc_custody_identity": self.custody_of(usdc) == rhs, "usdc_custody": s(self.custody_of(usdc)), "usdc_expected": s(rhs),
                              "seeds_held_le_cap": self.seeds_held <= self.cfg.agg_cap, "market_locked_consistent": !self.cfg.market_locked || self.cfg.market.is_some() });
        if let Some(r) = launch_id.and_then(|id| self.instants.get(&id.0)) {
            let tok_rhs = (r.derived.n_alloc - r.claimed.min(r.derived.n_alloc)) + r.tokens_unsent() + self.owed_total_of(&r.token);
            let created = !matches!(r.status, Status::Creating | Status::CreationFailed);
            let (unlocked, _) = self.vested(r, env::block_timestamp());
            out["token_custody_identity"] = json!(!created || self.custody_of(&r.token) == tok_rhs);
            out["supply_conservation"] = json!(r.derived.n_alloc + r.derived.n_pool == r.derived.n_total);
            out["claimed_le_unlocked"] = json!(r.claimed <= unlocked);
            out["vest_bounds"] = json!(unlocked <= r.derived.n_alloc && (r.status == Status::Open || unlocked == 0));
        }
        out
    }
}
