//! Launch-token deliveries that start from a caller: the buyer claim (with in-claim NEP-145 registration), the creator allocation
//! claim (cliff, then linear) and `sweep_tokens` (unclaimed bonus, rounding dust and a dissolved launch's supply go to `burn_mode`).
//!
//! Every delivery is debit first: the counter moves before any promise, and `settle_token_leg` re-credits it when a leg fails.
//! The chain is `storage_balance_of` -> (`storage_deposit` only when the receiver is absent) -> `ft_transfer`. A failure at any hop
//! re-credits the claim and refunds the NEAR the payer attached; no callback panics, because a panic would revert the re-credit.
use crate::ContractExt;
use kruxa_logic::RuleCode;
use kruxa_math::{days_to_ns, linear_unlocked, secs_to_ns};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseOrValue};

use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::payout::{PayoutKind, PayoutOp};
use crate::{fail, Contract, GAS_CB, GAS_OUT, ONE_YOCTO, TOKEN_REG_YOCTO};

const GAS_BALANCE: Gas = Gas::from_tgas(8);
const GAS_REGISTER: Gas = Gas::from_tgas(15);
/// Budgets of the two callbacks, each covering its own work plus the calls it schedules (registration, then transfer plus `on_payout`).
const GAS_CB_BALANCE: Gas = Gas::from_tgas(80);
const GAS_CB_REGISTERED: Gas = Gas::from_tgas(55);

/// One outbound token leg: what to undo (`op`), who receives the tokens, who attached the NEAR and how much.
#[derive(Clone, Debug)]
pub struct Delivery {
    pub op: PayoutOp,
    pub receiver: AccountId,
    pub payer: AccountId,
    pub deposit: U128,
}

/// First instant at which the unclaimed backer bonus is released: bonus vest end plus the sweep window.
pub(crate) fn bonus_sweep_at(ch: &Charter, s: &Settlement) -> u64 {
    let vest = days_to_ns(ch.rules.backer_vest_days as u64).unwrap_or(0);
    s.settled_at.saturating_add(vest).saturating_add(secs_to_ns(ch.rules.bonus_sweep_after_secs).unwrap_or(0))
}

fn alloc_cliff_ends(ch: &Charter, s: &Settlement) -> u64 {
    s.settled_at.saturating_add(secs_to_ns(ch.rules.alloc_cliff_secs).unwrap_or(0))
}

fn alloc_unlocked(ch: &Charter, s: &Settlement, now: u64) -> u128 {
    let linear = secs_to_ns(ch.rules.alloc_linear_secs).unwrap_or(0);
    linear_unlocked(ch.derived.n_creator, alloc_cliff_ends(ch, s), linear, now).unwrap_or(0)
}

#[near]
impl Contract {
    /// Creator allocation (`creator_bps`): nothing before the cliff, then linear. Only the payout recipient, who also pays for its
    /// own token registration out of the NEAR attached (1 yocto minimum). Tokens go to the payout recipient.
    #[payable]
    pub fn claim_creator_alloc(&mut self, launch_id: U64) -> Promise {
        let deposit = Self::attached_for_delivery();
        self.require_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        if st.status != Status::Passed {
            fail(RuleCode::RWrongPhase, "the creator allocation exists only after PASS");
        }
        let caller = env::predecessor_account_id();
        if caller != ch.stream_recipient {
            fail(RuleCode::RNotAuthorized, "payout recipient only");
        }
        let s = st.settlement.clone().expect("Passed has a settlement");
        let amount = alloc_unlocked(&ch, &s, env::block_timestamp()).saturating_sub(st.ledger.alloc_claimed);
        if amount == 0 {
            fail(RuleCode::RNothing, "nothing vested yet (before the cliff, or already claimed)");
        }
        st.ledger.alloc_claimed += amount;
        let token = st.token.clone().expect("Passed launches have a token");
        self.save_state(id, st);
        emit("creator_alloc_claimed", json!({ "launch_id": id.to_string(), "recipient": caller, "amount": amount.to_string() }));
        let op = PayoutOp { kind: PayoutKind::AllocClaim, launch_id: id, holder: None, amount };
        self.begin_delivery(token, Delivery { op, receiver: caller.clone(), payer: caller, deposit: U128(deposit) })
    }

