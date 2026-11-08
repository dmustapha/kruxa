use crate::ContractExt;
use kruxa_logic::{
    bond_required, check_flow, check_pass_conservation, hex, inputs_hash, phase_at, validate_params, Buckets, LedgerTotals, TrialParams,
    VerdictInputs,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, to_value, Value};
use near_sdk::{env, near};

use crate::model::*;
use crate::Contract;

fn pos_json(key: &str, p: &Position) -> Value {
    json!({
        "holder": key, "seq": p.seq, "deliver": p.deliver.key(),
        "contributed": p.contributed.to_string(), "open_native": p.open_native.to_string(), "open_intents": p.open_intents.to_string(),
        "due_native": p.due_native.to_string(), "due_intents": p.due_intents.to_string(),
        "inflight": p.inflight().to_string(), "refunded": p.refunded.to_string(), "spent": p.spent.to_string(),
        "tokens_entitled": p.tokens_entitled.to_string(), "bonus_entitled": p.bonus_entitled.to_string(), "claimed": p.claimed.to_string(),
        "settled": p.settled, "conserved": p.conserved(),
    })
}

#[near]
impl Contract {
    pub fn get_config(&self) -> Value {
        let c = &self.cfg;
        json!({ "owner": c.owner, "guardian": c.guardian, "treasury": c.treasury, "relay_fees": c.relay_fees, "usdc": c.usdc, "intents": c.intents, "factory": c.factory,
                "profile": c.profile, "global_cap": c.global_cap.to_string(), "global_held": c.global_held.to_string(), "pause": format!("{:?}", self.pause_level()),
                "pending_global_cap": c.pending_global_cap.map(|(v, t)| json!({ "value": v.to_string(), "effective_at": t.to_string() })),
                "rules": to_value(&c.rules).expect("rules serialize") })
    }

    pub fn get_charter(&self, launch_id: U64) -> Option<Value> {
        let ch = self.charters.get(&launch_id.0)?;
        Some(
            json!({ "launch_id": ch.launch_id.to_string(), "creator": ch.creator, "stream_recipient": ch.stream_recipient, "created_at": ch.created_at.to_string(),
                     "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string(),
                     "params": to_value(&ch.params).expect("params serialize"), "derived": to_value(&ch.derived).expect("derived serialize"),
                     "route": format!("{:?}", ch.route) }),
        )
    }

    pub fn get_state(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let phase = phase_at(env::block_timestamp(), ch.opens_at, ch.commit_end, ch.walk_end);
        Some(
            json!({ "status": format!("{:?}", st.status), "phase": format!("{:?}", phase), "token": st.token, "total_active": st.total_active.to_string(),
                     "active_funders": st.active_funders, "holder_count": st.holder_count, "positions_live": st.positions_live, "positions_unsettled": st.positions_unsettled,
                     "residue_swept": st.residue_swept, "charter_hash": hex(&st.charter_hash), "book_hash": hex(&st.book_hash), "bond": st.bond.to_string() }),
        )
    }

    pub fn get_ledger(&self, launch_id: U64) -> Option<Value> {
        let l = &self.states.get(&launch_id.0)?.ledger;
        Some(
            json!({ "credited": l.credited.to_string(), "open_native": l.open_native.to_string(), "open_intents": l.open_intents.to_string(),
                     "due_native": l.due_native.to_string(), "due_intents": l.due_intents.to_string(), "inflight_native": l.inflight_native.to_string(),
                     "inflight_intents": l.inflight_intents.to_string(), "refunded": l.refunded.to_string(), "spent_native": l.spent_native.to_string(),
                     "spent_intents": l.spent_intents.to_string(), "consolidated": l.consolidated.to_string(), "excess_pool": l.excess_pool.to_string(),
                     "launch_fee_due": l.launch_fee_due.to_string(), "launch_fee_paid": l.launch_fee_paid.to_string(), "lp_seed_due": l.lp_seed_due.to_string(),
                     "stream_total": l.stream_total.to_string(), "stream_drawn": l.stream_drawn.to_string(), "relay_fee_total": l.relay_fee_total.to_string() }),
        )
    }

