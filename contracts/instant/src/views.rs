//! Read-only views (docs/interfaces/INSTANT-ABI.md section 7). u128 and u64 are decimal strings.
use crate::events::{array, Obj};
use crate::model::*;
use crate::{Launcher, LauncherExt};
use kruxa_instant::{derive, InstantParams, Violation};
use near_sdk::json_types::U64;
use near_sdk::serde_json::value::RawValue;
use near_sdk::{env, near, AccountId};

fn pending(p: Option<(u128, u64)>) -> String {
    p.map_or_else(|| "null".to_string(), |(v, t)| Obj::new().s("value", v).s("effective_at", t).finish())
}

fn violation(code: &str, field: &str, got: String, limit: &str) -> String {
    Obj::new().s("code", code).s("field", field).s("got", got).s("limit", limit).finish()
}

impl Launcher {
    fn instant_json(&self, r: &Instant) -> Box<RawValue> {
        let d = &r.derived;
        Obj::new()
            .s("launch_id", r.launch_id)
            .s("mode", "instant")
            .s("status", r.status.name())
            .s("creator", &r.creator)
            .s("payout_recipient", &r.payout_recipient)
            .s("name", &r.params.name)
            .s("symbol", &r.params.symbol)
            .s("token", &r.token)
            .s("total_supply", d.n_total)
            .s("n_alloc", d.n_alloc)
            .s("n_pool", d.n_pool)
            .n("creator_alloc_bps", r.params.creator_alloc_bps)
            .n("cliff_days", r.params.cliff_days)
            .n("vest_days", r.params.vest_days)
            .s("seed_q", r.params.seed_q)
            .s("launch_fee", d.launch_fee)
            .s("pool_seed_q", d.pool_seed_q)
            .s("open_price_micro_per_token", d.open_price)
            .j("terms", &r.params.fees)
            .s("charter_hash", kruxa_logic::hex(&r.charter_hash))
            .s("created_at_ns", r.created_at)
            .s("seeded_at_ns", r.seeded_at)
            .s("opened_at_ns", r.opened_at)
            .s("seed_due", r.seed_due)
            .s("seed_inflight", r.seed_inflight)
            .s("seed_sent", r.seed_sent)
            .s("fee_held", r.fee_held)
            .s("tokens_unsent", r.tokens_unsent())
            .s("tokens_inflight", r.tokens_inflight)
            .s("tokens_sent", r.tokens_sent)
            .s("alloc_claimed", r.claimed)
            .s("deposit_paid", r.deposit_paid)
            .s("deposit_refundable", r.deposit_refundable)
            .s("leg_nonce", r.leg_nonce)
            .s("unconfirmed", format!("{:?}", r.unconfirmed))
            .s("unconfirmed_amount", r.unconfirmed_amount)
            .raw()
    }

    fn preview_violations(&self, p: &InstantParams, creator: Option<&AccountId>) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        if let Some(c) = creator {
            if self.cfg.creator_gate {
                out.push(violation("R_CREATOR_GATE", "creator", c.to_string(), "open_beta must be called first"));
            }
            if self.pause_level() != PauseLevel::None {
                out.push(violation("R_PAUSED", "paused", self.pause_level().name().to_string(), "None"));
            }
            if let Some(until) = self.rate_limited_until(c, env::block_timestamp()) {
                out.push(violation("R_RATE_LIMIT", "creator", c.to_string(), &format!("next launch at {until}")));
            }
        }
        if self.symbol_taken(&p.symbol) {
            out.push(violation("R_SYMBOL", "symbol", p.symbol.clone(), "unused"));
        }
        if self.symbol_reserved(&p.symbol) {
            out.push(violation("R_SYMBOL_RESERVED", "symbol", p.symbol.clone(), "not reserved"));
        }
        for Violation { code, field, got, limit } in kruxa_instant::validate_instant(p, &self.limits()) {
            out.push(violation(&code, &field, got, &limit));
        }
        out
    }
}

#[near]
impl Launcher {
    pub fn get_config(&self) -> Box<RawValue> {
        let c = &self.cfg;
        Obj::new()
            .s("owner", &c.owner)
            .s("guardian", &c.guardian)
            .s("treasury", &c.treasury)
            .s("usdc", &c.usdc)
            .s("factory", &c.factory)
            .opt("market", c.market.as_ref())
            .n("market_locked", c.market_locked)
            .s("profile", c.profile.name())
            .n("creator_gate", c.creator_gate)
            .s("paused", self.pause_level().name())
            .s("launch_fee", c.launch_fee)
            .s("factory_deposit", c.factory_deposit)
            .s("seed_min", c.seed_min)
            .s("seed_max", c.seed_max)
            .s("seed_cap_aggregate", c.agg_cap)
            .o("pending_caps", Obj::new().r("aggregate", &pending(c.pending_agg_cap)).r("per_launch", &pending(c.pending_seed_max)))
            .s("unit_ns", c.unit_ns)
            .s("next_launch_id", crate::INSTANT_ID_BASE + self.next_id)
            .s("platform_unpaid", self.platform_unpaid)
            .raw()
    }

