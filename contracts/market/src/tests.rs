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

// ---- announced open (CO-7 2.7): trade_from_ns -------------------------------------------------------------------------

mod announced_open {
    use super::*;
    use near_sdk::json_types::U64;
    use near_sdk::serde_json::{json, Value};
    use near_sdk::PromiseOrValue;

    const SEC: u64 = 1_000_000_000;
    const ID: u64 = INSTANT_ID_BASE;
    const SEED: u128 = 250_000_000;

    /// One `ft_on_transfer` from `token`; returns what the market handed back and the logs of the call.
    fn call(m: &mut Market, token: &str, sender: &str, amount: u128, msg: Value, at_secs: u64) -> (u128, Vec<String>) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("market.test.near"))
            .predecessor_account_id(acct(token))
            .block_timestamp(at_secs * SEC)
            .build());
        let unused = match m.ft_on_transfer(acct(sender), U128(amount), msg.to_string()) {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => 0,
        };
        (unused, get_logs())
    }

    fn terms() -> Value {
        let t = kruxa_logic::FeeTerms { opening_fee_start_bps: 500, opening_decay_minutes: 60, ..kruxa_logic::FeeTerms::standard() };
        near_sdk::serde_json::to_value(t).unwrap()
    }

    fn seed_msg(trade_from: Option<u64>) -> Value {
        let mut v = json!({ "v": 1, "op": "seed_quote", "launch_id": ID.to_string(), "token": "tkn.test.near", "payout_recipient": "alice.test.near",
                            "creator": "alice.test.near", "total_supply": "1000000000000000", "charter_hash": "00", "terms": terms() });
        if let Some(t) = trade_from {
            v["trade_from_ns"] = json!(t.to_string());
        }
        v
    }

    fn buy(m: &mut Market, at_secs: u64) -> (u128, Vec<String>) {
        let msg = json!({ "v": 1, "op": "buy", "launch_id": ID.to_string(), "min_out": "1" });
        call(m, "usdc.test.near", "bob.test.near", 20_000_000, msg, at_secs)
    }

    /// A market with a launcher, an instant pool seeded at t=100 s and opened (token leg) at t=101 s.
    fn fresh_market() -> Market {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        market()
    }

    fn opened(trade_from: Option<u64>) -> Market {
        let mut m = fresh_market();
        at("owner.test.near", 0);
        m.set_launcher(acct("launcher.test.near"));
        let (unused, logs) = call(&mut m, "usdc.test.near", "launcher.test.near", SEED, seed_msg(trade_from), 100);
        assert_eq!(unused, 0, "{logs:?}");
        let tok = json!({ "v": 1, "op": "open_pool_token", "launch_id": ID.to_string() });
        let (unused, logs) = call(&mut m, "tkn.test.near", "launcher.test.near", 950_000_000_000_000, tok, 101);
        assert_eq!(unused, 0, "{logs:?}");
        m
    }

    #[test]
    fn a_pool_without_trade_from_trades_at_once() {
        for tf in [None, Some(0)] {
            let mut m = opened(tf);
            assert_eq!(trade_from_of(ID), 0);
            let (unused, logs) = buy(&mut m, 102);
            assert_eq!(unused, 0, "{logs:?}");
        }
    }

    #[test]
    fn a_buy_before_trade_from_is_refunded_with_the_rule_code_and_one_at_or_after_is_accepted() {
        let mut m = opened(Some(700 * SEC));
        assert_eq!(trade_from_of(ID), 700 * SEC);
        for t in [102, 699] {
            let (unused, logs) = buy(&mut m, t);
            assert_eq!(unused, 20_000_000, "the full amount comes back at {t}");
            assert!(logs.iter().any(|l| l.contains("R_NOT_YET_TRADING")), "{logs:?}");
        }
        assert_eq!(m.pools.get(&ID).unwrap().q, SEED, "a refused buy moves no reserve");
        let (unused, logs) = buy(&mut m, 700);
        assert_eq!(unused, 0, "{logs:?}");
        assert!(m.pools.get(&ID).unwrap().q > SEED);
    }

    #[test]
    fn the_opening_fee_clock_starts_at_trade_from() {
        let m = opened(Some(700 * SEC));
        at("anyone.test.near", 0);
        let first = m.quote_buy(U64(ID), U128(20_000_000), Some(U64(700 * SEC)));
        let later = m.quote_buy(U64(ID), U128(20_000_000), Some(U64(1_300 * SEC)));
        assert_eq!(first["ok"], true, "{first}");
        assert_eq!(first["fee_bps"], "500", "{first}: the full opening fee at trade_from, not decayed since the pool opened");
        let later_bps: u128 = later["fee_bps"].as_str().unwrap().parse().unwrap();
        assert!((100..500).contains(&later_bps), "{later}");
        let before = m.quote_buy(U64(ID), U128(20_000_000), Some(U64(699 * SEC)));
        assert_eq!((before["ok"].clone(), before["code"].clone()), (json!(false), json!("R_NOT_YET_TRADING")));
    }

    #[test]
    fn get_pool_shows_the_announced_open() {
        let m = opened(Some(700 * SEC));
        assert_eq!(m.get_pool(U64(ID))["trade_from_ns"], (700 * SEC).to_string());
        assert_eq!(opened(None).get_pool(U64(ID))["trade_from_ns"], "0");
    }

    #[test]
    fn a_seed_that_announces_more_than_an_hour_ahead_is_refused_and_returned() {
        let mut m = fresh_market();
        at("owner.test.near", 0);
        m.set_launcher(acct("launcher.test.near"));
        let (unused, logs) = call(&mut m, "usdc.test.near", "launcher.test.near", SEED, seed_msg(Some(100 * SEC + 3_601 * SEC)), 100);
        assert_eq!(unused, SEED);
        assert!(logs.iter().any(|l| l.contains("R_TRADE_FROM")), "{logs:?}");
        assert!(m.pools.get(&ID).is_none());
        let (unused, _) = call(&mut m, "usdc.test.near", "launcher.test.near", SEED, seed_msg(Some(100 * SEC + 3_600 * SEC)), 100);
        assert_eq!(unused, 0, "exactly one hour is allowed");
    }
}
