//! Pull-based claims: creator slice (payout recipient only), platform slices, and owed balances.
//! Debit first, pay second. A failed payout is re-credited by `resolve_payout` (never panics) into the account's owed balance,
//! withdrawable with `claim_owed` once the account can receive the token.
use crate::events::emit;
use crate::{fail, Market, MarketExt};
use kruxa_market::{creator_unlocked, fold_vested, MIN_CLAIM_QUOTE};
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Promise};

#[near]
impl Market {
    /// Pays the unlocked creator slice to the payout recipient (fixed at open). Recipient only.
    pub fn claim(&mut self, launch_id: U64) -> Promise {
        let Some(mut pool) = self.pools.get(&launch_id.0).cloned() else { fail("R_NO_POOL", "unknown launch") };
        if env::predecessor_account_id() != pool.payout_recipient {
            fail("R_NOT_AUTHORIZED", "only the payout recipient can claim");
        }
        let now = env::block_timestamp();
        fold_vested(&mut pool.epochs, &mut pool.ledger.folded_unlocked, pool.opened_ns, &pool.terms, now);
        let unlocked = creator_unlocked(&pool.epochs, pool.ledger.folded_unlocked, pool.opened_ns, &pool.terms, now)
            .unwrap_or_else(|_| fail("R_MATH", "unlock overflow"));
        let amount = unlocked.saturating_sub(pool.ledger.paid_creator);
        if amount < MIN_CLAIM_QUOTE {
            fail("R_NOTHING_TO_CLAIM", "below the $1 minimum claim");
        }
        pool.ledger.paid_creator += amount;
        self.creator_unpaid -= amount;
        let usdc = self.usdc.clone();
        self.custody_sub(&usdc, amount);
        emit(
            "creator_claimed",
            json!({ "launch_id": pool.launch_id.to_string(), "recipient": pool.payout_recipient, "amount": amount.to_string(), "paid_creator": pool.ledger.paid_creator.to_string() }),
        );
        let to = pool.payout_recipient.clone();
        self.pools.insert(pool.launch_id, pool);
        self.pay_out(&usdc, &to, amount, "creator")
    }

    /// Pays all accrued platform slices to the treasury. Treasury or owner.
    pub fn withdraw_platform(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        if who != self.treasury && who != self.owner {
            fail("R_NOT_AUTHORIZED", "treasury or owner only");
        }
        let amount = self.platform_unpaid;
        if amount < MIN_CLAIM_QUOTE {
            fail("R_NOTHING_TO_CLAIM", "below the $1 minimum claim");
        }
        self.platform_unpaid = 0;
        let usdc = self.usdc.clone();
        self.custody_sub(&usdc, amount);
        emit("platform_withdrawn", json!({ "to": self.treasury, "amount": amount.to_string() }));
        let to = self.treasury.clone();
        self.pay_out(&usdc, &to, amount, "platform")
    }

    /// Pays tokens or USDC that a swap payout failed to deliver. Caller only.
    pub fn claim_owed(&mut self, token_id: AccountId) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed_of(&who, &token_id);
        if amount == 0 {
            fail("R_NOTHING_TO_CLAIM", "nothing owed");
        }
        self.owed_debit(&who, &token_id, amount);
        emit("owed_claimed", json!({ "account": who, "token": token_id, "amount": amount.to_string() }));
        self.pay_out(&token_id, &who, amount, "owed_claim")
    }
}
