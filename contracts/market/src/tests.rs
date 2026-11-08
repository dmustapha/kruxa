//! In-VM tests of the timelocked instant seed cap setter (ABI 1.1.2). The sandbox cannot move the clock by seven days.
use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

const DAY: u64 = 86_400 * 1_000_000_000;
const CAP: u128 = 5_000_000_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn at(who: &str, days: u64) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acct(who)).block_timestamp(days * DAY + 1).build());
}

fn market() -> Market {
    at("owner.test.near", 0);
    Market::new(
        acct("owner.test.near"),
        acct("guardian.test.near"),
        acct("treasury.test.near"),
        acct("usdc.test.near"),
        acct("core.test.near"),
        None,
        None,
        Some(U128(CAP)),
    )
}

fn refused(f: impl FnOnce()) -> String {
    let e = catch_unwind(AssertUnwindSafe(f)).expect_err("must panic");
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

#[test]
fn a_raise_waits_seven_days_then_anyone_applies_it_once() {
    let mut m = market();
    at("owner.test.near", 0);
    m.set_max_instant_reserve(U128(CAP * 2));
    assert_eq!((m.max_instant_q, m.pending_max_instant_q.map(|p| p.0)), (CAP, Some(CAP * 2)));
    at("stranger.test.near", 6);
    assert!(refused(|| m.apply_max_instant_reserve()).contains("R_NOT_YET"));
    at("stranger.test.near", 7);
    m.apply_max_instant_reserve();
    assert_eq!((m.max_instant_q, m.pending_max_instant_q), (CAP * 2, None));
    assert!(get_logs().iter().any(|l| l.contains("max_instant_applied")));
    assert!(refused(|| m.apply_max_instant_reserve()).contains("R_NOTHING"), "nothing queued any more");
}

#[test]
fn a_lowering_is_immediate_by_owner_or_guardian_and_cancels_a_queued_raise() {
    for lowerer in ["owner.test.near", "guardian.test.near"] {
        let mut m = market();
        at("owner.test.near", 0);
        m.set_max_instant_reserve(U128(CAP * 2));
        at(lowerer, 1);
        m.set_max_instant_reserve(U128(CAP / 2));
        assert_eq!((m.max_instant_q, m.pending_max_instant_q), (CAP / 2, None), "{lowerer}");
        let logs = get_logs().join("\n");
        assert!(logs.contains("max_instant_lowered") && logs.contains("max_instant_cancelled"));
        at("stranger.test.near", 30);
        assert!(refused(|| m.apply_max_instant_reserve()).contains("R_NOTHING"), "a timer cannot undo the brake");
    }
}

#[test]
fn only_the_owner_queues_a_raise_and_strangers_do_nothing() {
    let mut m = market();
    for who in ["guardian.test.near", "stranger.test.near"] {
        at(who, 0);
        assert!(refused(|| m.set_max_instant_reserve(U128(CAP + 1))).contains("R_NOT_AUTHORIZED"), "{who}");
    }
    at("stranger.test.near", 0);
    assert!(refused(|| m.set_max_instant_reserve(U128(1))).contains("R_NOT_AUTHORIZED"), "no stranger lowering either");
    assert_eq!((m.max_instant_q, m.pending_max_instant_q), (CAP, None));
}

#[test]
fn a_queued_value_that_is_no_longer_a_raise_is_refused() {
    let mut m = market();
    at("owner.test.near", 0);
    m.set_max_instant_reserve(U128(CAP + 10));
    m.max_instant_q = CAP + 10; // the cap caught up by other means
    at("stranger.test.near", 8);
    assert!(refused(|| m.apply_max_instant_reserve()).contains("R_NOTHING"));
}
