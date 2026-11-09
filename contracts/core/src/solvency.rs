//! The on-chain solvency anchor (ARCHITECTURE 5.6, S1-A L6, S1-B 5.6).
//!
//! IDENTITY (L6). For USDC held natively and for USDC held inside intents.near, summed over every launch:
//!   native_liability  = sum( open_native + due_native + inflight_native + spent_native + consolidated
//!                            - launch_fee_paid - launch_fee_inflight - stream_drawn - stream_inflight
//!                            - lp_seed_sent - lp_seed_inflight )
//!   intents_liability = sum( open_intents + due_intents + inflight_intents + spent_intents - consolidated - consolidating )
//!                       + sum( relay_fee_total - relay_fee_paid )
//! The lp_seed terms are the one deliberate addition to the architecture formula: the LP seed leaves the native pool when the
//! market takes it (D-3, added after 5.6 was written), so without them every opened market would read as insolvent.
//! A healthy core satisfies `ft_balance_of(core) >= native_liability` and `mt_balance_of(core) >= intents_liability`.
//!
//! COUNTERS. `held.native` and `held.intents` are those two sums, kept in O(1) so `check_solvency` never loops over launches.
//! They are NOT maintained at each mutation site. They are maintained at the single write choke point: `save_state` calls
//! `track_liability`, which recomputes THIS launch's liability from the old and new `LaunchState` and applies the difference.
//! Any money path that saves its state is therefore covered, with no per-site arithmetic to get wrong. `solvency_report`
//! recomputes the whole sum from state; `get_invariants` asserts counters == recomputation (identity L6).
//! INVARIANT: no code may write `self.states` except through `save_state` (create_trial inserts a zero ledger, which is liability 0).
//!
//! NEVER BLOCKS MONEY. The checks only read balances and report. The one effect is `intents_alert`, which refuses NEW Intents
//! commits (S1-B 5.6, R-02). Refunds, Walk, settle, consolidate, claims and streams are untouched by it. It clears itself the
//! next time a check finds the Intents balance sufficient, so a timing artefact cannot lock commits for good.
//!
//! RACES. The two balances are read in blocks after the call and the liability moves between those blocks (a refund leg, a
//! consolidation). The callback therefore compares the balance with the SMALLER of the liability snapshotted at call time and
//! the liability at callback time: a shortfall has to survive the whole window to count. Residual: a leg that stays in flight
//! across both snapshots can still read as a short, which the next check clears.
//!
//! GRIEFING. Permissionless and unpaid for by the platform: the caller pays gas. One check per `SOLVENCY_COOLDOWN_NS` across
//! both entry points, so spam cannot bloat logs or starve a keeper (a recent check already holds the answer). The callback only
//! reads, never panics on bad promise data, and an unreadable balance is reported as unknown without touching the alert.
use crate::ContractExt;
use kruxa_logic::RuleCode;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, Gas, Promise};

use crate::events::emit;
use crate::ext::{ext_ft, ext_intents};
use crate::model::*;
use crate::{fail, Contract, GAS_CB};

const HELD_KEY: &[u8] = b"kruxa:held";
const LAST_KEY: &[u8] = b"kruxa:last_check";
/// Minimum spacing between two checks, any caller, any entry point.
pub const SOLVENCY_COOLDOWN_NS: u64 = 30_000_000_000;
const GAS_BALANCE_VIEW: Gas = Gas::from_tgas(15);

/// One launch's share of each liability. Pure function of the ledger; saturating so a bad state can never panic a save.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Liab {
    pub native: u128,
    pub intents: u128,
}

impl Liab {
    pub fn of(st: &LaunchState) -> Liab {
        let l = &st.ledger;
        let native_in = l.open_native + l.due_native + l.inflight_native + l.spent_native + l.consolidated;
        let native_out =
            l.launch_fee_paid + l.launch_fee_inflight + l.stream_drawn + l.stream_inflight + l.lp_seed_sent + l.lp_seed_inflight;
        let intents_in = l.open_intents + l.due_intents + l.inflight_intents + l.spent_intents;
        Liab {
            native: native_in.saturating_sub(native_out),
            intents: intents_in.saturating_sub(l.consolidated + l.consolidating) + l.relay_fee_total.saturating_sub(l.relay_fee_paid),
        }
    }
}

/// The two running sums and the new-risk flag. Stored under `HELD_KEY`, outside the contract struct so the layout is unchanged.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Held {
    pub native: u128,
    pub intents: u128,
    pub intents_alert: bool,
}

/// One side of a check: what the balance was, what was owed, and whether the balance covered it.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Leg {
    pub balance: u128,
    pub liability: u128,
    pub ok: bool,
}

