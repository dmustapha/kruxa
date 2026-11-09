use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::{ext_contract, AccountId};

/// NEP-141 surface used by the core (USDC and the launch token).
#[allow(dead_code)] // the trait only exists to generate the ext_ft call builders
#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn storage_balance_of(&self, account_id: AccountId) -> Option<Value>;
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String);
}

/// intents.near surface: NEP-245 transfer, ft_withdraw to native, and execute_intents for S4.
#[allow(dead_code)] // the trait only exists to generate the ext_intents call builders
#[ext_contract(ext_intents)]
pub trait ExtIntents {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
    fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128;
    fn ft_withdraw(&mut self, token: AccountId, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: Option<String>);
    fn execute_intents(&mut self, signed: Vec<Value>);
    fn is_nonce_used(&self, account_id: AccountId, nonce: String) -> bool;
}
