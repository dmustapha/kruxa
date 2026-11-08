//! Money out: allocation claims, launch fees, seed and deposit refunds, owed balances.
//! Every payout debits first and pays second; a never-panicking callback turns a failed transfer into an owed balance.
use crate::events::{emit, Obj};
use crate::ext::ext_ft;
use crate::model::*;
use crate::{fail, Launcher, LauncherExt};
use crate::{ABORT_UNITS, GAS_CB, GAS_OUT, ONE_YOCTO};
use kruxa_instant::{alloc_unlocked, claimable, Schedule};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, NearToken, Promise};

impl Launcher {
    pub(crate) fn schedule(&self, r: &Instant) -> Schedule {
        let unit = self.cfg.unit_ns;
        Schedule {
            total: r.derived.n_alloc,
            opened_at: r.opened_at,
            cliff_ns: r.params.cliff_days as u64 * unit,
            vest_ns: r.params.vest_days as u64 * unit,
        }
    }

    /// `(unlocked, claimable)` now. Zero until the pool is open, and forever for a launch that never opened.
    pub(crate) fn vested(&self, r: &Instant, now: u64) -> (u128, u128) {
        if r.status != Status::Open {
            return (0, 0);
        }
        let s = self.schedule(r);
        let unlocked = alloc_unlocked(&s, now).unwrap_or(0);
        (unlocked, claimable(&s, r.claimed, now).unwrap_or(0))
    }

    /// Outbound `ft_transfer` plus the never-panicking callback. State was debited before this is called.
    pub(crate) fn pay_out(&self, token: &AccountId, to: &AccountId, amount: u128, reason: &str) -> Promise {
        ext_ft::ext(token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(to.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).resolve_payout(
                token.clone(),
                to.clone(),
                U128(amount),
                reason.to_string(),
            ))
    }
}

#[near]
impl Launcher {
    /// Callback of every token payout. Never panics: a failed `ft_transfer` becomes an owed balance.
    #[private]
    pub fn resolve_payout(&mut self, token: AccountId, account: AccountId, amount: U128, reason: String) -> U128 {
        if env::promise_result_checked(0, 1024).is_err() {
            self.owed_credit(&account, &token, amount.0);
            emit("owed_credited", Obj::new().s("account", &account).s("token", &token).s("amount", amount.0).s("reason", &reason));
        }
        U128(0)
    }

    /// Payout recipient only. Pays `amount` (default: everything claimable) of the vested allocation.
    /// Asking for more than `unlocked - claimed` panics `STREAM_CAP`, the same cap semantics as core `draw`.
    pub fn claim_vested(&mut self, launch_id: U64, amount: Option<U128>) -> Promise {
        self.require_exit_open();
        let mut r = self.instant(launch_id.0);
        if env::predecessor_account_id() != r.payout_recipient {
            fail("R_NOT_AUTHORIZED", "only the payout recipient can claim");
        }
        if r.status != Status::Open {
            fail("R_INSTANT_STATE", "the allocation vests only after the pool is open");
        }
        let (unlocked, can) = self.vested(&r, env::block_timestamp());
        let want = amount.map_or(can, |a| a.0);
        if want > can {
            env::panic_str(&format!("STREAM_CAP: requested {want} > claimable {can}"));
        }
        if want == 0 {
            fail("R_NOTHING_TO_CLAIM", "nothing has unlocked yet");
        }
        r.claimed += want;
        let (token, to) = (r.token.clone(), r.payout_recipient.clone());
        self.custody_sub(&token, want);
        emit(
            "alloc_claimed",
            Obj::new()
                .s("launch_id", r.launch_id)
                .s("recipient", &to)
                .s("amount", want)
                .s("claimed_total", r.claimed)
                .s("unlocked_total", unlocked),
        );
        self.save(r);
        self.pay_out(&token, &to, want, "alloc")
    }

