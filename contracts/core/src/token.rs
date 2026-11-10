use kruxa_logic::TrialParams;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, Gas, NearToken, Promise};

use crate::model::TokenRoute;

/// The seam that lets the own-FT-by-hash route be added later without touching the lifecycle.
pub trait TokenProvider {
    fn route(&self) -> TokenRoute;
    /// The account the launch token will live at.
    fn token_account(&self, p: &TrialParams) -> AccountId;
    /// Promise that creates the token with its whole supply minted to `owner`.
    fn create(&self, p: &TrialParams, supply_base: u128, owner: &AccountId, deposit: u128) -> Promise;
}

/// Default for every launch (RULING 2026-11-07): token.primitives factory, disclosed as a trust caveat.
pub struct FactoryPrimitives {
    pub factory: AccountId,
}

impl TokenProvider for FactoryPrimitives {
    fn route(&self) -> TokenRoute {
        TokenRoute::FactoryPrimitives
    }

    fn token_account(&self, p: &TrialParams) -> AccountId {
        format!("{}.{}", p.symbol.to_lowercase(), self.factory).parse().expect("symbol is [A-Z0-9], factory is a valid account")
    }

    fn create(&self, p: &TrialParams, supply_base: u128, owner: &AccountId, deposit: u128) -> Promise {
        let args = json!({ "args": {
            "owner_id": owner,
            "total_supply": supply_base.to_string(),
            "metadata": { "spec": "ft-1.0.0", "name": p.name, "symbol": p.symbol, "decimals": 6 }
        }});
        Promise::new(self.factory.clone()).function_call(
            "create_token".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(deposit),
            // The real token.primitives factory needs 91 to 95 Tgas for create_token (measured on testnet, evidence/instant-testnet);
            // 80 ended in an out-of-gas CreationFailed. 110 leaves margin, unused gas is refunded.
            Gas::from_tgas(110),
        )
    }
}
