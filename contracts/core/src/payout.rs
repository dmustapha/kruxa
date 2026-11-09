use crate::ContractExt;
use kruxa_logic::RuleCode;
use kruxa_math::{dec, linear_unlocked};
use near_sdk::json_types::U128;
use near_sdk::{env, near, Promise, PromiseOrValue};

use crate::events::emit;
use crate::ext::{ext_ft, ext_intents};
use crate::model::*;
use crate::{fail, Contract, GAS_CB, GAS_OUT, ONE_YOCTO};
use near_sdk::serde_json::json;

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutKind {
    RefundNative,
    RefundIntents,
    LaunchFee,
    Stream,
    RelayFee,
    Consolidate,
    Claim,
    /// token_claims.rs: creator allocation claim and `sweep_tokens` legs.
    AllocClaim,
    Sweep,
}

/// Everything a callback needs to undo or confirm one outbound leg. Debit happened before the call.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PayoutOp {
    pub kind: PayoutKind,
    #[serde(with = "dec::u64")]
    pub launch_id: u64,
    pub holder: Option<String>,
    #[serde(with = "dec::u128")]
    pub amount: u128,
}

#[near]
impl Contract {
    /// Pull-based refund. Permissionless: the destination is fixed by the position, so a keeper can push everyone's refund.
    pub fn claim_refund(&mut self, launch_id: U64Arg, holder: Option<String>) -> PromiseOrValue<bool> {
        self.require_exit_open();
        let id = launch_id.0;
        let holder = match holder {
            Some(s) => HolderId::parse(&s).unwrap_or_else(|| fail(RuleCode::RNoPosition, "holder must be near:<account> or sol:<base58>")),
            None => HolderId::Near(env::predecessor_account_id()),
        };
        let (mut st, ch) = (self.state(id), self.charter(id));
        if matches!(st.status, Status::Passed | Status::Failed(_)) {
            self.settle_position_inner(&ch, &mut st, &holder);
            self.save_state(id, st);
        }
        PromiseOrValue::Value(self.pay_due(id, &holder))
    }

    /// Delivers sale tokens plus the vested part of the backer bonus to a NEAR holder. Attach 1 yocto, or 0.00125 NEAR plus 1 yocto when
    /// the holder is not yet registered on the launch token (NEP-145): core then registers the holder and refunds everything above that.
    /// A failed step restores `claimed` and refunds the deposit. The bonus stops at the sweep window (`sweep_tokens` releases the rest).
    #[payable]
    pub fn claim_tokens(&mut self, launch_id: U64Arg) -> Promise {
        let deposit = Self::attached_for_delivery();
        self.require_exit_open();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        let claimant = env::predecessor_account_id();
        let holder = HolderId::Near(claimant.clone());
        if st.status != Status::Passed {
            fail(RuleCode::RWrongPhase, "tokens exist only after PASS");
        }
        self.settle_position_inner(&ch, &mut st, &holder);
        let Some(mut pos) = self.positions.get(&(id, holder.clone())).cloned() else { fail(RuleCode::RNoPosition, "no position") };
        let s = st.settlement.clone().expect("Passed has a settlement");
        let vest_ns = kruxa_math::days_to_ns(ch.rules.backer_vest_days as u64).unwrap_or(0);
        let now = env::block_timestamp();
        let bonus = if now >= crate::token_claims::bonus_sweep_at(&ch, &s) {
            0
        } else {
            linear_unlocked(pos.bonus_entitled, s.settled_at, vest_ns, now).unwrap_or(0)
        };
        let amount = (pos.tokens_entitled + bonus).saturating_sub(pos.claimed);
        if amount == 0 {
            fail(RuleCode::RNothing, "nothing claimable yet");
        }
        if pos.claimed == 0 {
            st.ledger.unclaimed_sale_total -= pos.tokens_entitled;
        }
        st.ledger.claimed_total += amount;
        pos.claimed += amount;
        pos.claim_inflight += amount;
        self.positions.insert((id, holder.clone()), pos);
        self.save_state(id, st.clone());
        let token = st.token.clone().expect("Passed launches have a token");
        let op = PayoutOp { kind: PayoutKind::Claim, launch_id: id, holder: Some(holder.key()), amount };
        emit("tokens_claimed", json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": amount.to_string() }));
        let d = crate::token_claims::Delivery { op, receiver: claimant.clone(), payer: claimant, deposit: U128(deposit) };
        self.begin_delivery(token, d)
    }

    /// Moves settled Intents-held proceeds to native USDC so the fee, stream and LP buckets can be paid. Debit first.
    pub fn consolidate(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        self.require_buckets_ready(&st);
        let amount = st.ledger.spent_intents - st.ledger.consolidated - st.ledger.consolidating;
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no settled Intents proceeds to move");
        }
        st.ledger.consolidating += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::Consolidate, launch_id: id, holder: None, amount };
        ext_intents::ext(self.cfg.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(near_sdk::Gas::from_tgas(100))
            .ft_withdraw(self.cfg.usdc.clone(), env::current_account_id(), U128(amount), None, None)
            .then(self.callback(op))
    }

