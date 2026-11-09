//! Governance with a delay and per-launch stops: the upgrade queue, `halt_launch`, `force_resolve_op`, `withdraw_owed`.
//! Nothing here can block an exit, change a verdict, or send money anywhere new.
use crate::ContractExt;
use kruxa_logic::{hex, RuleCode, DAY_NS};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

use crate::events::emit;
use crate::model::{HolderId, LaunchState, Status};
use crate::payout::{PayoutKind, PayoutOp};
use crate::{fail, Contract, GAS_CB};

/// The deployed code can change only 7 days after it was queued in public; a force-resolve waits 48 hours.
const UPGRADE_DELAY_NS: u64 = 7 * DAY_NS;
const FORCE_RESOLVE_DELAY_NS: u64 = 2 * DAY_NS;
const GAS_MIGRATE: Gas = Gas::from_tgas(30);

#[near]
impl Contract {
    /// Owner queues a code hash in public (lowercase hex sha256 of the wasm). It can be deployed 7 days later, never sooner.
    pub fn queue_upgrade(&mut self, code_hash: String) {
        self.require_owner();
        if code_hash.len() != 64 || !code_hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            fail(RuleCode::RUpgradeHash, "code_hash must be 64 lowercase hex characters (sha256)");
        }
        let at = env::block_timestamp().saturating_add(self.delay_ns(UPGRADE_DELAY_NS));
        emit("upgrade_queued", json!({ "code_hash": code_hash, "effective_at": at.to_string() }));
        self.x.upgrade = Some((code_hash, at));
    }

    /// The guardian can stop a queued upgrade; only the owner can queue one.
    pub fn cancel_upgrade(&mut self) {
        self.require_owner_or_guardian();
        let Some((code_hash, _)) = self.x.upgrade.take() else { fail(RuleCode::RNothing, "no upgrade queued") };
        emit("upgrade_cancelled", json!({ "code_hash": code_hash, "by": env::predecessor_account_id() }));
    }

    /// Owner, after the delay. The new wasm is the raw call input; it must hash to the queued value. A failed `migrate` rolls the deploy back.
    pub fn upgrade_core(&mut self) -> Promise {
        self.require_owner();
        let Some((queued, at)) = self.x.upgrade.clone() else { fail(RuleCode::RNothing, "no upgrade queued") };
        if !kruxa_logic::timelock_elapsed(at, env::block_timestamp()) {
            fail(RuleCode::RNotYet, "upgrade timelock has not elapsed");
        }
        let code = env::input().unwrap_or_default();
        if hex(&env::sha256_array(&code)) != queued {
            fail(RuleCode::RUpgradeHash, "the supplied wasm does not hash to the queued code_hash");
        }
        self.x.upgrade = None;
        emit("upgraded", json!({ "code_hash": queued }));
        Promise::new(env::current_account_id()).deploy_contract(code).function_call(
            "migrate",
            Vec::new(),
            NearToken::from_yoctonear(0),
            GAS_MIGRATE,
        )
    }

    /// Runs on the new code right after a deploy. Identity today; a layout change ships its own version of this.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        env::state_read().unwrap_or_else(|| fail(RuleCode::RWrongPhase, "no state to migrate"))
    }

    /// Owner or guardian. Stops NEW commits and the creator-side payouts of ONE launch. Walk, refunds, token claims and the
    /// verdict are untouched, so a halt can only turn a launch toward FAIL, never trap money or change a verdict that exists.
    pub fn halt_launch(&mut self, launch_id: U64, reason: String) {
        self.require_owner_or_guardian();
        let mut st = self.state(launch_id.0);
        if st.halted || matches!(st.status, Status::Dissolved | Status::CreationFailed) {
            fail(RuleCode::RNothing, "launch is already halted or finished");
        }
        st.halted = true;
        self.save_state(launch_id.0, st);
        emit("halted", json!({ "launch_id": launch_id.0.to_string(), "by": env::predecessor_account_id(), "reason": reason }));
    }

    pub fn resume_launch(&mut self, launch_id: U64) {
        self.require_owner();
        let mut st = self.state(launch_id.0);
        if !st.halted {
            fail(RuleCode::RNothing, "launch is not halted");
        }
        st.halted = false;
        self.save_state(launch_id.0, st);
        emit("resumed", json!({ "launch_id": launch_id.0.to_string() }));
    }

    /// One view for the state this module owns: the queued upgrade, a launch's halt flag, an account's owed NEAR.
    pub fn get_ops_state(&self, launch_id: Option<U64>, account_id: Option<AccountId>) -> Value {
        let halted = launch_id.and_then(|l| self.states.get(&l.0)).is_some_and(|s| s.halted);
        let owed = account_id.and_then(|a| self.x.owed_near.get(&a).copied()).unwrap_or(0);
        let upgrade = self.x.upgrade.as_ref().map(|(h, at)| json!({ "code_hash": h, "effective_at": at.to_string() }));
        json!({ "halted": halted, "owed_near": owed.to_string(), "pending_upgrade": upgrade })
    }

    /// Owner only, two steps with the SAME arguments. The first call queues the resolution of ONE stuck outbound leg (its callback
    /// never ran) in public; a call 48 hours later settles it as the receipt evidence says: `ok = true` counts it paid, `ok = false`
    /// puts it back to due for the SAME holder or bucket. It can move at most what is in flight, to no new destination, and never
    /// touches a verdict.
    pub fn force_resolve_op(&mut self, launch_id: U64, kind: PayoutKind, holder: Option<String>, amount: U128, ok: bool, evidence: String) {
        self.require_owner();
        let op = self.resolvable_op(launch_id.0, kind, holder, amount.0);
        let key = op_key(&op, ok);
        let now = env::block_timestamp();
        let Some(at) = self.x.queued_ops.get(&key).copied() else {
            let at = now.saturating_add(self.delay_ns(FORCE_RESOLVE_DELAY_NS));
            self.x.queued_ops.insert(key, at);
            emit(
                "force_resolve_queued",
                json!({ "launch_id": launch_id.0.to_string(), "amount": amount.0.to_string(), "ok": ok, "effective_at": at.to_string() }),
            );
            return;
        };
        if !kruxa_logic::timelock_elapsed(at, now) {
            fail(RuleCode::RNotYet, "force-resolve timelock has not elapsed");
        }
        self.x.queued_ops.remove(&key);
        emit(
            "op_force_resolved",
            json!({ "launch_id": launch_id.0.to_string(), "amount": amount.0.to_string(), "ok": ok, "evidence": evidence }),
        );
        self.apply_payout(op, ok);
    }

    /// Pulls NEAR that a failed push left owed to the caller (debit first, re-credited if this push fails too).
    pub fn withdraw_owed(&mut self) -> Promise {
        self.require_exit_open();
        let who = env::predecessor_account_id();
        let Some(amount) = self.x.owed_near.remove(&who) else { fail(RuleCode::RNothing, "nothing owed") };
        emit("owed_near_withdrawn", json!({ "account": who, "amount": amount.to_string() }));
        self.push_near(who, amount)
    }

    #[private]
    pub fn on_native_push(&mut self, to: AccountId, amount: U128) {
        if env::promise_result_checked(0, 16).is_err() {
            let owed = self.x.owed_near.get(&to).copied().unwrap_or(0);
            self.x.owed_near.insert(to.clone(), owed + amount.0);
            emit("owed_near_credited", json!({ "account": to, "amount": amount.0.to_string() }));
        }
    }
}