    /// Permissionless. Releases supply nobody is owed to `burn_mode`: on a PASSED launch the unclaimed backer bonus plus rounding dust
    /// once the bonus vest ended and the sweep window passed (never sale tokens a buyer can still claim, never the Solana-locked copy,
    /// never the creator allocation); on a DISSOLVED launch the whole supply. Never to the creator or the platform.
    #[payable]
    pub fn sweep_tokens(&mut self, launch_id: U64) -> PromiseOrValue<U128> {
        let deposit = Self::attached_for_delivery_or_zero();
        self.require_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        let amount = Self::sweepable(&ch, &st, env::block_timestamp());
        if amount == 0 {
            fail(RuleCode::RNothing, "nothing sweepable");
        }
        let payer = env::predecessor_account_id();
        let mode = self.cfg.burn_mode.clone();
        let sink = match &mode {
            BurnMode::Burn => fail(RuleCode::RBurnUnsupported, "the factory token has no ft_burn"),
            BurnMode::Hold => None,
            BurnMode::Sink(a) => Some(a.clone()),
        };
        st.ledger.swept += amount;
        let token = st.token.clone().expect("Passed and Dissolved launches have a token");
        self.save_state(id, st);
        self.cfg.burn_mode_locked = true;
        emit("tokens_swept", json!({ "launch_id": id.to_string(), "amount": amount.to_string(), "mode": mode.label(), "payer": payer }));
        let Some(receiver) = sink else {
            if deposit > 0 {
                let _ = Promise::new(payer).transfer(NearToken::from_yoctonear(deposit));
            }
            return PromiseOrValue::Value(U128(amount));
        };
        if deposit == 0 {
            fail(RuleCode::RDeposit, "attach at least 1 yocto, plus 0.00125 NEAR if the sink is not registered on the token");
        }
        let op = PayoutOp { kind: PayoutKind::Sweep, launch_id: id, holder: None, amount };
        PromiseOrValue::Promise(self.begin_delivery(token, Delivery { op, receiver, payer, deposit: U128(deposit) }))
    }

