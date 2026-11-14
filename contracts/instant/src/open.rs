//! Step 3: `open_instant` hands the seed, then the pool bucket, to the market. Debit first, one leg at a time, a callback
//! that never panics and re-credits whatever the market did not consume (docs/interfaces/INSTANT-ABI.md section 4).
use crate::events::{emit, Obj};
use crate::ext::ext_ft;
use crate::ext::{ext_market, PoolView};
use crate::model::*;
use crate::{fail, Launcher, LauncherExt};
use crate::{
    GAS_LEG, GAS_RECONCILE_CB, GAS_RECONCILE_VIEW, GAS_SEED_CB, GAS_STORAGE, GAS_TOKEN_CB, MARKET_STORAGE_YOCTO, MIN_OPEN_GAS,
    NEED_FOR_TOKEN_LEG, ONE_YOCTO, SEC_NS, TOKEN_REG_YOCTO,
};
use kruxa_logic::hex;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, is_promise_success, near, AccountId, Gas, NearToken, Promise};

/// The seed callback may create the token leg only with `NEED_FOR_TOKEN_LEG` still unspent (prepaid minus used so far).
pub(crate) fn enough_gas_for_token_leg(prepaid: Gas, used: Gas) -> bool {
    prepaid.saturating_sub(used) >= NEED_FOR_TOKEN_LEG
}

impl Launcher {
    fn seed_msg(&self, r: &Instant, trade_from_ns: u64) -> String {
        Obj::new()
            .n("v", 1)
            .s("op", "seed_quote")
            .s("launch_id", r.launch_id)
            .s("token", &r.token)
            .s("payout_recipient", &r.payout_recipient)
            .s("creator", &r.creator)
            .s("total_supply", r.derived.n_total)
            .s("charter_hash", hex(&r.charter_hash))
            .s("supply_model", "near_factory_fixed")
            .j("terms", &r.params.fees)
            .s("trade_from_ns", trade_from_ns)
            .finish()
    }

    /// Announced open: `trade_delay_secs` after this seed leg is sent (0 = trading opens with the pool). A re-sent seed leg
    /// announces afresh; the token leg never changes it.
    fn announce_open(&mut self, id: u64) -> u64 {
        let delay = self.trade_delay_of(id) as u64;
        let from = if delay == 0 { 0 } else { env::block_timestamp().saturating_add(delay * SEC_NS) };
        self.set_trade_from(id, from);
        from
    }

    /// Debit the seed, then send leg 1.
    fn send_seed_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.seed_due;
        r.seed_due = 0;
        r.seed_inflight += amount;
        r.inflight_since = env::block_timestamp();
        r.leg_nonce += 1;
        self.seed_due_total -= amount;
        let usdc = self.cfg.usdc.clone();
        self.custody_sub(&usdc, amount);
        let trade_from = self.announce_open(r.launch_id);
        let msg = self.seed_msg(r, trade_from);
        emit("instant_handoff", Obj::new().s("launch_id", r.launch_id).s("leg", "Seed").s("amount", amount).s("market", market));
        let _ = ext_ft::ext(usdc)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_LEG)
            .ft_transfer_call(market.clone(), U128(amount), None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SEED_CB).on_instant_leg(
                U64(r.launch_id),
                Leg::Seed,
                U128(amount),
                U64(r.leg_nonce),
            ));
    }

    /// Debit the unsent pool bucket, register the market on the token and top up its storage (once), then send leg 2.
    fn send_token_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.tokens_unsent();
        r.tokens_inflight += amount;
        r.inflight_since = env::block_timestamp();
        r.leg_nonce += 1;
        self.custody_sub(&r.token.clone(), amount);
        emit("instant_handoff", Obj::new().s("launch_id", r.launch_id).s("leg", "Token").s("amount", amount).s("market", market));
        let msg = Obj::new().n("v", 1).s("op", "open_pool_token").s("launch_id", r.launch_id).finish();
        if !r.market_prepared {
            r.market_prepared = true;
            let _ = Promise::new(market.clone()).transfer(NearToken::from_yoctonear(MARKET_STORAGE_YOCTO));
        }
        // Every attempt registers the market again: NEP-145 returns the deposit when it is already registered, so a retry
        // after a refused token leg can never be stuck behind a failed first registration. The leg waits for it (`.then`).
        let register = ext_ft::ext(r.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(TOKEN_REG_YOCTO))
            .with_static_gas(GAS_STORAGE)
            .storage_deposit(Some(market.clone()), Some(true));
        let leg = ext_ft::ext(r.token.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(GAS_LEG).ft_transfer_call(
            market.clone(),
            U128(amount),
            None,
            msg,
        );
        let _ = register.then(leg).then(Self::ext(env::current_account_id()).with_static_gas(GAS_TOKEN_CB).on_instant_leg(
            U64(r.launch_id),
            Leg::Token,
            U128(amount),
            U64(r.leg_nonce),
        ));
    }

    /// What the market consumed of a leg, from the callback's single promise result. Success is the promise STATUS alone:
    /// the length of the answer decides nothing (review N-05). A failed leg or an answer that is not a NEP-141 amount tells us
    /// nothing about what the market did, so it is `None` (booked as nothing moved, but left reconcilable).
    fn leg_used(amount: u128) -> Option<u128> {
        if !is_promise_success() {
            return None;
        }
        let bytes = env::promise_result_checked(0, 64).ok()?;
        near_sdk::serde_json::from_slice::<U128>(&bytes).ok().map(|u| u.0.min(amount))
    }
}

