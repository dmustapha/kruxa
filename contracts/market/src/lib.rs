//! kruxa-market: the NEAR constant-product pool and fee router (Market-lite, scope M-A).
//! Dependency direction: contract -> kruxa-market -> kruxa-logic -> kruxa-math. Pure math lives in `kruxa-market`.
//! Custody is the contract's own USDC and token balances; reserves are internal counters, so a donation moves nothing.
#![forbid(unsafe_code)]
#![allow(clippy::too_many_arguments)]

mod claims;
mod events;
mod ext;
mod model;
mod swap;
mod views;

use kruxa_market::{MAX_GLOBAL_RESERVE_Q, MAX_POOL_RESERVE_Q};
use model::*;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const GAS_OUT: Gas = Gas::from_tgas(15);
pub const GAS_CB: Gas = Gas::from_tgas(15);
pub const MAX_PARKED: u32 = 64;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Pools,
    Parked,
    Owed,
    OwedTotal,
    Custody,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    owner: AccountId,
    guardian: AccountId,
    treasury: AccountId,
    usdc: AccountId,
    core: AccountId,
    paused: bool,
    max_pool_q: u128,
    max_global_q: u128,
    /// Sum of every pool's quote reserve.
    global_q: u128,
    /// Creator slices accrued and not yet paid or debited, all pools.
    creator_unpaid: u128,
    platform_unpaid: u128,
    pools: LookupMap<u64, Pool>,
    /// Token legs that landed before their seed, keyed by (launch, token). Bounded by `MAX_PARKED`.
    parked: LookupMap<(u64, AccountId), u128>,
    parked_count: u32,
    /// (account, token) -> amount an outbound payout failed to deliver.
    owed: LookupMap<(AccountId, AccountId), u128>,
    owed_total: LookupMap<AccountId, u128>,
    /// Expected balance this contract holds per token. A test compares it with `ft_balance_of`.
    custody: LookupMap<AccountId, u128>,
}

/// Panic with a rule code first, like the core. Used only by user-called methods, never by callbacks.
pub(crate) fn fail(code: &str, detail: &str) -> ! {
    env::panic_str(&format!("{code}: {detail}"))
}

#[near]
impl Market {
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        treasury: AccountId,
        usdc: AccountId,
        core: AccountId,
        max_pool_reserve_q: Option<U128>,
        max_global_reserve_q: Option<U128>,
    ) -> Self {
        Self {
            owner,
            guardian,
            treasury,
            usdc,
            core,
            paused: false,
            max_pool_q: max_pool_reserve_q.map_or(MAX_POOL_RESERVE_Q, |v| v.0),
            max_global_q: max_global_reserve_q.map_or(MAX_GLOBAL_RESERVE_Q, |v| v.0),
            global_q: 0,
            creator_unpaid: 0,
            platform_unpaid: 0,
            pools: LookupMap::new(Key::Pools),
            parked: LookupMap::new(Key::Parked),
            parked_count: 0,
            owed: LookupMap::new(Key::Owed),
            owed_total: LookupMap::new(Key::OwedTotal),
            custody: LookupMap::new(Key::Custody),
        }
    }

    /// Guardian or owner. Blocks buys and handoff legs; never blocks sells, claims or owed withdrawals.
    pub fn pause(&mut self) {
        let who = env::predecessor_account_id();
        if who != self.guardian && who != self.owner {
            fail("R_NOT_AUTHORIZED", "guardian or owner only");
        }
        self.paused = true;
        events::emit("market_paused", near_sdk::serde_json::json!({ "paused": true, "by": who }));
    }

    pub fn unpause(&mut self) {
        let who = env::predecessor_account_id();
        if who != self.owner {
            fail("R_NOT_AUTHORIZED", "owner only");
        }
        self.paused = false;
        events::emit("market_paused", near_sdk::serde_json::json!({ "paused": false, "by": who }));
    }
}

/// Counter helpers shared by swap and claims.
impl Market {
    pub(crate) fn custody_of(&self, token: &AccountId) -> u128 {
        self.custody.get(token).copied().unwrap_or(0)
    }

    pub(crate) fn custody_add(&mut self, token: &AccountId, amount: u128) {
        let v = self.custody_of(token) + amount;
        self.custody.insert(token.clone(), v);
    }

    pub(crate) fn custody_sub(&mut self, token: &AccountId, amount: u128) {
        let v = self.custody_of(token).saturating_sub(amount);
        self.custody.insert(token.clone(), v);
    }

    pub(crate) fn owed_of(&self, account: &AccountId, token: &AccountId) -> u128 {
        self.owed.get(&(account.clone(), token.clone())).copied().unwrap_or(0)
    }

    pub(crate) fn owed_total_of(&self, token: &AccountId) -> u128 {
        self.owed_total.get(token).copied().unwrap_or(0)
    }

    /// Credit `amount` to an account's owed balance (an outbound payout failed). The tokens are still held, so custody grows back.
    pub(crate) fn owed_credit(&mut self, account: &AccountId, token: &AccountId, amount: u128) {
        let v = self.owed_of(account, token) + amount;
        self.owed.insert((account.clone(), token.clone()), v);
        let tot = self.owed_total_of(token) + amount;
        self.owed_total.insert(token.clone(), tot);
        self.custody_add(token, amount);
    }

    pub(crate) fn owed_debit(&mut self, account: &AccountId, token: &AccountId, amount: u128) {
        let v = self.owed_of(account, token) - amount;
        self.owed.insert((account.clone(), token.clone()), v);
        let tot = self.owed_total_of(token) - amount;
        self.owed_total.insert(token.clone(), tot);
        self.custody_sub(token, amount);
    }
}
