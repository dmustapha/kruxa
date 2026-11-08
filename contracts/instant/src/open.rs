//! Step 3: `open_instant` hands the seed, then the pool bucket, to the market. Debit first, one leg at a time, a callback
//! that never panics and re-credits whatever the market did not consume (docs/interfaces/INSTANT-ABI.md section 4).
use crate::ext::ext_ft;
use crate::model::*;
use crate::{events::emit, fail, Launcher, LauncherExt};
use crate::{GAS_LEG, GAS_SEED_CB, GAS_STORAGE, GAS_TOKEN_CB, MARKET_STORAGE_YOCTO, ONE_YOCTO, TOKEN_REG_YOCTO};
use kruxa_logic::hex;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, NearToken, Promise};

impl Launcher {
    fn seed_msg(&self, r: &Instant) -> String {
        json!({ "v": 1, "op": "seed_quote", "launch_id": r.launch_id.to_string(), "token": r.token, "payout_recipient": r.payout_recipient,
                "creator": r.creator, "total_supply": r.derived.n_total.to_string(), "charter_hash": hex(&r.charter_hash),
                "supply_model": "near_factory_fixed", "terms": r.params.fees })
        .to_string()
    }

    /// Debit the seed, then send leg 1.
    fn send_seed_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.seed_due;
        r.seed_due = 0;
        r.seed_inflight += amount;
        self.seed_due_total -= amount;
        let usdc = self.cfg.usdc.clone();
        self.custody_sub(&usdc, amount);
        let msg = self.seed_msg(r);
        emit("instant_handoff", json!({ "launch_id": r.launch_id.to_string(), "leg": "Seed", "amount": amount.to_string(), "market": market }));
        let _ = ext_ft::ext(usdc)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_LEG)
            .ft_transfer_call(market.clone(), U128(amount), None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SEED_CB).on_instant_leg(U64(r.launch_id), Leg::Seed, U128(amount)));
    }

    /// Debit the unsent pool bucket, register the market on the token and top up its storage (once), then send leg 2.
    fn send_token_leg(&mut self, r: &mut Instant, market: &AccountId) {
        let amount = r.tokens_unsent();
        r.tokens_inflight += amount;
        self.custody_sub(&r.token.clone(), amount);
        emit("instant_handoff", json!({ "launch_id": r.launch_id.to_string(), "leg": "Token", "amount": amount.to_string(), "market": market }));
        let msg = json!({ "v": 1, "op": "open_pool_token", "launch_id": r.launch_id.to_string() }).to_string();
        if !r.market_prepared {
            r.market_prepared = true;
            let _ = Promise::new(market.clone()).transfer(NearToken::from_yoctonear(MARKET_STORAGE_YOCTO));
            let _ = ext_ft::ext(r.token.clone())
                .with_attached_deposit(NearToken::from_yoctonear(TOKEN_REG_YOCTO))
                .with_static_gas(GAS_STORAGE)
                .storage_deposit(Some(market.clone()), Some(true));
        }
        let _ = ext_ft::ext(r.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_LEG)
            .ft_transfer_call(market.clone(), U128(amount), None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_TOKEN_CB).on_instant_leg(U64(r.launch_id), Leg::Token, U128(amount)));
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
        self.require_live();
        let mut r = self.instant(launch_id.0);
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
    /// Never panics. A fully consumed seed leg sends the token leg from here (unless the launcher is paused).
    #[private]
    pub fn on_instant_leg(&mut self, launch_id: U64, leg: Leg, amount: U128) {
        let a = amount.0;
        let used = Self::consumed(env::promise_result_checked(0, 64), a);
        let Some(mut r) = self.instants.get(&launch_id.0).cloned() else { return };
        match leg {
            Leg::Seed => self.seed_leg_resolved(&mut r, a, used),
            Leg::Token => {
                r.tokens_inflight = r.tokens_inflight.saturating_sub(a);
                r.tokens_sent += used;
                self.custody_add(&r.token.clone(), a - used);
            }
        }
        emit(
            "instant_leg_resolved",
            json!({ "launch_id": r.launch_id.to_string(), "leg": format!("{:?}", leg), "amount": a.to_string(), "used": used.to_string(), "unused": (a - used).to_string() }),
        );
        self.finish_if_open(&mut r);
        if leg == Leg::Seed && r.seed_sent > 0 && r.seed_due == 0 && r.tokens_unsent() > 0 && self.pause_level() == PauseLevel::None {
            if let Some(market) = self.cfg.market.clone() {
                self.send_token_leg(&mut r, &market);
            }
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
            emit("fee_credited", json!({ "launch_id": r.launch_id.to_string(), "amount": fee.to_string() }));
        }
        if r.seed_sent > 0 && r.seed_due == 0 {
            self.seeds_held = self.seeds_held.saturating_sub(r.seed_total);
        }
    }

    fn finish_if_open(&mut self, r: &mut Instant) {
        let both = r.seed_sent == r.derived.pool_seed_q && r.seed_inflight == 0 && r.tokens_sent == r.derived.n_pool && r.tokens_inflight == 0;
        if !both || r.status == Status::Open {
            return;
        }
        r.status = Status::Open;
        r.opened_at = env::block_timestamp();
        emit(
            "instant_opened",
            json!({ "launch_id": r.launch_id.to_string(), "token": r.token, "market": self.cfg.market, "q": r.seed_sent.to_string(),
                    "t": r.tokens_sent.to_string(), "opened_at": r.opened_at.to_string() }),
        );
    }
}
