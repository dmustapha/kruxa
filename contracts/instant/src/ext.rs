use near_sdk::json_types::U128;
use near_sdk::{ext_contract, AccountId};

/// NEP-141 and NEP-145 surface used by the launcher (USDC and the launch token).
#[allow(dead_code)] // the trait only exists to generate the ext_ft call builders
#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn ft_total_supply(&self) -> U128;
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}
