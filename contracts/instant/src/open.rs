//! Step 3: `open_instant` hands the seed, then the pool bucket, to the market. Debit first, one leg at a time, a callback
//! that never panics and re-credits whatever the market did not consume (docs/interfaces/INSTANT-ABI.md section 4).
use crate::events::{emit, Obj};
use crate::ext::ext_ft;
use crate::ext::{ext_market, PoolView};
use crate::model::*;
use crate::{fail, Launcher, LauncherExt};
use crate::{
    GAS_LEG, GAS_RECONCILE_CB, GAS_RECONCILE_VIEW, GAS_SEED_CB, GAS_STORAGE, GAS_TOKEN_CB, MARKET_STORAGE_YOCTO, MIN_OPEN_GAS,
    NEED_FOR_TOKEN_LEG, ONE_YOCTO, TOKEN_REG_YOCTO,
};
use kruxa_logic::hex;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, NearToken, Promise};

impl Launcher {
    fn seed_msg(&self, r: &Instant) -> String {
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
            .finish()
    }

    /// Debit the seed, then send leg 1.
    fn send_seed_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.seed_due;
        r.seed_due = 0;
        r.seed_inflight += amount;
        r.inflight_since = env::block_timestamp();
        self.seed_due_total -= amount;
        let usdc = self.cfg.usdc.clone();
        self.custody_sub(&usdc, amount);
        let msg = self.seed_msg(r);
        emit("instant_handoff", Obj::new().s("launch_id", r.launch_id).s("leg", "Seed").s("amount", amount).s("market", market));
        let _ = ext_ft::ext(usdc)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_LEG)
            .ft_transfer_call(market.clone(), U128(amount), None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SEED_CB).on_instant_leg(
                U64(r.launch_id),
                Leg::Seed,
                U128(amount),
            ));
    }

    /// Debit the unsent pool bucket, register the market on the token and top up its storage (once), then send leg 2.
    fn send_token_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.tokens_unsent();
        r.tokens_inflight += amount;
        r.inflight_since = env::block_timestamp();
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
        ));
    }

    fn consumed(read: Result<Vec<u8>, near_sdk::PromiseError>, amount: u128) -> u128 {
        match read {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).map_or(0, |u| u.0.min(amount)),
            Err(_) => 0,
        }
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

    /// Resolves one leg. `used` is what the market consumed (NEP-141 result); a failed promise means nothing moved.
    /// Never panics. A fully consumed seed leg sends the token leg from here, but ONLY if enough gas is left for it: the
    /// callback must never fail after the seed was taken, and a skipped token leg is simply sent by the next `open_instant`.
    #[private]
    pub fn on_instant_leg(&mut self, launch_id: U64, leg: Leg, amount: U128) {
        let a = amount.0;
        let used = Self::consumed(env::promise_result_checked(0, 64), a);
        let Some(mut r) = self.instants.get(&launch_id.0) else { return };
        let inflight = if leg == Leg::Seed { r.seed_inflight } else { r.tokens_inflight };
        if inflight < a {
            return; // already resolved by `reconcile`
        }
        self.apply_leg(&mut r, leg, a, used);
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        let can_send = left >= NEED_FOR_TOKEN_LEG && self.pause_level() != PauseLevel::Frozen;
        if leg == Leg::Seed && r.seed_sent > 0 && r.seed_due == 0 && r.tokens_unsent() > 0 && can_send {
            if let Some(market) = self.cfg.market.clone() {
                self.send_token_leg(&mut r, &market);
            }
        }
        self.save(r);
    }

    fn apply_leg(&mut self, r: &mut Instant, leg: Leg, a: u128, used: u128) {
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
        let name = if leg == Leg::Seed { "Seed" } else { "Token" };
        emit(
            "instant_leg_resolved",
            Obj::new().s("launch_id", r.launch_id).s("leg", name).s("amount", a).s("used", used).s("unused", a - used),
        );
        self.finish_if_open(r);
    }

    /// Permissionless recovery for a leg that stayed in flight for five minutes (its callback never landed). Asks the market
    /// what it holds for this launch id: ids at or above 1e9 can only come from this launcher, and the market refuses a
    /// duplicate, so a pool for the id means the seed was consumed; a pool in state `Open` means the token leg was too.
    pub fn reconcile(&mut self, launch_id: U64) -> Promise {
        let r = self.instant(launch_id.0);
        if r.seed_inflight == 0 && r.tokens_inflight == 0 {
            fail("R_INSTANT_STATE", "no leg is in flight");
        }
        if env::block_timestamp() < r.inflight_since + self.cfg.unit_ns / 288 {
            fail("R_TOO_EARLY", "wait five minutes after the leg was sent");
        }
        let Some(market) = self.cfg.market.clone() else { fail("R_NO_MARKET", "market account not set") };
        ext_market::ext(market)
            .with_static_gas(GAS_RECONCILE_VIEW)
            .get_pool(launch_id)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RECONCILE_CB).on_reconcile(launch_id))
    }

    /// Books what the market reported. If the view failed nothing changes and `reconcile` can be called again.
    #[private]
    pub fn on_reconcile(&mut self, launch_id: U64) {
        let Ok(bytes) = env::promise_result_checked(0, 8192) else { return };
        let Ok(pool) = near_sdk::serde_json::from_slice::<Option<PoolView>>(&bytes) else { return };
        let Some(mut r) = self.instants.get(&launch_id.0) else { return };
        let seed_in = r.seed_inflight;
        if seed_in > 0 {
            let used = if pool.as_ref().is_some_and(|p| p.token == r.token) { seed_in } else { 0 };
            self.apply_leg(&mut r, Leg::Seed, seed_in, used);
        }
        let tok_in = r.tokens_inflight;
        if tok_in > 0 {
            let used = if pool.as_ref().is_some_and(|p| p.token == r.token && p.state == "Open") { tok_in } else { 0 };
            self.apply_leg(&mut r, Leg::Token, tok_in, used);
        }
        self.save(r);
    }

    fn seed_leg_resolved(&mut self, r: &mut Instant, a: u128, used: u128) {
        r.seed_inflight = r.seed_inflight.saturating_sub(a);
        r.seed_sent += used;
        r.seed_due += a - used;
        self.seed_due_total += a - used;
        let usdc = self.cfg.usdc.clone();
        self.custody_add(&usdc, a - used);
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
                .s("opened_at", r.opened_at),
        );
    }
}
