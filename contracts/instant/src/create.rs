//! Step 1: `create_instant` (gate, rules, deposit, factory token, supply verification) and the paths that end a launch before the seed.
use crate::events::{emit, Obj};
use crate::ext::ext_ft;
use crate::model::*;
use crate::LauncherExt;
use crate::{fail, Launcher};
use crate::{ABANDON_UNITS, GAS_CB, GAS_FACTORY, GAS_VIEW, INSTANT_ID_BASE, RATE_LIMIT_UNITS, RECORD_STORAGE_YOCTO};
use kruxa_instant::{derive, InstantParams, Limits, TOKEN_DECIMALS};
use kruxa_logic::hex;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, NearToken, Promise, PromiseOrValue};

impl Launcher {
    pub(crate) fn limits(&self) -> Limits {
        Limits { seed_min: self.cfg.seed_min, seed_max: self.cfg.seed_max, launch_fee: self.cfg.launch_fee }
    }

    pub(crate) fn required(&self) -> u128 {
        self.cfg.factory_deposit + RECORD_STORAGE_YOCTO + crate::TOKEN_REG_YOCTO + crate::MARKET_STORAGE_YOCTO
    }

    /// `None` when the creator may launch now, else the earliest allowed time.
    pub(crate) fn rate_limited_until(&self, creator: &AccountId, now: u64) -> Option<u64> {
        let until = self.last_launch.get(creator)?.saturating_add(RATE_LIMIT_UNITS * self.cfg.unit_ns);
        (now < until).then_some(until)
    }

    pub(crate) fn symbol_taken(&self, symbol: &str) -> bool {
        self.symbols.contains(&symbol.to_string())
    }

    pub(crate) fn symbol_reserved(&self, symbol: &str) -> bool {
        self.reserved.contains(&symbol.to_string())
    }

    fn token_account(&self, symbol: &str) -> AccountId {
        format!("{}.{}", symbol.to_ascii_lowercase(), self.cfg.factory)
            .parse()
            .unwrap_or_else(|_| fail("R_SYMBOL", "symbol does not fit an account under the factory"))
    }

    fn charter_hash(&self, r: &Instant) -> [u8; 32] {
        let c = Charter {
            launch_id: r.launch_id,
            launcher: env::current_account_id(),
            creator: r.creator.clone(),
            payout_recipient: r.payout_recipient.clone(),
            created_at: r.created_at,
            unit_ns: self.cfg.unit_ns,
            params: r.params.clone(),
            derived: r.derived.clone(),
        };
        let mut bytes = near_sdk::borsh::to_vec(&c).expect("charter serializes");
        if r.params.trade_delay_secs > 0 {
            // The delay is outside the stored record; a launch that has one commits to it here. Delay 0 and launches created
            // before the field existed hash exactly as before (`sha256(borsh(Charter))`).
            bytes.extend_from_slice(&r.params.trade_delay_secs.to_le_bytes());
        }
        env::sha256_array(bytes)
    }

    fn factory_call(&self, p: &InstantParams, supply: u128) -> Promise {
        let meta = Obj::new().s("spec", "ft-1.0.0").s("name", &p.name).s("symbol", &p.symbol).n("decimals", TOKEN_DECIMALS);
        let inner = Obj::new().s("owner_id", env::current_account_id()).s("total_supply", supply).o("metadata", meta);
        let args = Obj::new().o("args", inner).finish();
        Promise::new(self.cfg.factory.clone()).function_call(
            "create_token".to_string(),
            args.into_bytes(),
            NearToken::from_yoctonear(self.cfg.factory_deposit),
            GAS_FACTORY,
        )
    }

    fn verify_token(&self, id: u64) -> Promise {
        let token = self.instant(id).token;
        let supply = ext_ft::ext(token.clone()).with_static_gas(GAS_VIEW).ft_total_supply();
        let held = ext_ft::ext(token).with_static_gas(GAS_VIEW).ft_balance_of(env::current_account_id());
        supply.and(held).then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_instant_token_verified(U64(id)))
    }

    /// Creation ended without a usable token. The factory deposit is NEVER refunded: a failed factory batch (for example the
    /// token account already exists) sends its refund to the factory, not to the launcher, so the launcher cannot know it
    /// got the 0.06 NEAR back (review H-01). The creator gets the rest. The 24 h rate limit stays.
    fn fail_creation(&mut self, id: u64, reason: &str) {
        let mut r = self.instant(id);
        r.status = Status::CreationFailed;
        r.deposit_refundable = r.deposit_paid.saturating_sub(RECORD_STORAGE_YOCTO + self.cfg.factory_deposit);
        self.symbols.remove(&r.params.symbol);
        emit("instant_creation_failed", Obj::new().s("launch_id", id).s("code", "R_TOKEN_CREATE").s("reason", reason));
        self.save(r);
    }

    fn end_unseeded(&mut self, id: u64, by: AccountId) {
        let mut r = self.instant(id);
        if r.status != Status::TokenReady {
            fail("R_INSTANT_STATE", "only a launch with a token and no seed can be abandoned");
        }
        r.status = Status::Abandoned;
        r.deposit_refundable = r.deposit_paid.saturating_sub(RECORD_STORAGE_YOCTO + self.cfg.factory_deposit);
        emit("instant_abandoned", Obj::new().s("launch_id", id).s("by", by).s("refundable_deposit", r.deposit_refundable));
        self.save(r);
    }
}