#[near]
impl Launcher {
    /// ANY caller, after the seed. Sends one leg: the seed, or the pool bucket once the seed was consumed. Returns 1.
    pub fn open_instant(&mut self, launch_id: U64) -> u8 {
        // Fail fast, before any state change: with less gas the seed callback could not send the token leg (review C-01).
        if env::prepaid_gas() < MIN_OPEN_GAS {
            fail("R_GAS", "attach at least 255 Tgas to open_instant (300 recommended)");
        }
        let mut r = self.instant(launch_id.0);
        // Only NEW risk waits for unpause: once the market consumed the seed, finishing the token leg is not new risk (review L-03).
        if r.seed_sent > 0 {
            self.require_exit_open();
        } else {
            self.require_live();
        }
        if !matches!(r.status, Status::Seeded | Status::Handoff) {
            fail("R_INSTANT_STATE", "launch has no seed to hand over or is already open");
        }
        let Some(market) = self.cfg.market.clone() else { fail("R_NO_MARKET", "market account not set") };
        let seed_done = r.seed_due == 0 && r.seed_inflight == 0 && r.seed_sent > 0;
        if r.seed_due > 0 && r.seed_inflight == 0 {
            self.send_seed_leg(&mut r, &market);
        } else if seed_done && r.tokens_inflight == 0 && r.tokens_unsent() > 0 {
            self.send_token_leg(&mut r, &market);
        } else {
            fail("R_INSTANT_STATE", "nothing to send, or a leg is still in flight");
        }
        r.status = Status::Handoff;
        self.cfg.market_locked = true;
        self.save(r);
        1
    }

    /// Resolves one leg. `used` is what the market consumed (NEP-141 result); a failed or unreadable answer books nothing as
    /// moved but leaves the leg `unconfirmed`, so `reconcile` can still find a seed the market did consume (review N-05).
    /// Never panics. A callback whose `nonce` is not the launch's current one belongs to a leg that `reconcile` already settled
    /// (review N-01). A fully consumed seed leg sends the token leg from here, but ONLY if enough gas is left for it: the
    /// callback must never fail after the seed was taken, and a skipped token leg is simply sent by the next `open_instant`.
    #[private]
    pub fn on_instant_leg(&mut self, launch_id: U64, leg: Leg, amount: U128, nonce: U64) {
        let a = amount.0;
        let reported = Self::leg_used(a);
        let Some(mut r) = self.instants.get(&launch_id.0) else { return };
        let inflight = if leg == Leg::Seed { r.seed_inflight } else { r.tokens_inflight };
        if r.leg_nonce != nonce.0 || inflight < a {
            return; // already resolved by `reconcile`
        }
        self.apply_leg(&mut r, leg, a, reported.unwrap_or(0), reported.is_none());
        let can_send = enough_gas_for_token_leg(env::prepaid_gas(), env::used_gas()) && self.pause_level() != PauseLevel::Frozen;
        if leg == Leg::Seed && r.seed_sent > 0 && r.seed_due == 0 && r.tokens_unsent() > 0 && can_send {
            if let Some(market) = self.cfg.market.clone() {
                self.send_token_leg(&mut r, &market);
            }
        }
        self.save(r);
    }

