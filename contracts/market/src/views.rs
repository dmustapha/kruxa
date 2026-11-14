use crate::model::trade_from_of;
use crate::{Market, MarketExt};
use kruxa_market::{
    creator_unlocked, fee_elapsed_ns, quote_buy as cp_buy, quote_sell as cp_sell, trading_open, MarketError, Reserves, Routing, Swap,
    R_NOT_YET_TRADING,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

fn s(v: u128) -> String {
    v.to_string()
}

fn quote_json(r: Result<Swap, MarketError>, before: Reserves) -> Value {
    match r {
        Err(e) => json!({ "ok": false, "code": e.code() }),
        Ok(x) => {
            let f = x.fee;
            let spot = before.q as f64 / before.t as f64;
            let fill = if x.amount_in > 0 && x.amount_out > 0 {
                x.q_leg as f64 / if x.q_leg == x.amount_in { x.amount_out as f64 } else { x.amount_in as f64 }
            } else {
                spot
            };
            let impact = if spot > 0.0 { (((fill - spot) / spot).abs() * 10_000.0) as u64 } else { 0 };
            json!({ "ok": true, "out": s(x.amount_out), "fee_total": s(f.total), "fee_bps": s(f.total.saturating_mul(10_000) / x.q_leg.max(1)),
                    "creator": s(f.creator), "platform": s(f.platform), "holders": s(f.holders), "lp": s(f.lp), "referral": s(f.referral),
                    "surcharge": s(f.surcharge), "q_after": s(x.after.q), "t_after": s(x.after.t), "price_impact_bps": impact })
        }
    }
}

#[near]
impl Market {
    pub fn get_config(&self) -> Value {
        json!({ "owner": self.owner, "guardian": self.guardian, "treasury": self.treasury, "usdc": self.usdc, "core": self.core, "paused": self.paused,
                "max_pool_reserve_q": s(self.max_pool_q), "max_global_reserve_q": s(self.max_global_q), "global_q": s(self.global_q),
                "launcher": self.launcher, "max_instant_reserve_q": s(self.max_instant_q), "instant_q": s(self.instant_q), "instant_seeded_q": s(self.instant_seeded_q),
                "pending_max_instant_reserve": self.pending_max_instant_q.map(|(v, at)| json!({ "value": s(v), "effective_at": s(at as u128) })) })
    }

    pub fn get_pool(&self, launch_id: U64) -> Value {
        let Some(p) = self.pools.get(&launch_id.0) else { return Value::Null };
        json!({ "launch_id": s(p.launch_id as u128), "mode": p.mode.as_str(), "creator": p.creator, "token": p.token, "quote": self.usdc, "state": if p.open { "Open" } else { "AwaitToken" },
                "q": s(p.q), "t": s(p.t), "opened_ns": s(p.opened_ns as u128), "trade_from_ns": s(trade_from_of(p.launch_id) as u128), "payout_recipient": p.payout_recipient,
                "total_supply": s(p.total_supply), "charter_hash": p.charter_hash, "mint_authority": p.mint_authority, "freeze_authority": p.freeze_authority, "terms": p.terms })
    }

    pub fn quote_buy(&self, launch_id: U64, amount_in: U128, now_ns: Option<U64>) -> Value {
        let Some(p) = self.pools.get(&launch_id.0).filter(|p| p.open) else { return json!({ "ok": false, "code": "R_NO_POOL" }) };
        let (now, tf) = (now_ns.map_or(env::block_timestamp(), |n| n.0), trade_from_of(p.launch_id));
        if !trading_open(now, tf) {
            return json!({ "ok": false, "code": R_NOT_YET_TRADING, "trade_from_ns": s(tf as u128) });
        }
        let el = fee_elapsed_ns(now, p.opened_ns, tf);
        quote_json(cp_buy(p.reserves(), amount_in.0, 1, &p.terms, el, Routing::M_A), p.reserves())
    }

    pub fn quote_sell(&self, launch_id: U64, amount_in: U128, now_ns: Option<U64>) -> Value {
        let Some(p) = self.pools.get(&launch_id.0).filter(|p| p.open) else { return json!({ "ok": false, "code": "R_NO_POOL" }) };
        let el = fee_elapsed_ns(now_ns.map_or(env::block_timestamp(), |n| n.0), p.opened_ns, trade_from_of(p.launch_id));
        quote_json(cp_sell(p.reserves(), amount_in.0, 1, &p.terms, el, Routing::M_A), p.reserves())
    }

    pub fn creator_status(&self, launch_id: U64) -> Value {
        let Some(p) = self.pools.get(&launch_id.0) else { return Value::Null };
        let unlocked = creator_unlocked(&p.epochs, p.ledger.folded_unlocked, p.opened_ns, &p.terms, env::block_timestamp()).unwrap_or(0);
        json!({ "recipient": p.payout_recipient, "accrued": s(p.ledger.acc_creator), "unlocked": s(unlocked), "paid": s(p.ledger.paid_creator),
                "claimable": s(unlocked.saturating_sub(p.ledger.paid_creator)), "epochs": p.epochs.len() })
    }

    /// Creator fee epochs still vesting: for each, the accrued slice and how much of it has vested at this block. Fully vested epochs are
    /// folded into `folded_unlocked` and no longer listed.
    pub fn get_epochs(&self, launch_id: U64) -> Value {
        let Some(p) = self.pools.get(&launch_id.0) else { return Value::Null };
        let now = env::block_timestamp();
        let rows: Vec<Value> = p
            .epochs
            .iter()
            .map(|e| {
                let vested = creator_unlocked(std::slice::from_ref(e), 0, p.opened_ns, &p.terms, now).unwrap_or(0);
                json!({ "epoch": e.epoch, "accrued": s(e.amount), "vested": s(vested) })
            })
            .collect();
        json!({ "folded_unlocked": s(p.ledger.folded_unlocked), "vest_days": p.terms.fee_vest_days, "vest_bps": p.terms.fee_vest_bps, "epochs": rows })
    }

    pub fn ledger_report(&self, launch_id: U64) -> Value {
        let Some(p) = self.pools.get(&launch_id.0) else { return Value::Null };
        let l = &p.ledger;
        json!({ "fee_total": s(l.fee_total), "acc_creator": s(l.acc_creator), "acc_platform": s(l.acc_platform), "acc_holders": "0", "acc_referral": "0",
                "acc_lp": s(l.acc_lp), "paid_creator": s(l.paid_creator), "red_holders": s(l.red_holders), "red_referral": s(l.red_referral),
                "surcharge": s(l.surcharge), "folded_unlocked": s(l.folded_unlocked), "platform_unpaid_global": s(self.platform_unpaid) })
    }

    /// Expected balance this contract must hold of `token`. Custody at or above this is solvent (donations only add).
    pub fn solvency_report(&self, token_id: AccountId) -> Value {
        json!({ "token": token_id, "expected_custody": s(self.custody_of(&token_id)), "owed_total": s(self.owed_total_of(&token_id)) })
    }

    /// Identity: USDC custody = sum of pool reserves + unpaid creator + unpaid platform + owed USDC.
    pub fn get_invariants(&self) -> Value {
        let usdc_rhs = self.global_q + self.creator_unpaid + self.platform_unpaid + self.owed_total_of(&self.usdc);
        json!({ "usdc_custody_identity": self.custody_of(&self.usdc) == usdc_rhs, "usdc_custody": s(self.custody_of(&self.usdc)), "usdc_expected": s(usdc_rhs),
                "instant_q_matches": self.instant_q <= self.global_q, "global_q": s(self.global_q), "parked_count": self.parked_count })
    }

    /// Per-pool checks: token custody matches the reserve (plus owed), and k never fell below the opening k.
    pub fn pool_invariants(&self, launch_id: U64) -> Value {
        let Some(p) = self.pools.get(&launch_id.0) else { return Value::Null };
        let tok_ok = self.custody_of(&p.token) == p.t + self.owed_total_of(&p.token);
        json!({ "token_custody_identity": tok_ok, "k_ge_k0": p.reserves().k() >= Reserves { q: p.q0, t: p.t0 }.k() })
    }
}
