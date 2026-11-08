//! Test-only STUB of the receiving side of the `open_market` handoff (docs/interfaces/HANDOFF.md). It records every leg and answers
//! like the real market would: `0` unused when it consumes a leg, the full amount when it refuses, a panic when told to.
//! The real market lives in contracts/market (workstream M). Never deployed anywhere real.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockMarket {
    /// accept | refuse_seed | refuse_token | panic
    mode: String,
    legs: Vec<String>,
}

#[near]
impl MockMarket {
    #[init]
    pub fn new() -> Self {
        Self { mode: "accept".into(), legs: Vec::new() }
    }

    pub fn set_mode(&mut self, mode: String) {
        self.mode = mode;
    }

    pub fn get_legs(&self) -> Vec<Value> {
        self.legs.iter().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }

    /// Returns the UNUSED amount, as NEP-141 receivers do.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if self.mode == "panic" {
            env::panic_str("stub market panics on purpose");
        }
        let parsed: Value = serde_json::from_str(&msg).unwrap_or(Value::Null);
        let op = parsed["op"].as_str().unwrap_or("").to_string();
        let well_formed = parsed["v"] == 1 && matches!(op.as_str(), "seed_quote" | "open_pool_token") && parsed["launch_id"].is_string();
        let refused =
            !well_formed || (self.mode == "refuse_token" && op == "open_pool_token") || (self.mode == "refuse_seed" && op == "seed_quote");
        self.legs.push(
            json!({ "token_contract": env::predecessor_account_id(), "sender": sender_id, "amount": amount.0.to_string(), "msg": parsed, "refused": refused })
                .to_string(),
        );
        if refused {
            amount
        } else {
            U128(0)
        }
    }
}