    /// Launch fee to the treasury. Permissionless; limited by funds actually held natively.
    pub fn pay_launch_fee(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        self.require_buckets_ready(&st);
        let l = &st.ledger;
        let amount = (l.launch_fee_due - l.launch_fee_paid - l.launch_fee_inflight).min(Self::native_free(l));
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no launch fee payable yet (consolidate first)");
        }
        st.ledger.launch_fee_inflight += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::LaunchFee, launch_id: id, holder: None, amount };
        ext_ft::ext(self.cfg.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(self.cfg.treasury.clone(), U128(amount), None)
            .then(self.callback(op))
    }

    /// Stream-lite: the creator's proceeds unlock linearly from PASS. Drawing more than elapsed x rate panics with STREAM_CAP.
    pub fn draw(&mut self, launch_id: U64Arg, amount: Option<U128>) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        self.require_buckets_ready(&st);
        if env::predecessor_account_id() != ch.stream_recipient {
            fail(RuleCode::RNotAuthorized, "stream recipient only");
        }
        let s = st.settlement.clone().expect("Passed has a settlement");
        let cap = self.stream_cap(&st, &ch, s.settled_at, env::block_timestamp());
        let drawable = cap.saturating_sub(st.ledger.stream_drawn + st.ledger.stream_inflight);
        let want = amount.map(|a| a.0).unwrap_or(drawable);
        if want > drawable {
            env::panic_str(&format!("STREAM_CAP: requested {} > drawable {}", want, drawable));
        }
        if want == 0 || want > Self::native_free(&st.ledger) {
            fail(RuleCode::RNothingFree, "nothing drawable or funds not consolidated");
        }
        st.ledger.stream_inflight += want;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::Stream, launch_id: id, holder: None, amount: want };
        ext_ft::ext(self.cfg.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(ch.stream_recipient, U128(want), None)
            .then(self.callback(op))
    }

    /// Relay fees (R2) are not principal: they go to relay-fees.kruxa.near out of core's Intents balance.
    pub fn pay_relay_fees(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        let amount = st.ledger.relay_fee_total - st.ledger.relay_fee_paid - st.ledger.relay_fee_inflight;
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no relay fees accrued");
        }
        st.ledger.relay_fee_inflight += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::RelayFee, launch_id: id, holder: None, amount };
        ext_intents::ext(self.cfg.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .mt_transfer(self.cfg.relay_fees.clone(), self.cfg.usdc_token_id.clone(), U128(amount), None, None)
            .then(self.callback(op))
    }

    /// Callback for every outbound leg. Tiny, never panics on user data, idempotent through the debit/credit counters.
    #[private]
    pub fn on_payout(&mut self, op: PayoutOp) {
        let ok = env::promise_result_checked(0, 1 << 16).is_ok();
        if matches!(op.kind, PayoutKind::Claim | PayoutKind::AllocClaim | PayoutKind::Sweep) {
            return self.settle_token_leg(op, ok);
        }
        self.apply_payout(op, ok);
    }

    /// The resolution itself, shared with `force_resolve_op` and the refund-route callback (not exported: not `pub`).
    pub(crate) fn apply_payout(&mut self, op: PayoutOp, ok: bool) {
        let Some(mut st) = self.states.get(&op.launch_id).cloned() else { return };
        let a = op.amount;
        let holder = op.holder.as_deref().and_then(HolderId::parse);
        let mut pos = holder.as_ref().and_then(|h| self.positions.get(&(op.launch_id, h.clone())).cloned());
        let l = &mut st.ledger;
        match (op.kind, ok) {
            (PayoutKind::RefundNative, true) => {
                l.inflight_native = l.inflight_native.saturating_sub(a);
                l.refunded += a;
                self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                pos.iter_mut().for_each(|p| {
                    p.inflight_native = p.inflight_native.saturating_sub(a);
                    p.refunded += a;
                });
            }
            (PayoutKind::RefundIntents, true) => {
                l.inflight_intents = l.inflight_intents.saturating_sub(a);
                l.refunded += a;
                self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                pos.iter_mut().for_each(|p| {
                    p.inflight_intents = p.inflight_intents.saturating_sub(a);
                    p.refunded += a;
                });
            }
            (PayoutKind::RefundNative, false) => {
                l.inflight_native = l.inflight_native.saturating_sub(a);
                l.due_native += a;
                pos.iter_mut().for_each(|p| {
                    p.inflight_native = p.inflight_native.saturating_sub(a);
                    p.due_native += a;
                });
            }
            (PayoutKind::RefundIntents, false) => {
                l.inflight_intents = l.inflight_intents.saturating_sub(a);
                l.due_intents += a;
                pos.iter_mut().for_each(|p| {
                    p.inflight_intents = p.inflight_intents.saturating_sub(a);
                    p.due_intents += a;
                });
            }
            (PayoutKind::LaunchFee, ok) => {
                l.launch_fee_inflight = l.launch_fee_inflight.saturating_sub(a);
                if ok {
                    l.launch_fee_paid += a;
                    self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                }
            }
            (PayoutKind::Stream, ok) => {
                l.stream_inflight = l.stream_inflight.saturating_sub(a);
                if ok {
                    l.stream_drawn += a;
                    self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                }
            }
            (PayoutKind::RelayFee, ok) => {
                l.relay_fee_inflight = l.relay_fee_inflight.saturating_sub(a);
                if ok {
                    l.relay_fee_paid += a;
                }
            }
            (PayoutKind::Consolidate, ok) => {
                l.consolidating = l.consolidating.saturating_sub(a);
                if ok {
                    l.consolidated += a;
                }
            }
            (PayoutKind::Claim | PayoutKind::AllocClaim | PayoutKind::Sweep, _) => {}
        }
        if let (Some(h), Some(p)) = (holder.as_ref(), pos) {
            self.positions.insert((op.launch_id, h.clone()), p);
            self.try_delete_position(&mut st, op.launch_id, h);
        }
        emit(
            "payout_resolved",
            json!({ "launch_id": op.launch_id.to_string(), "kind": format!("{:?}", op.kind), "amount": a.to_string(), "ok": ok }),
        );
        self.save_state(op.launch_id, st);
    }
}

