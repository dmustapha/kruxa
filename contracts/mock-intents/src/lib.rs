//! Test-only intents.near. Implements the slice Kruxa touches: mt_balance_of, mt_transfer, ft_withdraw and
//! execute_intents for transfer intents with the flat `msg` / `min_gas` keys (W0 OV1). It does NOT verify signatures.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value};
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[ext_contract(ext_usdc)]
pub trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockIntents {
    balances: LookupMap<(AccountId, String), u128>,
    /// Test switch (W-REFUND-PARTIAL): while set, `mt_transfer` panics, like a Verifier that refuses one leg.
    fail_transfers: bool,
}

#[near]
impl MockIntents {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b"), fail_transfers: false }
    }

    pub fn set_fail_transfers(&mut self, fail: bool) {
        self.fail_transfers = fail;
    }

    /// Test helper: credit an internal balance (the harness sends the underlying USDC here separately).
    pub fn mt_deposit(&mut self, account_id: AccountId, token_id: String, amount: U128) {
        let b = self.bal(&account_id, &token_id);
        self.balances.insert((account_id, token_id), b + amount.0);
    }

    /// Test helper (solvency anchor): set a balance directly, like a Verifier-side force withdraw or a loss. No USDC moves.
    pub fn mt_force_set(&mut self, account_id: AccountId, token_id: String, amount: U128) {
        self.balances.insert((account_id, token_id), amount.0);
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.bal(&account_id, &token_id))
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        _approval: Option<(AccountId, u64)>,
        _memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(!self.fail_transfers, "mt_transfer refused");
        self.mv(&env::predecessor_account_id(), &receiver_id, &token_id, amount.0);
    }

    /// Withdraw to the native token contract: debit first, re-credit in the resolver on failure.
    #[payable]
    pub fn ft_withdraw(
        &mut self,
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
        _memo: Option<String>,
        _msg: Option<String>,
    ) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let tid = format!("nep141:{}", token);
        let b = self.bal(&who, &tid);
        require!(b >= amount.0, "insufficient balance");
        self.balances.insert((who.clone(), tid.clone()), b - amount.0);
        ext_usdc::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(20))
            .ft_transfer(receiver_id, amount, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).resolve_withdraw(who, tid, amount))
    }

    #[private]
    pub fn resolve_withdraw(&mut self, who: AccountId, token_id: String, amount: U128) {
        if env::promise_result_checked(0, 64).is_err() {
            let b = self.bal(&who, &token_id);
            self.balances.insert((who, token_id), b + amount.0);
        }
    }

    /// Executes transfer intents. Moves the balance first, then notifies the receiver when `msg` is present (S3).
    pub fn execute_intents(&mut self, signed: Vec<Value>) {
        let mut calls = Vec::new();
        for s in signed {
            let payload: Value = serde_json::from_str(s["payload"].as_str().expect("payload string")).expect("payload json");
            let signer: AccountId = payload["signer_id"].as_str().expect("signer_id").parse().expect("account");
            for it in payload["intents"].as_array().expect("intents") {
                require!(it["intent"] == "transfer", "only transfer intents");
                let receiver: AccountId = it["receiver_id"].as_str().expect("receiver").parse().expect("account");
                for (tid, amt) in it["tokens"].as_object().expect("tokens") {
                    let amount: u128 = amt.as_str().expect("amount").parse().expect("u128");
                    self.mv(&signer, &receiver, tid, amount);
                    if let Some(msg) = it.get("msg").and_then(Value::as_str) {
                        calls.push(self.notify(&signer, &receiver, tid, amount, msg.to_string()));
                    }
                }
            }
        }
        drop(calls);
    }

    #[private]
    pub fn resolve_notify(&mut self, sender: AccountId, receiver: AccountId, token_id: String, amount: U128) -> Vec<U128> {
        let unused = match env::promise_result_checked(0, 256) {
            Ok(b) => serde_json::from_slice::<Vec<U128>>(&b).ok().and_then(|v| v.first().map(|u| u.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let refund = unused.min(amount.0).min(self.bal(&receiver, &token_id));
        if refund > 0 {
            self.mv(&receiver, &sender, &token_id, refund);
        }
        vec![U128(amount.0 - refund)]
    }
}

impl MockIntents {
    fn bal(&self, a: &AccountId, t: &str) -> u128 {
        self.balances.get(&(a.clone(), t.to_string())).copied().unwrap_or(0)
    }

    fn mv(&mut self, from: &AccountId, to: &AccountId, t: &str, amount: u128) {
        require!(from != to, "invalid intent: sender == receiver");
        let fb = self.bal(from, t);
        require!(fb >= amount, "insufficient balance or overflow");
        self.balances.insert((from.clone(), t.to_string()), fb - amount);
        let tb = self.bal(to, t);
        self.balances.insert((to.clone(), t.to_string()), tb + amount);
    }

    fn notify(&self, signer: &AccountId, receiver: &AccountId, tid: &str, amount: u128, msg: String) -> Promise {
        ext_mt_receiver::ext(receiver.clone())
            .with_static_gas(Gas::from_tgas(50))
            .mt_on_transfer(signer.clone(), vec![signer.clone()], vec![tid.to_string()], vec![U128(amount)], msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).resolve_notify(
                signer.clone(),
                receiver.clone(),
                tid.to_string(),
                U128(amount),
            ))
    }
}
