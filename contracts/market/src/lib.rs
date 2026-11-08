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
#[cfg(test)]
mod tests;
mod views;

use kruxa_market::{MAX_GLOBAL_RESERVE_Q, MAX_INSTANT_RESERVE_Q, MAX_POOL_RESERVE_Q};
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
    /// Instant pools only: cap on the SUM OF SEEDS, inside the global cap (CO-7 D-4). Trading growth is not counted (M-01).
    max_instant_q: u128,
    /// A raise of `max_instant_q` queued by the owner: (value, effective_at). Applies after the 7-day timelock (ABI 1.1.2).
    pending_max_instant_q: Option<(u128, u64)>,
    /// Account of the instant launcher, the second allowed handoff sender. None = instant mode off.
    launcher: Option<AccountId>,
    launcher_pools: u32,
    instant_q: u128,
    /// Sum of the seeds (opening quote reserves) of instant pools: the only thing `max_instant_q` limits (M-01).
    instant_seeded_q: u128,
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
        max_instant_reserve_q: Option<U128>,
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
            max_instant_q: max_instant_reserve_q.map_or(MAX_INSTANT_RESERVE_Q, |v| v.0),
            pending_max_instant_q: None,
            launcher: None,
            launcher_pools: 0,
            instant_q: 0,
            instant_seeded_q: 0,
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

    /// Owner only: names the instant launcher as the second allowed handoff sender (ABI 1.1.0). Locked for good once a
    /// launcher pool exists. Core, USDC and the treasury can never be the launcher.
    pub fn set_launcher(&mut self, account: AccountId) {
        if env::predecessor_account_id() != self.owner {
            fail("R_NOT_AUTHORIZED", "owner only");
        }
        if self.launcher_pools > 0 {
            fail("R_LAUNCHER_LOCKED", "a launcher pool exists");
        }
        if account == self.core || account == self.usdc || account == self.treasury {
            fail("R_NOT_AUTHORIZED", "launcher must be its own account");
        }
        self.launcher = Some(account.clone());
        events::emit("launcher_set", near_sdk::serde_json::json!({ "launcher": account }));
    }

    /// Owner or guardian (ABI 1.1.2). Sets the cap on the lifetime sum of instant seeds. A value below the current cap applies at
    /// once and cancels a queued raise (the brake must not be undone by a timer); a value at or above it is owner only and
    /// queued for 7 days, then `apply_max_instant_reserve` (anyone) applies it. `instant_seeded_q` never goes down, so without
    /// this setter the cap could not follow the market's growth.
    pub fn set_max_instant_reserve(&mut self, value: U128) {
        let who = env::predecessor_account_id();
        if who != self.owner && who != self.guardian {
            fail("R_NOT_AUTHORIZED", "owner or guardian only");
        }
        if value.0 < self.max_instant_q {
            self.max_instant_q = value.0;
            let cancelled = self.pending_max_instant_q.take().is_some();
            events::emit("max_instant_lowered", near_sdk::serde_json::json!({ "value": value.0.to_string(), "by": who }));
            if cancelled {
                events::emit("max_instant_cancelled", near_sdk::serde_json::json!({ "by": who }));
            }
            return;
        }
        if who != self.owner {
            fail("R_NOT_AUTHORIZED", "raising the cap is owner only");
        }
        let at = kruxa_logic::timelock_effective_at(env::block_timestamp());
        self.pending_max_instant_q = Some((value.0, at));
        events::emit("max_instant_queued", near_sdk::serde_json::json!({ "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    /// Anyone, once the timelock elapsed. Refused if the queued value is no longer a raise.
    pub fn apply_max_instant_reserve(&mut self) {
        let Some((value, at)) = self.pending_max_instant_q else { fail("R_NOTHING", "nothing queued") };
        if !kruxa_logic::timelock_elapsed(at, env::block_timestamp()) {
            fail("R_NOT_YET", "timelock has not elapsed");
        }
        if value <= self.max_instant_q {
            fail("R_NOTHING", "the queued value is no longer a raise; lower it again or queue a new one");
        }
        self.max_instant_q = value;
        self.pending_max_instant_q = None;
        events::emit("max_instant_applied", near_sdk::serde_json::json!({ "value": value.to_string() }));
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
        let key = (account.clone(), token.clone());
        match self.owed_of(account, token) - amount {
            0 => self.owed.remove(&key),
            v => self.owed.insert(key, v),
        };
        match self.owed_total_of(token) - amount {
            0 => self.owed_total.remove(token),
            v => self.owed_total.insert(token.clone(), v),
        };
        self.custody_sub(token, amount);
    }
}
