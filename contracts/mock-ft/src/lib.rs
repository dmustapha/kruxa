//! Test-only NEP-141 + NEP-145 token. Stands in for native USDC and for the launch token. Never deployed anywhere real.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

#[ext_contract(ext_receiver)]
pub trait Receiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    balances: LookupMap<AccountId, u128>,
    registered: LookupMap<AccountId, bool>,
    total: u128,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let mut s = Self { balances: LookupMap::new(b"b"), registered: LookupMap::new(b"r"), total: total_supply.0 };
        s.balances.insert(owner_id.clone(), total_supply.0);
        s.registered.insert(owner_id, true);
        s
    }

    /// Test helper: mint to an account (registers it).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let b = self.bal(&account_id);
        self.balances.insert(account_id.clone(), b + amount.0);
        self.registered.insert(account_id, true);
        self.total += amount.0;
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, _registration_only: Option<bool>) -> Value {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        self.registered.insert(who, true);
        json!({ "total": "1250000000000000000000", "available": "0" })
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<Value> {
        self.registered.get(&account_id).map(|_| json!({ "total": "1250000000000000000000", "available": "0" }))
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.bal(&account_id))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>) {
        assert_one_yocto();
        self.move_tokens(&env::predecessor_account_id(), &receiver_id, amount.0);
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>, msg: String) -> Promise {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, amount.0);
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(Gas::from_tgas(60))
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).ft_resolve_transfer(sender, receiver_id, amount))
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).map(|u| u.0).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let refund = unused.min(amount.0).min(self.bal(&receiver_id));
        if refund > 0 {
            self.move_tokens(&receiver_id, &sender_id, refund);
        }
        U128(amount.0 - refund)
    }
}

impl MockFt {
    fn bal(&self, a: &AccountId) -> u128 {
        self.balances.get(a).copied().unwrap_or(0)
    }

    fn move_tokens(&mut self, from: &AccountId, to: &AccountId, amount: u128) {
        require!(self.registered.get(to).copied().unwrap_or(false), "receiver is not registered");
        let fb = self.bal(from);
        require!(fb >= amount, "insufficient balance");
        self.balances.insert(from.clone(), fb - amount);
        let tb = self.bal(to);
        self.balances.insert(to.clone(), tb + amount);
        let _ = NearToken::from_yoctonear(0);
    }
}

#[near]
impl MockFt {
    /// Test helper: drop an account's registration, to make an outbound ft_transfer fail.
    pub fn unregister(&mut self, account_id: AccountId) {
        self.registered.insert(account_id, false);
    }
}
