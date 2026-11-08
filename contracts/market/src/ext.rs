use near_sdk::json_types::U128;
use near_sdk::{ext_contract, AccountId};

/// NEP-141 surface used by the market (USDC and launch tokens).
#[allow(dead_code)] // the trait only exists to generate the ext_ft call builders
#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
