//! Refund conveniences: a keeper batch (`claim_refund_batch`) and the holder's own route to an Intents account (`set_refund_route`).
//! Both only ever pay the position's own money; nobody can pick another account's destination.
use crate::ContractExt;
use kruxa_logic::RuleCode;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, AccountId, Gas, Promise};

use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::payout::{PayoutKind, PayoutOp, U64Arg};
use crate::{fail, Contract, GAS_CB, ONE_YOCTO};

pub const MAX_BATCH: usize = 25;
/// Gas one holder can need: two legs of (transfer + callback) plus the position reads and writes.
const GAS_PER_HOLDER: Gas = Gas::from_tgas(120);
/// `ft_transfer_call` into intents.near runs a receiver call and a resolve on the token.
const GAS_ROUTE: Gas = Gas::from_tgas(120);

#[near]
impl Contract {
    /// Anyone. At most 25 holders per call, each paid exactly like `claim_refund` (destination fixed by the position), each
    /// leg with its own callback, no failure coupling. Holders without a position are skipped. The loop stops early when the
    /// attached gas cannot cover another holder, and reports how many it handled so the caller can resend the rest.
    pub fn claim_refund_batch(&mut self, launch_id: U64Arg, holders: Vec<String>) -> Value {
        self.require_exit_open();
        if holders.is_empty() || holders.len() > MAX_BATCH {
            fail(RuleCode::RBatchSize, &format!("1 to {} holders per call", MAX_BATCH));
        }
        let parsed: Vec<HolderId> = holders
            .iter()
            .map(|s| HolderId::parse(s).unwrap_or_else(|| fail(RuleCode::RNoPosition, "holders must be near:<account> or sol:<base58>")))
            .collect();
        let id = launch_id.0;
        let ch = self.charter(id);
        let (mut handled, mut paid) = (0u32, 0u32);
        for h in parsed {
            if env::prepaid_gas().as_gas().saturating_sub(env::used_gas().as_gas()) < GAS_PER_HOLDER.as_gas() {
                break;
            }
            let mut st = self.state(id);
            if matches!(st.status, Status::Passed | Status::Failed(_)) {
                self.settle_position_inner(&ch, &mut st, &h);
                self.save_state(id, st);
            }
            handled += 1;
            paid += u32::from(self.pay_due(id, &h));
        }
        emit("refund_batch", json!({ "launch_id": id.to_string(), "handled": handled, "paid": paid }));
        json!({ "handled": handled, "paid": paid })
    }

    /// The holder only, for their OWN native refund: sends what is due to their account on intents.near instead of to their
    /// NEAR account (for a holder whose USDC registration is gone). Debit first; the callback re-credits whatever did not arrive.
    pub fn set_refund_route(&mut self, launch_id: U64Arg, intents_account: AccountId) -> Promise {
        self.require_exit_open();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        let holder = HolderId::Near(env::predecessor_account_id());
        if matches!(st.status, Status::Passed | Status::Failed(_)) {
            self.settle_position_inner(&ch, &mut st, &holder);
        }
        let key = (id, holder.clone());
        let Some(mut pos) = self.positions.get(&key).cloned() else { fail(RuleCode::RNoPosition, "no position") };
        let amount = pos.due_native;
        if amount == 0 {
            fail(RuleCode::RNothing, "no native refund is due");
        }
        pos.due_native = 0;
        pos.inflight_native += amount;
        st.ledger.due_native -= amount;
        st.ledger.inflight_native += amount;
        self.positions.insert(key, pos);
        self.save_state(id, st);
        emit(
            "refund_route_set",
            json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": amount.to_string(), "intents_account": intents_account }),
        );
        ext_ft::ext(self.cfg.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_ROUTE)
            .ft_transfer_call(self.cfg.intents.clone(), U128(amount), None, intents_account.to_string())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_refund_route(launch_id, holder.key(), U128(amount)))
    }

    /// `ft_transfer_call` answers with the amount the receiver used: that part is refunded, the rest goes back to `due`.
    #[private]
    pub fn on_refund_route(&mut self, launch_id: U64Arg, holder: String, amount: U128) {
        let used = match env::promise_result_checked(0, 64) {
            Ok(bytes) => serde_json::from_slice::<U128>(&bytes).map_or(0, |u| u.0.min(amount.0)),
            Err(_) => 0,
        };
        let op = |a: u128| PayoutOp { kind: PayoutKind::RefundNative, launch_id: launch_id.0, holder: Some(holder.clone()), amount: a };
        if used > 0 {
            self.apply_payout(op(used), true);
        }
        if amount.0 > used {
            self.apply_payout(op(amount.0 - used), false);
        }
    }
}