/// `None` on a side means that balance was not read (the call failed, was unparsable, or the side was not asked for).
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct SolvencyReport {
    pub at: u64,
    pub native: Option<Leg>,
    pub intents: Option<Leg>,
    pub ok: bool,
    pub intents_alert: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct LastCheck {
    started_at: u64,
    report: Option<SolvencyReport>,
}

impl Leg {
    fn json(&self) -> Value {
        json!({ "balance": self.balance.to_string(), "liability": self.liability.to_string(), "ok": self.ok })
    }
}

impl SolvencyReport {
    fn json(&self) -> Value {
        json!({ "at": self.at.to_string(), "native": self.native.as_ref().map(Leg::json), "intents": self.intents.as_ref().map(Leg::json),
                "ok": self.ok, "intents_alert": self.intents_alert })
    }
}

fn load<T: BorshDeserialize + Default>(key: &[u8]) -> T {
    env::storage_read(key).and_then(|b| T::try_from_slice(&b).ok()).unwrap_or_default()
}

fn store<T: BorshSerialize>(key: &[u8], value: &T) {
    if let Ok(bytes) = borsh::to_vec(value) {
        env::storage_write(key, &bytes);
    }
}

fn read_balance(index: u64) -> Option<u128> {
    let bytes = env::promise_result_checked(index, 64).ok()?;
    serde_json::from_slice::<U128>(&bytes).ok().map(|v| v.0)
}

fn leg(balance: Option<u128>, pre: u128, post: u128) -> Option<Leg> {
    let liability = pre.min(post);
    balance.map(|balance| Leg { balance, liability, ok: balance >= liability })
}

impl Contract {
    /// Called by `save_state` for every write of a launch: applies (new - old) liability to the running sums.
    pub(crate) fn track_liability(&self, id: u64, new: &LaunchState) {
        let old = self.states.get(&id).map_or(Liab::default(), Liab::of);
        let now = Liab::of(new);
        if old == now {
            return;
        }
        let mut held: Held = load(HELD_KEY);
        held.native = held.native.saturating_sub(old.native).saturating_add(now.native);
        held.intents = held.intents.saturating_sub(old.intents).saturating_add(now.intents);
        store(HELD_KEY, &held);
    }

    /// True while a check has found the Intents balance below what core owes there. New Intents commits are refused meanwhile.
    pub(crate) fn intents_alert(&self) -> bool {
        load::<Held>(HELD_KEY).intents_alert
    }

    /// Sum of every launch's liability, straight from state. O(launches): views only, never on a money path.
    fn recompute_liability(&self) -> Liab {
        (1..self.next_launch_id)
            .filter_map(|id| self.states.get(&id))
            .map(Liab::of)
            .fold(Liab::default(), |a, b| Liab { native: a.native.saturating_add(b.native), intents: a.intents.saturating_add(b.intents) })
    }

    fn start_check(&self) -> Held {
        let mut last: LastCheck = load(LAST_KEY);
        let now = env::block_timestamp();
        if now < last.started_at.saturating_add(SOLVENCY_COOLDOWN_NS) {
            fail(RuleCode::RTooEarly, "a solvency check ran less than 30 seconds ago; read solvency_report");
        }
        last.started_at = now;
        store(LAST_KEY, &last);
        load(HELD_KEY)
    }

    fn solvency_callback(&self, pre: &Held, with_native: bool) -> Promise {
        Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_solvency_checked(U128(pre.native), U128(pre.intents), with_native)
    }
}

#[near]
impl Contract {
    /// ANY caller. Reads `ft_balance_of(core)` and `mt_balance_of(core)` in parallel, then reports both against the liabilities.
    /// Moves no money and blocks nothing; see the module notes for the one flag it can raise.
    pub fn check_solvency(&mut self) -> Promise {
        let pre = self.start_check();
        let me = env::current_account_id();
        let native = ext_ft::ext(self.cfg.usdc.clone()).with_static_gas(GAS_BALANCE_VIEW).ft_balance_of(me.clone());
        let intents =
            ext_intents::ext(self.cfg.intents.clone()).with_static_gas(GAS_BALANCE_VIEW).mt_balance_of(me, self.cfg.usdc_token_id.clone());
        native.and(intents).then(self.solvency_callback(&pre, true))
    }

    /// ANY caller. The Intents-only tripwire (S1-B 5.6): the same report without the native side.
    pub fn reconcile_intents(&mut self) -> Promise {
        let pre = self.start_check();
        ext_intents::ext(self.cfg.intents.clone())
            .with_static_gas(GAS_BALANCE_VIEW)
            .mt_balance_of(env::current_account_id(), self.cfg.usdc_token_id.clone())
            .then(self.solvency_callback(&pre, false))
    }

    /// Never panics: every promise result is read with a bound and parsed fallibly, all arithmetic saturates.
    #[private]
    pub fn on_solvency_checked(&mut self, pre_native: U128, pre_intents: U128, with_native: bool) -> Value {
        let mut held: Held = load(HELD_KEY);
        let now = held.clone().into_liab();
        let (native_balance, intents_balance) = if with_native { (read_balance(0), read_balance(1)) } else { (None, read_balance(0)) };
        let native = leg(native_balance, pre_native.0, now.native);
        let intents = leg(intents_balance, pre_intents.0, now.intents);
        if let Some(i) = &intents {
            held.intents_alert = !i.ok;
            store(HELD_KEY, &held);
        }
        let ok = native.iter().chain(intents.iter()).all(|l| l.ok);
        let report = SolvencyReport { at: env::block_timestamp(), native, intents, ok, intents_alert: held.intents_alert };
        let mut last: LastCheck = load(LAST_KEY);
        last.report = Some(report.clone());
        store(LAST_KEY, &last);
        emit("solvency_report", report.json());
        report.json()
    }

    /// Counters, the same sums recomputed from state, the alert flag and the last check result.
    pub fn solvency_report(&self) -> Value {
        let held: Held = load(HELD_KEY);
        let sum = self.recompute_liability();
        json!({ "held_native": held.native.to_string(), "held_intents": held.intents.to_string(),
                "recomputed_native": sum.native.to_string(), "recomputed_intents": sum.intents.to_string(),
                "counters_ok": held.clone().into_liab() == sum, "intents_alert": held.intents_alert, "cooldown_ns": SOLVENCY_COOLDOWN_NS.to_string(),
                "last_check": load::<LastCheck>(LAST_KEY).report.map(|r| r.json()) })
    }
}

impl Held {
    fn into_liab(self) -> Liab {
        Liab { native: self.native, intents: self.intents }
    }
}

impl Contract {
    /// L6 for `get_invariants`: the running sums equal the recomputation.
    pub(crate) fn l6_counters_hold(&self) -> bool {
        let held: Held = load(HELD_KEY);
        held.into_liab() == self.recompute_liability()
    }
}
