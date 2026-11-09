use crate::ContractExt;
use kruxa_logic::{
    bond_required, check_flow, check_pass_conservation, hex, i2_position_count, i3_inputs_frozen, i4_status_monotone, i5_no_overpay,
    inputs_hash, phase_at, validate_params, BookSums, Buckets, LedgerTotals, TrialParams,
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
                "profile": c.profile, "creator_gate": c.creator_gate, "market": c.market, "genesis_relayer": c.genesis_relayer, "genesis_paused": c.genesis_paused, "global_cap": c.global_cap.to_string(), "global_held": c.global_held.to_string(), "pause": format!("{:?}", self.pause_level()),
                "pending_global_cap": c.pending_global_cap.map(|(v, t)| json!({ "value": v.to_string(), "effective_at": t.to_string() })),
                "rules": to_value(&c.rules).expect("rules serialize") })
    }

    /// The rule constants every new Charter snapshots (alias of the `rules` object in `get_config`).
    pub fn get_rule_set(&self) -> Value {
        to_value(&self.cfg.rules).expect("rules serialize")
    }

    pub fn get_charter(&self, launch_id: U64) -> Option<Value> {
        let ch = self.charters.get(&launch_id.0)?;
        Some(
            json!({ "launch_id": ch.launch_id.to_string(), "creator": ch.creator, "stream_recipient": ch.stream_recipient, "payout_recipient": ch.stream_recipient, "created_at": ch.created_at.to_string(),
                     "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string(),
                     "params": to_value(&ch.params).expect("params serialize"), "derived": to_value(&ch.derived).expect("derived serialize"),
                     "route": format!("{:?}", ch.route) }),
        )
    }

    pub fn get_state(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let phase = phase_at(env::block_timestamp(), ch.opens_at, ch.commit_end, ch.walk_end);
        Some(
            json!({ "status": format!("{:?}", st.status), "phase": format!("{:?}", phase), "token": st.token, "payout_recipient": ch.stream_recipient, "total_active": st.total_active.to_string(),
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
                     "launch_fee_due": l.launch_fee_due.to_string(), "launch_fee_paid": l.launch_fee_paid.to_string(), "lp_seed_due": l.lp_seed_due.to_string(), "lp_seed_inflight": l.lp_seed_inflight.to_string(), "lp_seed_sent": l.lp_seed_sent.to_string(),
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
        let i = st.verdict_inputs(ch);
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

    /// Stream-lite status: the unlocked cap at this block, what was drawn, what may be drawn now. Valid once the launch has PASSED.
    pub fn stream_status(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let s = st.settlement.as_ref().filter(|s| s.pass)?;
        let cap = self.stream_cap(st, ch, s.settled_at, env::block_timestamp());
        let out = st.ledger.stream_drawn + st.ledger.stream_inflight;
        Some(json!({ "recipient": ch.stream_recipient, "total": st.ledger.stream_total.to_string(), "cap": cap.to_string(),
                     "drawn": st.ledger.stream_drawn.to_string(), "inflight": st.ledger.stream_inflight.to_string(),
                     "drawable": cap.saturating_sub(out).to_string(), "starts_at": s.settled_at.to_string(),
                     "ends_at": self.stream_end(ch, s.settled_at).to_string(), "paused": self.pause_level() != PauseLevel::None }))
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
        U128(bond_required(d.max_holders) + self.cfg.factory_deposit + crate::TOKEN_REG_YOCTO)
    }

    /// Ledger identities L1, L3, L4 and I2 to I5 (S1-B 3.4). L3, I2 and I5 walk the position records, which are bounded by the holder cap.
    pub fn get_invariants(&self, launch_id: U64) -> Option<Value> {
        let (st, ch) = (self.states.get(&launch_id.0)?, self.charters.get(&launch_id.0)?);
        let l = &st.ledger;
        let totals = LedgerTotals {
            credited: l.credited,
            open: l.open_native + l.open_intents,
            due: l.due_native + l.due_intents,
            in_flight: l.inflight_native + l.inflight_intents,
            refunded: l.refunded,
            spent: l.spent_native + l.spent_intents,
        };
        let sums = self.sum_positions(launch_id.0, st);
        let l1 = check_flow(&totals);
        let l3 = sums.l3_ok.then_some(()).ok_or("L3: a position does not sum to its contribution");
        let l4 = if st.status == Status::Passed { check_pass_conservation(&sums_buckets(l), totals.open, totals.spent) } else { Ok(()) };
        let i2 = i2_position_count(&BookSums {
            verdict_reached: st.settlement.is_some(),
            total_active: st.total_active,
            active_funders: st.active_funders,
            positions_unsettled: st.positions_unsettled,
            ledger_open: totals.open,
            sum_open: sums.sum_open,
            count_open_unsettled: sums.count_open_unsettled,
        });
        let recorded = st.settlement.as_ref().map(|s| (s.total_active, s.inputs_hash));
        let i3 = i3_inputs_frozen(recorded, st.total_active, inputs_hash(&st.verdict_inputs(ch)));
        let reasons = if let Status::Failed(r) = st.status { r } else { 0 };
        let i4 = i4_status_monotone(st.status.class(), st.settlement.as_ref().map(|s| (s.pass, s.reasons)), reasons);
        let i5 = i5_no_overpay(&[
            ("position: refunded + inflight + due > contributed", sums.position_overpay, 0),
            ("position: claimed > entitled", sums.claim_overpay, 0),
            ("launch fee paid + inflight > due", l.launch_fee_paid + l.launch_fee_inflight, l.launch_fee_due),
            ("lp tokens sent + inflight > bucket", l.lp_tokens_sent + l.lp_tokens_inflight, ch.derived.n_lp),
            ("stream drawn + inflight > total", l.stream_drawn + l.stream_inflight, l.stream_total),
            ("relay fee paid + inflight > collected", l.relay_fee_paid + l.relay_fee_inflight, l.relay_fee_total),
            ("creator allocation claimed > allocation", l.alloc_claimed, ch.derived.n_creator),
            (
                "tokens claimed + swept > the pool they come from",
                l.claimed_total + l.swept,
                if st.status == Status::Dissolved { ch.derived.n_total } else { ch.derived.n_sale + ch.derived.n_backer },
            ),
        ]);
        let l6 = self.l6_counters_hold().then_some(()).ok_or("L6: solvency counters differ from the sum over launches");
        let l7 = self.l7_lock_mirror(st, ch);
        let checks = [("l1", &l1), ("l3", &l3), ("l4", &l4), ("l6", &l6), ("i2", &i2), ("i3", &i3), ("i4", &i4), ("i5", &i5), ("l7", &l7)];
        let mut out = near_sdk::serde_json::Map::new();
        for (name, r) in checks {
            out.insert(format!("{name}_ok"), json!(r.is_ok()));
            out.insert(format!("{name}_err"), json!(r.as_ref().err()));
        }
        out.insert("intents_alert".into(), json!(self.intents_alert()));
        out.insert("all_ok".into(), json!(checks.iter().all(|(_, r)| r.is_ok())));
        Some(Value::Object(out))
    }
}

/// What one pass over a launch's position records yields.
struct PositionSums {
    l3_ok: bool,
    sum_open: u128,
    count_open_unsettled: u32,
    /// Total by which positions exceed their contribution (0 when none does).
    position_overpay: u128,
    claim_overpay: u128,
}

fn sums_buckets(l: &Ledger) -> Buckets {
    Buckets {
        launch_fee_due: l.launch_fee_due,
        lp_seed_due: l.lp_seed_due + l.lp_seed_inflight + l.lp_seed_sent,
        stream_total: l.stream_total,
        excess_pool: l.excess_pool,
    }
}

impl Contract {
    /// L7' (lock-mirror): `near_circulating + sol_mint_supply == total`. Once the genesis root is ready, the Solana mint supply must equal
    /// the leaf total plus the mirrored LP bucket (what `build_spec` committed) and fit inside the supply; the NEAR copy stays locked in core.
    pub(crate) fn l7_lock_mirror(&self, st: &LaunchState, ch: &Charter) -> Result<(), &'static str> {
        let g = &st.genesis;
        if !g.root_ready {
            return Ok(());
        }
        let lp = if ch.genesis.lp_mirror_to_solana { ch.derived.n_lp } else { 0 };
        let sol = g.sol_mint_supply as u128;
        if sol != g.expected_total as u128 + lp {
            return Err("L7: Solana mint supply is not the leaf total plus the mirrored LP bucket");
        }
        let circulating = ch.derived.n_total.checked_sub(sol).ok_or("L7: Solana mint supply exceeds the total supply")?;
        (circulating + sol == ch.derived.n_total).then_some(()).ok_or("L7: near_circulating + sol_mint_supply != total")
    }

    fn sum_positions(&self, id: u64, st: &LaunchState) -> PositionSums {
        let mut s = PositionSums { l3_ok: true, sum_open: 0, count_open_unsettled: 0, position_overpay: 0, claim_overpay: 0 };
        for seq in 0..st.holder_count {
            let Some(p) = self.seq_index.get(&(id, seq)).and_then(|h| self.positions.get(&(id, h.clone()))) else { continue };
            s.l3_ok &= p.conserved();
            s.sum_open += p.open();
            s.count_open_unsettled += u32::from(p.open() > 0 && !p.settled);
            s.position_overpay += (p.refunded + p.inflight() + p.owed()).saturating_sub(p.contributed);
            s.claim_overpay += p.claimed.saturating_sub(p.tokens_entitled + p.bonus_entitled);
        }
        s
    }
}