    pub fn required_deposit(&self) -> String {
        self.required().to_string()
    }

    /// The same checks `create_instant` runs, all violations at once. With `creator` it also reports gate, pause and rate limit.
    pub fn preview_instant(&self, params: InstantParams, creator: Option<AccountId>) -> Box<RawValue> {
        let violations = self.preview_violations(&params, creator.as_ref());
        let mut o = Obj::new().n("ok", violations.is_empty()).r("violations", &array(violations.clone()));
        o = o.s("required_deposit", self.required()).s("launch_fee", self.cfg.launch_fee);
        if let Ok(d) = derive(&params, &self.limits()) {
            o = o.s("n_total", d.n_total).s("n_alloc", d.n_alloc).s("n_pool", d.n_pool).s("pool_seed_q", d.pool_seed_q);
            o = o.s("open_price_micro_per_token", d.open_price);
        }
        o.raw()
    }

    pub fn get_instant(&self, launch_id: U64) -> Option<Box<RawValue>> {
        self.instants.get(&launch_id.0).map(|r| self.instant_json(&r))
    }

    pub fn get_phase(&self, launch_id: U64) -> Option<Box<RawValue>> {
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
        Some(
            Obj::new()
                .s("status", r.status.name())
                .s("step", step)
                .s("next_action", next)
                .n("can_cancel", r.status == Status::TokenReady)
                .s("can_abandon_at_ns", r.created_at + crate::ABANDON_UNITS * unit)
                .s("can_abort_at_ns", r.seeded_at + crate::ABORT_UNITS * unit)
                .raw(),
        )
    }

    pub fn get_vesting(&self, launch_id: U64) -> Option<Box<RawValue>> {
        let r = self.instants.get(&launch_id.0)?;
        let (unlocked, can) = self.vested(&r, env::block_timestamp());
        let sc = self.schedule(&r);
        Some(
            Obj::new()
                .s("recipient", &r.payout_recipient)
                .s("total", r.derived.n_alloc)
                .s("unlocked", unlocked)
                .s("claimed", r.claimed)
                .s("claimable", can)
                .s("cliff_end_ns", r.opened_at + sc.cliff_ns)
                .s("vest_end_ns", r.opened_at + sc.vest_ns)
                .raw(),
        )
    }

    pub fn owed_of_account(&self, account: AccountId, token_id: AccountId) -> String {
        self.owed_of(&account, &token_id).to_string()
    }

    /// Global USDC identity and expected balances AT REST (nothing in flight; custody >= expected means solvent, donations only
    /// add). With `launch_id` also that launch's token identity, supply conservation (IL-1) and vest bounds (IL-5).
    pub fn get_invariants(&self, launch_id: Option<U64>) -> Box<RawValue> {
        let usdc = &self.cfg.usdc;
        let rhs = self.seed_due_total + self.fee_held_total + self.platform_unpaid + self.owed_total_of(usdc);
        let mut o = Obj::new()
            .n("usdc_custody_identity", self.custody_of(usdc) == rhs)
            .s("usdc_custody", self.custody_of(usdc))
            .s("usdc_expected", rhs)
            .s("owed_usdc", self.owed_total_of(usdc))
            .n("seeds_held_le_cap", self.seeds_held <= self.cfg.agg_cap)
            .n("market_locked_consistent", !self.cfg.market_locked || self.cfg.market.is_some());
        if let Some(r) = launch_id.and_then(|id| self.instants.get(&id.0)) {
            let tok_rhs = (r.derived.n_alloc - r.claimed.min(r.derived.n_alloc)) + r.tokens_unsent() + self.owed_total_of(&r.token);
            let created = !matches!(r.status, Status::Creating | Status::CreationFailed);
            let (unlocked, _) = self.vested(&r, env::block_timestamp());
            o = o.s("token", &r.token).s("token_custody", self.custody_of(&r.token));
            o = o.n("token_custody_identity", !created || self.custody_of(&r.token) == tok_rhs);
            o = o.n("supply_conservation", r.derived.n_alloc + r.derived.n_pool == r.derived.n_total);
            o = o.n("claimed_le_unlocked", r.claimed <= unlocked);
            o = o.n("vest_bounds", unlocked <= r.derived.n_alloc && (r.status == Status::Open || unlocked == 0));
        }
        o.raw()
    }
}