    /// OWNER. Sets what `sweep_tokens` does. `Burn` is refused (no `ft_burn` on the testnet factory token). A `Sink` may not be a
    /// Kruxa-controlled account. One shot: the first call, or the first sweep, locks it for good.
    pub fn set_burn_mode(&mut self, mode: String) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
        if self.cfg.burn_mode_locked {
            fail(RuleCode::RNothing, "burn_mode is locked");
        }
        let Some(mode) = BurnMode::parse(&mode) else { fail(RuleCode::RNothing, "mode must be hold, burn or sink:<account>") };
        match &mode {
            BurnMode::Burn => fail(RuleCode::RBurnUnsupported, "the factory token has no ft_burn; use Sink or Hold"),
            BurnMode::Sink(a) if self.is_kruxa_account(a) => fail(RuleCode::RNotAuthorized, "the sink must not be a Kruxa-controlled account"),
            _ => {}
        }
        self.cfg.burn_mode = mode;
        self.cfg.burn_mode_locked = true;
    }

    /// Callback of the delivery chain. Stage 0 answers `storage_balance_of`: register the receiver (from the payer's deposit) only when
    /// absent. Stage 1 answers `storage_deposit`: send, or undo the claim and give the deposit back.
    #[private]
    pub fn on_token_step(&mut self, op: PayoutOp, receiver: AccountId, payer: AccountId, deposit: U128, stage: u8) {
        let d = Delivery { op, receiver, payer, deposit };
        let answer = env::promise_result_checked(0, 1024);
        let Some(token) = self.state(d.op.launch_id).token else { return };
        if stage == 1 {
            match answer {
                Ok(_) => self.send_tokens(token, d),
                Err(_) => self.refuse_delivery(&d, TOKEN_REG_YOCTO, "token registration failed"),
            }
            return;
        }
        // An answer that is not a clear `null` (error, or a token without NEP-145) means: just try the transfer.
        let absent = matches!(answer, Ok(bytes) if near_sdk::serde_json::from_slice::<Value>(&bytes).is_ok_and(|v| v.is_null()));
        let reg = if absent { TOKEN_REG_YOCTO } else { 0 };
        let deposit = d.deposit.0;
        if deposit < ONE_YOCTO.as_yoctonear() + reg {
            self.refuse_delivery(&d, deposit, "receiver is not registered on the token: attach 0.00125 NEAR more");
            return;
        }
        Self::refund_payer(&d.payer, deposit - ONE_YOCTO.as_yoctonear() - reg);
        if !absent {
            self.send_tokens(token, d);
            return;
        }
        let _ = ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(TOKEN_REG_YOCTO))
            .with_static_gas(GAS_REGISTER)
            .storage_deposit(Some(d.receiver.clone()), Some(true))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_REGISTERED).on_token_step(d.op, d.receiver, d.payer, d.deposit, 1));
    }

    /// Creator allocation, token custody counters, sweep window and burn mode. `solana_claim_rent` is DECIDED, not carved: the buyer's quoted
    /// `relay_fee`, taken from the commit amount (RECONCILED R2), is the buyer-funded claim cost; core holds no 0.004 SOL deposit and the
    /// platform pays none.
    pub fn get_token_custody(&self, launch_id: U64) -> Option<Value> {
        let (st, ch) = (self.states.get(&launch_id.0)?, self.charters.get(&launch_id.0)?);
        let l = &st.ledger;
        let s = st.settlement.as_ref().filter(|s| s.pass);
        let now = env::block_timestamp();
        let unlocked = s.map_or(0, |s| alloc_unlocked(ch, s, now));
        Some(json!({
            "alloc_total": ch.derived.n_creator.to_string(), "alloc_unlocked": unlocked.to_string(), "alloc_claimed": l.alloc_claimed.to_string(),
            "alloc_cliff_ends_at": s.map(|s| alloc_cliff_ends(ch, s).to_string()),
            "claimed_total": l.claimed_total.to_string(), "unclaimed_sale_total": l.unclaimed_sale_total.to_string(),
            "solana_locked_total": l.solana_locked_total.to_string(), "swept": l.swept.to_string(),
            "sweepable_now": Self::sweepable(ch, st, now).to_string(), "sweep_at": s.map(|s| bonus_sweep_at(ch, s).to_string()),
            "burn_mode": self.cfg.burn_mode.label(), "burn_mode_locked": self.cfg.burn_mode_locked,
            "solana_claim_rent": "relay_fee_covers",
        }))
    }
}


impl Contract {
    /// The attached NEAR, at least 1 yocto (the `ft_transfer` deposit). Everything above that is the registration allowance.
    pub(crate) fn attached_for_delivery() -> u128 {
        let d = env::attached_deposit().as_yoctonear();
        if d < ONE_YOCTO.as_yoctonear() {
            fail(RuleCode::RDeposit, "attach at least 1 yocto (0.00125 NEAR more if the receiver is not registered on the token)");
        }
        d
    }

    fn attached_for_delivery_or_zero() -> u128 {
        env::attached_deposit().as_yoctonear()
    }

    fn is_kruxa_account(&self, a: &AccountId) -> bool {
        let c = &self.cfg;
        [&c.owner, &c.guardian, &c.treasury, &c.relay_fees, &env::current_account_id()].contains(&a)
            || c.market.as_ref() == Some(a)
            || c.genesis_relayer.as_ref() == Some(a)
    }