    fn apply_leg(&mut self, r: &mut Instant, leg: Leg, a: u128, used: u128, unreadable: bool) {
        match leg {
            Leg::Seed => self.seed_leg_resolved(r, a, used),
            Leg::Token => {
                r.tokens_inflight = r.tokens_inflight.saturating_sub(a);
                r.tokens_sent += used;
                self.custody_add(&r.token.clone(), a - used);
            }
        }
        if r.seed_inflight == 0 && r.tokens_inflight == 0 {
            r.inflight_since = 0;
        }
        if used > 0 && r.unconfirmed == Unconfirmed::of(leg) {
            Self::clear_unconfirmed(r); // a consumed re-send proves the earlier unreadable one moved nothing
        } else if unreadable && used == 0 {
            r.unconfirmed = Unconfirmed::of(leg);
            r.unconfirmed_amount = a;
        }
        let name = if leg == Leg::Seed { "Seed" } else { "Token" };
        emit(
            "instant_leg_resolved",
            Obj::new().s("launch_id", r.launch_id).s("leg", name).s("amount", a).s("used", used).s("unused", a - used),
        );
        self.finish_if_open(r);
    }

    /// Permissionless recovery. Two cases: a leg that stayed in flight for five minutes (its callback never landed), or a leg
    /// booked as nothing-moved because its answer was unreadable (`unconfirmed`, no waiting). Asks the market what it holds for
    /// this launch id: ids at or above 1e9 can only come from this launcher, and the market refuses a duplicate, so a pool
    /// for the id means the seed was consumed; a pool in state `Open` means the token leg was too. The view is stamped with
    /// the launch's leg nonce; if a newer leg is sent before the answer lands, the answer is dropped.
    pub fn reconcile(&mut self, launch_id: U64) -> Promise {
        let r = self.instant(launch_id.0);
        let in_flight = r.seed_inflight > 0 || r.tokens_inflight > 0;
        if !in_flight && r.unconfirmed == Unconfirmed::No {
            fail("R_INSTANT_STATE", "no leg is in flight or unconfirmed");
        }
        if in_flight && env::block_timestamp() < r.inflight_since + self.cfg.unit_ns / 288 {
            fail("R_TOO_EARLY", "wait five minutes after the leg was sent");
        }
        let Some(market) = self.cfg.market.clone() else { fail("R_NO_MARKET", "market account not set") };
        ext_market::ext(market)
            .with_static_gas(GAS_RECONCILE_VIEW)
            .get_pool(launch_id)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RECONCILE_CB).on_reconcile(launch_id, U64(r.leg_nonce)))
    }

    /// Books what the market reported, but only if no newer leg was sent since the view was requested (`nonce`). If the view
    /// failed nothing changes and `reconcile` can be called again.
    #[private]
    pub fn on_reconcile(&mut self, launch_id: U64, nonce: U64) {
        let Ok(bytes) = env::promise_result_checked(0, 8192) else { return };
        let Ok(pool) = near_sdk::serde_json::from_slice::<Option<PoolView>>(&bytes) else { return };
        let Some(mut r) = self.instants.get(&launch_id.0) else { return };
        if r.leg_nonce != nonce.0 {
            return; // a newer leg is out: this view describes the market before it
        }
        let seed_held = pool.as_ref().is_some_and(|p| p.token == r.token);
        let pool_open = seed_held && pool.as_ref().is_some_and(|p| p.state == "Open");
        let seed_in = r.seed_inflight;
        if seed_in > 0 {
            self.apply_leg(&mut r, Leg::Seed, seed_in, if seed_held { seed_in } else { 0 }, false);
        }
        let tok_in = r.tokens_inflight;
        if tok_in > 0 {
            self.apply_leg(&mut r, Leg::Token, tok_in, if pool_open { tok_in } else { 0 }, false);
        }
        self.settle_unconfirmed(&mut r, seed_held, pool_open);
        self.save(r);
    }

    fn clear_unconfirmed(r: &mut Instant) {
        r.unconfirmed = Unconfirmed::No;
        r.unconfirmed_amount = 0;
    }

    /// The market's answer for a leg that was booked as nothing moved: if it did consume the leg, move the amount from
    /// "ours again" to "sent" (review N-05). Either way the question is answered, so the mark goes.
    fn settle_unconfirmed(&mut self, r: &mut Instant, seed_held: bool, pool_open: bool) {
        let a = r.unconfirmed_amount;
        let consumed = match r.unconfirmed {
            Unconfirmed::No => return,
            Unconfirmed::Seed => seed_held && r.seed_sent == 0 && r.seed_due >= a && r.seed_inflight == 0,
            Unconfirmed::Token => pool_open && r.tokens_inflight == 0 && r.tokens_sent + a <= r.derived.n_pool,
        };
        let leg = if r.unconfirmed == Unconfirmed::Seed { Leg::Seed } else { Leg::Token };
        Self::clear_unconfirmed(r);
        if !consumed {
            return;
        }
        if leg == Leg::Seed {
            r.seed_due -= a;
            r.seed_sent += a;
            self.seed_due_total -= a;
            let usdc = self.cfg.usdc.clone();
            self.custody_sub(&usdc, a);
            self.seed_consumed(r);
        } else {
            r.tokens_sent += a;
            self.custody_sub(&r.token.clone(), a);
        }
        let name = if leg == Leg::Seed { "Seed" } else { "Token" };
        emit("instant_leg_reconciled", Obj::new().s("launch_id", r.launch_id).s("leg", name).s("amount", a));
        self.finish_if_open(r);
    }

    fn seed_leg_resolved(&mut self, r: &mut Instant, a: u128, used: u128) {
        r.seed_inflight = r.seed_inflight.saturating_sub(a);
        r.seed_sent += used;
        r.seed_due += a - used;
        self.seed_due_total += a - used;
        let usdc = self.cfg.usdc.clone();
        self.custody_add(&usdc, a - used);
        self.seed_consumed(r);
    }

    /// Once the market holds the whole seed: the launch fee is earned and the seed leaves the aggregate cap count.
    fn seed_consumed(&mut self, r: &mut Instant) {
        if r.seed_sent > 0 && r.seed_due == 0 && r.fee_held > 0 {
            let fee = std::mem::take(&mut r.fee_held);
            self.fee_held_total -= fee;
            self.platform_unpaid += fee;
            emit("fee_credited", Obj::new().s("launch_id", r.launch_id).s("amount", fee));
        }
        if r.seed_sent > 0 && r.seed_due == 0 {
            self.seeds_held = self.seeds_held.saturating_sub(r.seed_total);
        }
    }

    fn finish_if_open(&mut self, r: &mut Instant) {
        let both =
            r.seed_sent == r.derived.pool_seed_q && r.seed_inflight == 0 && r.tokens_sent == r.derived.n_pool && r.tokens_inflight == 0;
        if !both || r.status == Status::Open {
            return;
        }
        r.status = Status::Open;
        r.opened_at = env::block_timestamp();
        emit(
            "instant_opened",
            Obj::new()
                .s("launch_id", r.launch_id)
                .s("token", &r.token)
                .opt("market", self.cfg.market.as_ref())
                .s("q", r.seed_sent)
                .s("t", r.tokens_sent)
                .s("opened_at", r.opened_at)
                .s("trade_from_ns", self.trade_from_of(r.launch_id)),
        );
    }
}
