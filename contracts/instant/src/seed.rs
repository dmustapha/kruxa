//! Step 2: the creator's USDC seed arrives through `ft_on_transfer`. Never panics; a refusal returns the full amount.
use crate::events::emit;
use crate::model::*;
use crate::{Launcher, LauncherExt};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, log, near, AccountId, PromiseOrValue};

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct SeedMsg {
    v: u8,
    op: String,
    launch_id: U64,
}

type Refusal = &'static str;

impl Launcher {
    fn accept_seed(&mut self, token: &AccountId, sender: &AccountId, amount: u128, msg: &str) -> Result<(), Refusal> {
        if *token != self.cfg.usdc {
            return Err("R_UNEXPECTED_TOKEN");
        }
        let m = serde_json::from_str::<SeedMsg>(msg).map_err(|_| "R_BAD_MSG")?;
        if m.v != 1 || m.op != "seed_instant" {
            return Err("R_BAD_MSG");
        }
        if self.pause_level() != PauseLevel::None {
            return Err("R_PAUSED");
        }
        let mut r = self.instants.get(&m.launch_id.0).cloned().ok_or("R_INSTANT_STATE")?;
        if r.status != Status::TokenReady {
            return Err("R_INSTANT_STATE");
        }
        if *sender != r.creator {
            return Err("R_NOT_CREATOR");
        }
        if amount != r.params.seed_q {
            return Err("R_SEED_AMOUNT");
        }
        if self.seeds_held.checked_add(amount).is_none_or(|t| t > self.cfg.agg_cap) {
            return Err("R_CAP_GLOBAL");
        }
        let fee = r.derived.launch_fee;
        r.status = Status::Seeded;
        r.seeded_at = env::block_timestamp();
        r.seed_total = amount;
        r.seed_due = amount - fee;
        r.fee_held = fee;
        self.seeds_held += amount;
        self.seed_due_total += amount - fee;
        self.fee_held_total += fee;
        let usdc = self.cfg.usdc.clone();
        self.custody_add(&usdc, amount);
        emit("instant_seeded", json!({ "launch_id": r.launch_id.to_string(), "seed": amount.to_string(), "launch_fee": fee.to_string() }));
        self.save(r);
        Ok(())
    }
}

#[near]
impl Launcher {
    /// NEP-141 receiver. Only the configured USDC, only the creator, only the exact declared seed, only while `TokenReady`.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        match self.accept_seed(&token, &sender_id, amount.0, &msg) {
            Ok(()) => PromiseOrValue::Value(U128(0)),
            Err(code) => {
                log!("{}: ft_on_transfer refused, full amount returned", code);
                PromiseOrValue::Value(amount)
            }
        }
    }
}