#[near]
impl Launcher {
    /// Creator attaches at least `required_deposit()`; the excess is sent back at once.
    #[payable]
    pub fn create_instant(&mut self, params: InstantParams, payout_recipient: Option<AccountId>) -> Promise {
        self.require_live();
        let creator = env::predecessor_account_id();
        if self.cfg.creator_gate {
            fail("R_CREATOR_GATE", "instant launches are closed until open_beta");
        }
        let now = env::block_timestamp();
        if let Some(until) = self.rate_limited_until(&creator, now) {
            fail("R_RATE_LIMIT", &format!("one instant launch per account per day; next at {until}"));
        }
        if self.symbol_taken(&params.symbol) {
            fail("R_SYMBOL", "symbol already used");
        }
        if self.symbol_reserved(&params.symbol) {
            fail("R_SYMBOL_RESERVED", "symbol is reserved");
        }
        let derived = derive(&params, &self.limits()).unwrap_or_else(|v| env::panic_str(&v[0].message()));
        let (attached, need) = (env::attached_deposit().as_yoctonear(), self.required());
        if attached < need {
            fail("R_DEPOSIT", &format!("attach at least {need} yocto, got {attached}"));
        }
        let id = INSTANT_ID_BASE + self.next_id;
        self.next_id += 1;
        let payout = payout_recipient.unwrap_or_else(|| creator.clone());
        let token = self.token_account(&params.symbol);
        let mut r = Instant {
            launch_id: id,
            creator: creator.clone(),
            payout_recipient: payout.clone(),
            params: params.clone(),
            derived: derived.clone(),
            charter_hash: [0; 32],
            token,
            status: Status::Creating,
            created_at: now,
            seeded_at: 0,
            opened_at: 0,
            inflight_since: 0,
            seed_total: 0,
            seed_due: 0,
            seed_inflight: 0,
            seed_sent: 0,
            fee_held: 0,
            tokens_sent: 0,
            tokens_inflight: 0,
            claimed: 0,
            deposit_paid: need,
            deposit_refundable: 0,
            market_prepared: false,
            leg_nonce: 0,
            unconfirmed: Unconfirmed::No,
            unconfirmed_amount: 0,
        };
        r.charter_hash = self.charter_hash(&r);
        self.symbols.insert(params.symbol.clone(), 1);
        self.set_trade_delay(id, params.trade_delay_secs);
        self.index_creator(&r);
        self.last_launch.insert(creator.clone(), now);
        emit(
            "instant_created",
            Obj::new()
                .s("launch_id", id)
                .s("mode", "instant")
                .s("creator", &creator)
                .s("payout_recipient", &payout)
                .s("symbol", &params.symbol)
                .s("name", &params.name)
                .s("total_supply", derived.n_total)
                .n("token_decimals", TOKEN_DECIMALS)
                .s("creator_alloc", derived.n_alloc)
                .s("pool_tokens", derived.n_pool)
                .n("cliff_days", params.cliff_days)
                .n("vest_days", params.vest_days)
                .s("seed_q", params.seed_q)
                .n("trade_delay_secs", params.trade_delay_secs)
                .s("launch_fee", derived.launch_fee)
                .j("terms", &params.fees)
                .s("charter_hash", hex(&r.charter_hash)),
        );
        self.save(r);
        if attached > need {
            let _ = Promise::new(creator).transfer(NearToken::from_yoctonear(attached - need));
        }
        self.factory_call(&params, derived.n_total)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_instant_token_created(U64(id)))
    }

    #[private]
    pub fn on_instant_token_created(&mut self, launch_id: U64) -> PromiseOrValue<bool> {
        let id = launch_id.0;
        if self.instants.get(&id).map(|r| r.status) != Some(Status::Creating) {
            return PromiseOrValue::Value(false);
        }
        if env::promise_result_checked(0, 4096).is_err() {
            self.fail_creation(id, "factory call failed");
            return PromiseOrValue::Value(false);
        }
        PromiseOrValue::Promise(self.verify_token(id))
    }

    /// IL-1: the token exists, `ft_total_supply == n_total` AND the launcher holds all of it.
    #[private]
    pub fn on_instant_token_verified(&mut self, launch_id: U64) -> bool {
        let id = launch_id.0;
        let Some(mut r) = self.instants.get(&id) else { return false };
        if r.status != Status::Creating {
            return false;
        }
        let read = |i: u64| match env::promise_result_checked(i, 128) {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).map(|u| u.0).ok(),
            Err(_) => None,
        };
        let n = r.derived.n_total;
        if read(0) != Some(n) || read(1) != Some(n) {
            self.fail_creation(id, "token supply is not at the launcher");
            return false;
        }
        r.status = Status::TokenReady;
        self.custody_add(&r.token, n);
        emit("instant_token_ready", Obj::new().s("launch_id", id).s("token", &r.token));
        self.save(r);
        true
    }

    /// Permissionless recovery if a creation callback never ran: re-query the supply 10 minutes (one unit / 144) after create.
    pub fn finalize_creation(&mut self, launch_id: U64) -> Promise {
        let r = self.instant(launch_id.0);
        if r.status != Status::Creating {
            fail("R_INSTANT_STATE", "launch is not in Creating");
        }
        if env::block_timestamp() < r.created_at + self.cfg.unit_ns / 144 {
            fail("R_TOO_EARLY", "wait 10 minutes after create_instant");
        }
        self.verify_token(launch_id.0)
    }

    /// Ends a launch that was never seeded. The creator any time; anyone else 24 h (one unit) after creation. The token stays
    /// in the launcher forever and is never listed.
    pub fn abandon_instant(&mut self, launch_id: U64) {
        let r = self.instant(launch_id.0);
        let by = env::predecessor_account_id();
        if by != r.creator && env::block_timestamp() < r.created_at + ABANDON_UNITS * self.cfg.unit_ns {
            fail("R_TOO_EARLY", "only the creator can end a launch in its first 24 hours");
        }
        self.end_unseeded(launch_id.0, by);
    }
}