fn op_key(op: &PayoutOp, ok: bool) -> [u8; 32] {
    let mut buf = Vec::new();
    buf.extend_from_slice(&op.launch_id.to_le_bytes());
    buf.push(op.kind as u8);
    buf.extend_from_slice(&op.amount.to_le_bytes());
    buf.push(u8::from(ok));
    buf.extend_from_slice(op.holder.as_deref().unwrap_or("").as_bytes());
    env::sha256_array(&buf)
}

impl Contract {
    /// A NEAR transfer whose failure is recorded as owed to `to` instead of being lost.
    pub(crate) fn push_near(&self, to: AccountId, amount: u128) -> Promise {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_native_push(to, U128(amount)))
    }

    /// Validates a force-resolve request against what is really in flight; the refund kinds name their holder, the buckets do not.
    fn resolvable_op(&self, id: u64, kind: PayoutKind, holder: Option<String>, amount: u128) -> PayoutOp {
        let Some(st) = self.states.get(&id) else { fail(RuleCode::RNoLaunch, "launch not found") };
        let refund = matches!(kind, PayoutKind::RefundNative | PayoutKind::RefundIntents);
        let op = PayoutOp { kind, launch_id: id, holder: holder.filter(|_| refund), amount };
        if amount == 0 || amount > self.op_inflight(st, &op) {
            fail(RuleCode::RNothing, "that amount is not in flight");
        }
        op
    }

    fn op_inflight(&self, st: &LaunchState, op: &PayoutOp) -> u128 {
        let pos = op.holder.as_deref().and_then(HolderId::parse).and_then(|h| self.positions.get(&(op.launch_id, h)));
        let l = &st.ledger;
        match op.kind {
            PayoutKind::RefundNative => pos.map_or(0, |p| p.inflight_native),
            PayoutKind::RefundIntents => pos.map_or(0, |p| p.inflight_intents),
            PayoutKind::LaunchFee => l.launch_fee_inflight,
            PayoutKind::Stream => l.stream_inflight,
            PayoutKind::RelayFee => l.relay_fee_inflight,
            PayoutKind::Consolidate => l.consolidating,
            // A token leg (claim, creator allocation, sweep) is not tracked as in flight: its debit is on the token ledger, so it cannot be resolved from here.
            PayoutKind::Claim | PayoutKind::AllocClaim | PayoutKind::Sweep => 0,
        }
    }
}