    /// Supply nobody is owed. Zero until the launch is PASSED past the sweep window with every position settled, or DISSOLVED.
    fn sweepable(ch: &Charter, st: &LaunchState, now: u64) -> u128 {
        let l = &st.ledger;
        match (&st.status, &st.settlement) {
            (Status::Dissolved, _) => ch.derived.n_total.saturating_sub(l.swept),
            (Status::Passed, Some(s)) if st.positions_unsettled == 0 && now >= bonus_sweep_at(ch, s) => {
                let owed = l.claimed_total + l.unclaimed_sale_total + l.solana_locked_total + l.swept;
                (ch.derived.n_sale + ch.derived.n_backer).saturating_sub(owed)
            }
            _ => 0,
        }
    }

    /// Promise chain start. The delivery's `op` is already debited.
    pub(crate) fn begin_delivery(&self, token: AccountId, d: Delivery) -> Promise {
        ext_ft::ext(token)
            .with_static_gas(GAS_BALANCE)
            .storage_balance_of(d.receiver.clone())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_BALANCE).on_token_step(d.op, d.receiver, d.payer, d.deposit, 0))
    }

    fn send_tokens(&self, token: AccountId, d: Delivery) {
        let amount = d.op.amount;
        let _ = ext_ft::ext(token)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(d.receiver, U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_payout(d.op));
    }

    fn refund_payer(payer: &AccountId, amount: u128) {
        if amount > 0 {
            let _ = Promise::new(payer.clone()).transfer(NearToken::from_yoctonear(amount));
        }
    }

    /// The delivery cannot proceed: undo the debit, give back `refund` yocto to the payer, say why. Never panics.
    fn refuse_delivery(&mut self, d: &Delivery, refund: u128, reason: &str) {
        self.settle_token_leg(d.op.clone(), false);
        Self::refund_payer(&d.payer, refund);
        emit(
            "token_delivery_refused",
            json!({ "launch_id": d.op.launch_id.to_string(), "kind": format!("{:?}", d.op.kind), "receiver": d.receiver, "reason": reason }),
        );
    }

    /// Resolves a token leg. `ok` confirms it; failure re-credits exactly what the debit took. Idempotent per call, never panics.
    pub(crate) fn settle_token_leg(&mut self, op: PayoutOp, ok: bool) {
        let Some(mut st) = self.states.get(&op.launch_id).cloned() else { return };
        let a = op.amount;
        match op.kind {
            PayoutKind::Claim => self.settle_position_claim(&mut st, &op, ok),
            PayoutKind::AllocClaim if !ok => st.ledger.alloc_claimed = st.ledger.alloc_claimed.saturating_sub(a),
            PayoutKind::Sweep if !ok => st.ledger.swept = st.ledger.swept.saturating_sub(a),
            _ => {}
        }
        emit("payout_resolved", json!({ "launch_id": op.launch_id.to_string(), "kind": format!("{:?}", op.kind), "amount": a.to_string(), "ok": ok }));
        self.save_state(op.launch_id, st);
    }

    fn settle_position_claim(&mut self, st: &mut LaunchState, op: &PayoutOp, ok: bool) {
        let Some(holder) = op.holder.as_deref().and_then(HolderId::parse) else { return };
        let key = (op.launch_id, holder.clone());
        let Some(mut pos) = self.positions.get(&key).cloned() else { return };
        pos.claim_inflight = pos.claim_inflight.saturating_sub(op.amount);
        if !ok {
            pos.claimed = pos.claimed.saturating_sub(op.amount);
            st.ledger.claimed_total = st.ledger.claimed_total.saturating_sub(op.amount);
            if pos.claimed == 0 {
                st.ledger.unclaimed_sale_total += pos.tokens_entitled;
            }
        }
        self.positions.insert(key, pos);
        self.try_delete_position(st, op.launch_id, &holder);
    }
}
