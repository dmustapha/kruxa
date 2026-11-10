//! Test-only stand-in for token.primitives.near. The harness pre-deploys the token account the real factory would create.
use near_sdk::serde_json::Value;
use near_sdk::{env, near, require, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFactory {
    fail: bool,
}

#[near]
impl MockFactory {
    #[init]
    pub fn new() -> Self {
        Self { fail: false }
    }

    /// Test switch: make create_token fail, to exercise the CreationFailed path.
    pub fn set_fail(&mut self, fail: bool) {
        self.fail = fail;
    }

    #[payable]
    pub fn create_token(&mut self, args: Value) {
        require!(!self.fail, "factory refuses");
        // The real factory needs 91 to 95 Tgas (measured on testnet); a caller that sends less must fail here too.
        require!(env::prepaid_gas() >= near_sdk::Gas::from_tgas(95), "create_token needs at least 95 Tgas prepaid");
        require!(args.get("total_supply").is_some() && args.get("owner_id").is_some(), "args.total_supply / args.owner_id missing");
        require!(env::attached_deposit().as_yoctonear() > 0, "deposit required");
    }
}