pub type U64Arg = near_sdk::json_types::U64;

impl Contract {
    pub(crate) fn callback(&self, op: PayoutOp) -> Promise {
        Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_payout(op)
    }

    pub(crate) fn require_buckets_ready(&self, st: &LaunchState) {
        if st.halted {
            fail(RuleCode::RHalted, "launch is halted; exits stay open");
        }
        if st.status != Status::Passed || st.positions_unsettled != 0 || !st.residue_swept {
            fail(RuleCode::RNotClear, "needs Passed, every position settled and sweep_residue done");
        }
    }

    /// Native USDC that belongs to the fee and stream buckets (the LP bucket stays untouched).
    fn native_free(l: &Ledger) -> u128 {
        let held = l.spent_native + l.consolidated;
        let reserved = l.lp_seed_due
            + l.lp_seed_inflight
            + l.lp_seed_sent
            + l.launch_fee_paid
            + l.launch_fee_inflight
            + l.stream_drawn
            + l.stream_inflight;
        held.saturating_sub(reserved)
    }

    /// Debit first (due -> in_flight), then one outbound leg per custody. Each leg has its own callback, which re-credits on failure.
    /// Returns whether anything was sent. The legs are scheduled and NOT joined into the return value: a joint promise cannot be
    /// returned from a method (the runtime refuses it), which used to make every exit of a holder with both a native and an Intents leg fail.
    pub(crate) fn pay_due(&mut self, id: u64, holder: &HolderId) -> bool {
        let key = (id, holder.clone());
        let Some(mut pos) = self.positions.get(&key).cloned() else { return false };
        let (dn, di) = (pos.due_native, pos.due_intents);
        if dn + di == 0 {
            return false;
        }
        let mut st = self.state(id);
        pos.due_native = 0;
        pos.due_intents = 0;
        pos.inflight_native += dn;
        pos.inflight_intents += di;
        let l = &mut st.ledger;
        l.due_native -= dn;
        l.due_intents -= di;
        l.inflight_native += dn;
        l.inflight_intents += di;
        self.positions.insert(key, pos);
        self.save_state(id, st);
        if let (true, HolderId::Near(account)) = (dn > 0, holder) {
            let op = PayoutOp { kind: PayoutKind::RefundNative, launch_id: id, holder: Some(holder.key()), amount: dn };
            let _ = (ext_ft::ext(self.cfg.usdc.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_OUT)
                .ft_transfer(account.clone(), U128(dn), None)
                .then(self.callback(op)),);
        }
        if di > 0 {
            let op = PayoutOp { kind: PayoutKind::RefundIntents, launch_id: id, holder: Some(holder.key()), amount: di };
            let _ = (ext_intents::ext(self.cfg.intents.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_OUT)
                .mt_transfer(holder.intents_account(), self.cfg.usdc_token_id.clone(), U128(di), None, None)
                .then(self.callback(op)),);
        }
        true
    }
}
