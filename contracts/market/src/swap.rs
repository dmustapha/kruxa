//! `ft_on_transfer` entry: handoff legs (`seed_quote`, `open_pool_token`) and swaps (`buy`, `sell`).
//! Never panics: every refusal returns the full amount and logs a rule code.
//! State is fully updated before any outbound promise (debit-before-outbound); callbacks only restore.
use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::{Market, MarketExt, GAS_CB, GAS_OUT, MAX_PARKED, ONE_YOCTO};
use kruxa_market::{quote_buy, quote_sell, record_creator_fee, validate_market_terms, MarketError, Routing, Swap};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, log, near, AccountId, Promise, PromiseOrValue};

type Refusal = &'static str;

fn market_code(e: MarketError) -> Refusal {
    e.code()
}

#[near]
impl Market {
    /// NEP-141 receiver. Only the USDC contract (buy, seed) and the launch token of a pool (sell, token leg) can credit anything.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let outcome = match serde_json::from_str::<Msg>(&msg) {
            Ok(m) if m.v == 1 => self.dispatch(&token, sender_id, amount.0, m),
            _ => Err("R_BAD_MSG"),
        };
        match outcome {
            Ok(p) => p,
            Err(code) => {
                log!("{}: ft_on_transfer refused, full amount returned", code);
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Callback of every swap payout. Never panics: a failed `ft_transfer` turns the payout into an owed balance.
    #[private]
    pub fn resolve_payout(&mut self, token: AccountId, account: AccountId, amount: U128, reason: String) -> U128 {
        if env::promise_result_checked(0, 0).is_err() {
            self.owed_credit(&account, &token, amount.0);
            emit("owed_credited", json!({ "account": account, "token": token, "amount": amount.0.to_string(), "reason": reason }));
        }
        U128(0)
    }
}

impl Market {
    fn dispatch(&mut self, token: &AccountId, sender: AccountId, amount: u128, m: Msg) -> Result<PromiseOrValue<U128>, Refusal> {
        if amount == 0 {
            return Err("R_MIN_TRADE");
        }
        match m.op.as_str() {
            "seed_quote" => self.on_seed(token, &sender, amount, m),
            "open_pool_token" => self.on_token_leg(token, &sender, amount, m),
            "buy" => self.on_buy(token, sender, amount, m),
            "sell" => self.on_sell(token, sender, amount, m),
            _ => Err("R_BAD_MSG"),
        }
    }

    fn consumed() -> PromiseOrValue<U128> {
        PromiseOrValue::Value(U128(0))
    }

    fn on_seed(&mut self, token: &AccountId, sender: &AccountId, amount: u128, m: Msg) -> Result<PromiseOrValue<U128>, Refusal> {
        if *token != self.usdc {
            return Err("R_UNEXPECTED_TOKEN");
        }
        if *sender != self.core {
            return Err("R_NOT_AUTHORIZED");
        }
        if self.paused {
            return Err("R_PAUSED");
        }
        let id = m.launch_id.0;
        if self.pools.contains_key(&id) {
            return Err("R_DUP_LAUNCH");
        }
        let (Some(tok), Some(recipient), Some(terms)) = (m.token, m.payout_recipient, m.terms) else { return Err("R_BAD_MSG") };
        if tok == self.usdc {
            return Err("R_UNEXPECTED_TOKEN");
        }
        validate_market_terms(&terms).map_err(market_code)?;
        let pool = Pool {
            launch_id: id,
            token: tok.clone(),
            payout_recipient: recipient,
            total_supply: m.total_supply.map_or(0, |v| v.0),
            charter_hash: m.charter_hash.unwrap_or_default(),
            mint_authority: m.mint_authority,
            freeze_authority: m.freeze_authority,
            terms,
            open: false,
            q: amount,
            t: 0,
            q0: amount,
            t0: 0,
            opened_ns: 0,
            ledger: FeeLedger::default(),
            epochs: vec![],
        };
        self.global_q += amount;
        self.custody_add(token, amount);
        self.pools.insert(id, pool.clone());
        if let Some(t) = self.parked.remove(&(id, tok)) {
            self.parked_count -= 1;
            self.finish_open(pool, t);
        }
        Ok(Self::consumed())
    }

    fn on_token_leg(&mut self, token: &AccountId, sender: &AccountId, amount: u128, m: Msg) -> Result<PromiseOrValue<U128>, Refusal> {
        if *token == self.usdc {
            return Err("R_UNEXPECTED_TOKEN");
        }
        if *sender != self.core {
            return Err("R_NOT_AUTHORIZED");
        }
        if self.paused {
            return Err("R_PAUSED");
        }
        let id = m.launch_id.0;
        match self.pools.get(&id).cloned() {
            Some(pool) if pool.open => return Err("R_POOL_STATE"),
            Some(pool) if pool.token != *token => return Err("R_UNEXPECTED_TOKEN"),
            Some(pool) => {
                self.custody_add(token, amount);
                self.finish_open(pool, amount);
            }
            None => {
                if self.parked_count >= MAX_PARKED {
                    return Err("R_PARK_FULL");
                }
                if self.parked.contains_key(&(id, token.clone())) {
                    return Err("R_POOL_STATE");
                }
                self.parked.insert((id, token.clone()), amount);
                self.parked_count += 1;
                self.custody_add(token, amount);
            }
        }
        Ok(Self::consumed())
    }

    /// Both legs landed. For a parked token leg the custody was credited at parking time.
    fn finish_open(&mut self, mut pool: Pool, t: u128) {
        pool.t = t;
        pool.t0 = t;
        pool.open = true;
        pool.opened_ns = env::block_timestamp();
        emit(
            "pool_opened",
            json!({ "launch_id": pool.launch_id.to_string(), "token": pool.token, "quote": self.usdc, "q": pool.q.to_string(), "t": t.to_string(),
                    "payout_recipient": pool.payout_recipient, "opened_ns": pool.opened_ns.to_string(), "fee_bps": pool.terms.total_fee_bps,
                    "creator_bps": pool.terms.creator_bps, "mint_authority": pool.mint_authority, "freeze_authority": pool.freeze_authority, "terms": pool.terms }),
        );
        self.pools.insert(pool.launch_id, pool);
    }

    fn open_pool(&self, id: u64) -> Result<Pool, Refusal> {
        match self.pools.get(&id) {
            None => Err("R_NO_POOL"),
            Some(p) if !p.open => Err("R_POOL_STATE"),
            Some(p) => Ok(p.clone()),
        }
    }

    fn on_buy(&mut self, token: &AccountId, sender: AccountId, amount: u128, m: Msg) -> Result<PromiseOrValue<U128>, Refusal> {
        if *token != self.usdc {
            return Err("R_UNEXPECTED_TOKEN");
        }
        if self.paused {
            return Err("R_PAUSED");
        }
        let mut pool = self.open_pool(m.launch_id.0)?;
        let min_out = m.min_out.map_or(0, |v| v.0);
        let now = env::block_timestamp();
        let s = quote_buy(pool.reserves(), amount, min_out, &pool.terms, now.saturating_sub(pool.opened_ns), Routing::M_A).map_err(market_code)?;
        if s.after.q > self.max_pool_q || self.global_q - pool.q + s.after.q > self.max_global_q {
            return Err("R_MARKET_CAP");
        }
        let receiver = m.receiver.unwrap_or_else(|| sender.clone());
        self.custody_add(token, amount);
        self.apply_swap(&mut pool, &s, now);
        self.custody_sub(&pool.token, s.amount_out);
        self.emit_swap(&pool, "buy", &sender, &receiver, &s, now);
        let pay = self.pay_out(&pool.token, &receiver, s.amount_out, "buy_payout");
        self.pools.insert(pool.launch_id, pool);
        Ok(PromiseOrValue::Promise(pay))
    }

    fn on_sell(&mut self, token: &AccountId, sender: AccountId, amount: u128, m: Msg) -> Result<PromiseOrValue<U128>, Refusal> {
        let mut pool = self.open_pool(m.launch_id.0)?;
        if *token != pool.token {
            return Err("R_UNEXPECTED_TOKEN");
        }
        let min_out = m.min_out.map_or(0, |v| v.0);
        let now = env::block_timestamp();
        let s = quote_sell(pool.reserves(), amount, min_out, &pool.terms, now.saturating_sub(pool.opened_ns), Routing::M_A).map_err(market_code)?;
        let receiver = m.receiver.unwrap_or_else(|| sender.clone());
        self.custody_add(token, amount);
        self.apply_swap(&mut pool, &s, now);
        self.custody_sub(&self.usdc.clone(), s.amount_out);
        self.emit_swap(&pool, "sell", &sender, &receiver, &s, now);
        let pay = self.pay_out(&self.usdc.clone(), &receiver, s.amount_out, "sell_payout");
        self.pools.insert(pool.launch_id, pool);
        Ok(PromiseOrValue::Promise(pay))
    }

    /// Update reserves and the fee ledger. The creator and platform slices leave the reserve for their counters.
    fn apply_swap(&mut self, pool: &mut Pool, s: &Swap, now: u64) {
        self.global_q = self.global_q - pool.q + s.after.q;
        pool.q = s.after.q;
        pool.t = s.after.t;
        let f = &s.fee;
        let l = &mut pool.ledger;
        l.fee_total += f.total;
        l.acc_creator += f.creator;
        l.acc_platform += f.platform;
        l.acc_lp += f.lp;
        l.red_holders += f.red_holders;
        l.red_referral += f.red_referral;
        l.surcharge += f.surcharge;
        self.creator_unpaid += f.creator;
        self.platform_unpaid += f.platform;
        record_creator_fee(&mut pool.epochs, pool.opened_ns, now, f.creator);
    }

    fn emit_swap(&self, pool: &Pool, side: &str, trader: &AccountId, receiver: &AccountId, s: &Swap, now: u64) {
        let f = &s.fee;
        let rate_ppm = f.total.saturating_mul(1_000_000) / s.q_leg.max(1);
        emit(
            "swap",
            json!({ "launch_id": pool.launch_id.to_string(), "side": side, "trader": trader, "receiver": receiver,
                    "amount_in": s.amount_in.to_string(), "amount_out": s.amount_out.to_string(), "fee_total": f.total.to_string(),
                    "fee_bps": (rate_ppm / 100).to_string(), "creator_bps": pool.terms.creator_bps, "creator": f.creator.to_string(), "platform": f.platform.to_string(),
                    "holders": f.holders.to_string(), "lp": f.lp.to_string(), "referral": f.referral.to_string(),
                    "surcharge": f.surcharge.to_string(), "red_holders": f.red_holders.to_string(), "red_referral": f.red_referral.to_string(),
                    "q": pool.q.to_string(), "t": pool.t.to_string(), "ts_ns": now.to_string() }),
        );
    }

    /// Outbound `ft_transfer` plus the never-panicking callback. State was debited before this is called.
    pub(crate) fn pay_out(&self, token: &AccountId, to: &AccountId, amount: u128, reason: &str) -> Promise {
        ext_ft::ext(token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(to.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).resolve_payout(token.clone(), to.clone(), U128(amount), reason.to_string()))
    }
}

impl Pool {
    pub fn reserves(&self) -> kruxa_market::Reserves {
        kruxa_market::Reserves { q: self.q, t: self.t }
    }
}