    /// Creator, 72 h (three units) after the seed, only while the market consumed none of it (IL-8). Pays the whole seed back.
    pub fn abort_instant(&mut self, launch_id: U64) -> Promise {
        self.require_exit_open();
        let mut r = self.instant(launch_id.0);
        if env::predecessor_account_id() != r.creator {
            fail("R_NOT_AUTHORIZED", "creator only");
        }
        if !matches!(r.status, Status::Seeded | Status::Handoff) || r.seed_sent > 0 || r.seed_inflight > 0 {
            fail("R_INSTANT_STATE", "the seed is refundable only while the market consumed none of it");
        }
        if env::block_timestamp() < r.seeded_at + ABORT_UNITS * self.cfg.unit_ns {
            fail("R_TOO_EARLY", "abort is open 72 hours after the seed");
        }
        let refund = r.seed_due + r.fee_held;
        self.seed_due_total -= r.seed_due;
        self.fee_held_total -= r.fee_held;
        self.seeds_held = self.seeds_held.saturating_sub(r.seed_total);
        r.seed_due = 0;
        r.fee_held = 0;
        r.status = Status::Aborted;
        r.deposit_refundable = r.deposit_paid.saturating_sub(crate::RECORD_STORAGE_YOCTO + self.cfg.factory_deposit);
        let (usdc, to) = (self.cfg.usdc.clone(), r.creator.clone());
        self.custody_sub(&usdc, refund);
        emit(
            "instant_aborted",
            Obj::new().s("launch_id", r.launch_id).s("by", &to).s("refunded_seed", refund).s("refundable_deposit", r.deposit_refundable),
        );
        self.save(r);
        self.pay_out(&usdc, &to, refund, "seed_refund")
    }

    /// Creator. Pays the NEAR deposit back after a failed, abandoned or aborted launch.
    pub fn reclaim_deposit(&mut self, launch_id: U64) -> Promise {
        self.require_exit_open();
        let mut r = self.instant(launch_id.0);
        if env::predecessor_account_id() != r.creator {
            fail("R_NOT_AUTHORIZED", "creator only");
        }
        if !matches!(r.status, Status::CreationFailed | Status::Abandoned | Status::Aborted) {
            fail("R_INSTANT_STATE", "the deposit is refundable only after a failed, abandoned or aborted launch");
        }
        let amount = std::mem::take(&mut r.deposit_refundable);
        if amount == 0 {
            fail("R_NOTHING_TO_CLAIM", "no deposit to reclaim");
        }
        emit("deposit_reclaimed", Obj::new().s("launch_id", r.launch_id).s("to", &r.creator).s("amount", amount));
        let to = r.creator.clone();
        self.save(r);
        Promise::new(to).transfer(NearToken::from_yoctonear(amount))
    }

    /// Treasury or owner. Pays the launch fees whose seed the market consumed.
    pub fn withdraw_platform(&mut self) -> Promise {
        self.require_exit_open();
        let who = env::predecessor_account_id();
        if who != self.cfg.treasury && who != self.cfg.owner {
            fail("R_NOT_AUTHORIZED", "treasury or owner only");
        }
        let amount = std::mem::take(&mut self.platform_unpaid);
        if amount == 0 {
            fail("R_NOTHING_TO_CLAIM", "no launch fees accrued");
        }
        let (usdc, to) = (self.cfg.usdc.clone(), self.cfg.treasury.clone());
        self.custody_sub(&usdc, amount);
        emit("platform_withdrawn", Obj::new().s("to", &to).s("amount", amount));
        self.pay_out(&usdc, &to, amount, "platform")
    }

    /// Pays tokens or USDC that an outbound transfer failed to deliver. Caller only.
    pub fn claim_owed(&mut self, token_id: AccountId) -> Promise {
        self.require_exit_open();
        let who = env::predecessor_account_id();
        let amount = self.owed_of(&who, &token_id);
        if amount == 0 {
            fail("R_NOTHING_TO_CLAIM", "nothing owed");
        }
        self.owed_debit(&who, &token_id, amount);
        emit("owed_claimed", Obj::new().s("account", &who).s("token", &token_id).s("amount", amount));
        self.pay_out(&token_id, &who, amount, "owed_claim")
    }
}