    pub fn get_position(&self, launch_id: U64, holder: String) -> Option<Value> {
        let h = HolderId::parse(&holder)?;
        self.positions.get(&(launch_id.0, h)).map(|p| pos_json(&holder, p))
    }

    pub fn list_positions(&self, launch_id: U64, from_seq: u32, limit: u32) -> Vec<Value> {
        (from_seq..from_seq.saturating_add(limit.min(50)))
            .filter_map(|s| self.seq_index.get(&(launch_id.0, s)))
            .filter_map(|h| self.positions.get(&(launch_id.0, h.clone())).map(|p| pos_json(&h.key(), p)))
            .collect()
    }

    /// The exact numbers a judge feeds to the pure verdict function. Frozen once the launch is settled.
    pub fn get_verdict_inputs(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let i = VerdictInputs {
            launch_id: launch_id.0,
            charter_hash: st.charter_hash,
            total_active: st.total_active,
            active_funders: st.active_funders,
            soft_cap: ch.params.soft_cap,
            min_funders: ch.params.min_funders,
            cancelled: st.cancelled,
        };
        Some(json!({ "inputs": to_value(i).expect("inputs serialize"), "inputs_hash": hex(&inputs_hash(&i)) }))
    }

    pub fn get_settlement(&self, launch_id: U64) -> Option<Value> {
        let s = self.states.get(&launch_id.0)?.settlement.as_ref()?;
        Some(
            json!({ "pass": s.pass, "reasons": s.reasons, "settled_at": s.settled_at.to_string(), "total_active": s.total_active.to_string(), "accepted": s.accepted.to_string(),
                     "launch_fee": s.launch_fee.to_string(), "lp_quote": s.lp_quote.to_string(), "stream": s.stream.to_string(), "excess_pool": s.excess_pool.to_string(),
                     "inputs_hash": hex(&s.inputs_hash), "book_hash": hex(&s.book_hash) }),
        )
    }

    pub fn preview_contribution(&self, launch_id: U64, holder: String, amount: U128, relay_fee: Option<U128>) -> Value {
        let Some(h) = HolderId::parse(&holder) else {
            return json!({ "ok": false, "code": "R_DELIVER", "detail": "holder must be near:<account> or sol:<base58>" });
        };
        let custody = if matches!(h, HolderId::Solana(_)) { Custody::Intents } else { Custody::Native };
        match self.check_commit(launch_id.0, &h, custody, amount.0, relay_fee.map_or(0, |f| f.0)) {
            Ok(net) => json!({ "ok": true, "net": net.to_string() }),
            Err(v) => json!({ "ok": false, "code": v.code.as_str(), "detail": v.message() }),
        }
    }

    /// Exactly what create_trial will demand: position-storage bond for the validated max_holders plus the factory deposit.
    pub fn required_deposit(&self, params: TrialParams) -> U128 {
        let d = validate_params(&params, &self.cfg.rules, self.cfg.global_cap, true).unwrap_or_else(|v| env::panic_str(&v.message()));
        U128(bond_required(d.max_holders) + self.cfg.factory_deposit)
    }

    /// Ledger identities L1 and L4, evaluated on the stored counters.
    pub fn get_invariants(&self, launch_id: U64) -> Option<Value> {
        let st = self.states.get(&launch_id.0)?;
        let l = &st.ledger;
        let totals = LedgerTotals {
            credited: l.credited,
            open: l.open_native + l.open_intents,
            due: l.due_native + l.due_intents,
            in_flight: l.inflight_native + l.inflight_intents,
            refunded: l.refunded,
            spent: l.spent_native + l.spent_intents,
        };
        let l1 = check_flow(&totals);
        let l4 = if st.status == Status::Passed {
            check_pass_conservation(
                &Buckets {
                    launch_fee_due: l.launch_fee_due,
                    lp_seed_due: l.lp_seed_due,
                    stream_total: l.stream_total,
                    excess_pool: l.excess_pool,
                },
                totals.open,
                totals.spent,
            )
            .err()
        } else {
            None
        };
        Some(json!({ "l1_ok": l1.is_ok(), "l1_err": l1.err(), "l4_ok": l4.is_none(), "l4_err": l4 }))
    }
}
