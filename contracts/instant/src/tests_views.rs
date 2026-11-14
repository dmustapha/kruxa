//! In-VM tests of the creator index, `declared_wallets`, `solvency_report` and the announced open (CO-7 2.7, 2.13). Same mocked
//! trie as `tests.rs`, so `Map`, the side records and the views run for real.
use super::*;
use kruxa_instant::InstantParams;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, Gas, NearToken, RuntimeFeesConfig};
use std::panic::{catch_unwind, AssertUnwindSafe};

const SEC: u64 = SEC_NS;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, at_secs: u64, deposit: u128) {
    let c = VMContextBuilder::new()
        .current_account_id(acct("instant.test.near"))
        .predecessor_account_id(acct(who))
        .prepaid_gas(Gas::from_tgas(1000))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(at_secs * SEC)
        .build();
    testing_env!(c, near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![]);
}

fn launcher() -> Launcher {
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    ctx("owner.test.near", 1, 0);
    let mut l = Launcher::new(
        acct("owner.test.near"),
        acct("guardian.test.near"),
        acct("treasury.test.near"),
        acct("usdc.test.near"),
        acct("factory.test.near"),
        "demo".to_string(),
    );
    l.cfg.market = Some(acct("market.test.near"));
    l
}

/// A launch by `who` at `at_secs` (the demo day is 10 s, so launches of one creator are 11 s apart).
fn create(l: &mut Launcher, who: &str, symbol: &str, at_secs: u64, delay: u32) -> u64 {
    ctx(who, at_secs, l.required());
    let before = l.next_id;
    let params = InstantParams { trade_delay_secs: delay, ..InstantParams::example(symbol) };
    let _ = l.create_instant(params, None);
    INSTANT_ID_BASE + before
}

fn view(v: Box<near_sdk::serde_json::value::RawValue>) -> Value {
    serde_json::from_str(v.get()).unwrap()
}

fn ids(page: &Value) -> Vec<String> {
    page["items"].as_array().unwrap().iter().map(|i| i["launch_id"].as_str().unwrap().to_string()).collect()
}

fn refused(f: impl FnOnce()) -> String {
    let e = catch_unwind(AssertUnwindSafe(f)).expect_err("must panic");
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

#[test]
fn the_creator_index_lists_each_creators_launches_oldest_first_and_pages() {
    let mut l = launcher();
    let a1 = create(&mut l, "alice.test.near", "AAA", 10, 600);
    let b1 = create(&mut l, "bob.test.near", "BBB", 12, 600);
    let a2 = create(&mut l, "alice.test.near", "ACA", 30, 600);
    let a3 = create(&mut l, "alice.test.near", "ADA", 50, 600);
    let all = view(l.instants_by_creator(acct("alice.test.near"), None, None));
    assert_eq!((all["total"].as_str(), ids(&all)), (Some("3"), vec![a1.to_string(), a2.to_string(), a3.to_string()]));
    assert_eq!(all["items"][0]["symbol"], "AAA");
    assert_eq!(all["items"][0]["status"], "Creating");
    assert_eq!(ids(&view(l.instants_by_creator(acct("bob.test.near"), None, None))), vec![b1.to_string()]);
    let p1 = view(l.instants_by_creator(acct("alice.test.near"), Some(0), Some(2)));
    let p2 = view(l.instants_by_creator(acct("alice.test.near"), Some(2), Some(2)));
    assert_eq!((ids(&p1), ids(&p2)), (vec![a1.to_string(), a2.to_string()], vec![a3.to_string()]));
    assert_eq!(p2["from_index"], "2");
    let past = view(l.instants_by_creator(acct("alice.test.near"), Some(3), Some(5)));
    assert!(ids(&past).is_empty() && past["total"] == "3");
    let none = view(l.instants_by_creator(acct("carol.test.near"), None, None));
    assert!(ids(&none).is_empty() && none["total"] == "0");
    assert_eq!(ids(&view(l.instants_by_creator(acct("alice.test.near"), Some(u64::MAX), Some(u64::MAX)))).len(), 0, "no overflow");
    assert_eq!(ids(&view(l.instants_by_creator(acct("alice.test.near"), Some(0), Some(0)))).len(), 0, "limit 0 is an empty page");
}

#[test]
fn a_page_is_at_most_fifty_long() {
    assert_eq!((side::DEFAULT_PAGE, side::MAX_PAGE), (20, 50));
    let mut l = launcher();
    let creator = acct("alice.test.near");
    for i in 0..60u64 {
        let r = Instant { launch_id: INSTANT_ID_BASE + i, creator: creator.clone(), ..stored_launch() };
        l.save(r.clone());
        assert!(l.index_creator(&r));
    }
    l.next_id = 60;
    assert_eq!(ids(&view(l.instants_by_creator(creator.clone(), None, Some(1_000)))).len(), 50);
    assert_eq!(ids(&view(l.instants_by_creator(creator.clone(), None, None))).len(), 20);
    assert_eq!(ids(&view(l.instants_by_creator(creator, Some(50), Some(1_000)))).len(), 10);
}

/// A bare record, for tests that store launches the way an older launcher did (no side records).
fn stored_launch() -> Instant {
    let params = InstantParams::example("TMP");
    let derived = kruxa_instant::derive(&params, &kruxa_instant::Limits::standard(0)).unwrap();
    Instant {
        launch_id: INSTANT_ID_BASE,
        creator: acct("tmp.test.near"),
        payout_recipient: acct("tmp.test.near"),
        params,
        derived,
        charter_hash: [0; 32],
        token: acct("tmp.factory.test.near"),
        status: Status::TokenReady,
        created_at: 1,
        seeded_at: 0,
        opened_at: 0,
        inflight_since: 0,
        seed_total: 0,
        seed_due: 0,
        seed_inflight: 0,
        seed_sent: 0,
        fee_held: 0,
        tokens_sent: 0,
        tokens_inflight: 0,
        claimed: 0,
        deposit_paid: 0,
        deposit_refundable: 0,
        market_prepared: false,
        leg_nonce: 0,
        unconfirmed: Unconfirmed::No,
        unconfirmed_amount: 0,
    }
}

#[test]
fn declared_wallets_are_the_creator_and_the_payout_recipient_once() {
    let mut l = launcher();
    let same = create(&mut l, "alice.test.near", "AAA", 10, 600);
    ctx("bob.test.near", 12, l.required());
    let _ = l.create_instant(InstantParams::example("BBB"), Some(acct("pay.test.near")));
    let split = INSTANT_ID_BASE + 1;
    let w = view(l.declared_wallets(U64(same)).unwrap());
    assert_eq!(w["wallets"], serde_json::json!(["alice.test.near"]));
    assert_eq!((w["creator"].as_str(), w["payout_recipient"].as_str()), (Some("alice.test.near"), Some("alice.test.near")));
    let w = view(l.declared_wallets(U64(split)).unwrap());
    assert_eq!(w["wallets"], serde_json::json!(["bob.test.near", "pay.test.near"]));
    assert!(l.declared_wallets(U64(INSTANT_ID_BASE + 99)).is_none());
}

#[test]
fn solvency_report_names_the_expected_custody_and_the_owed_part() {
    let mut l = launcher();
    let (usdc, tok) = (acct("usdc.test.near"), acct("tkn.factory.test.near"));
    l.custody_add(&usdc, 500);
    l.custody_add(&tok, 7);
    l.owed_credit(&acct("alice.test.near"), &usdc, 40);
    let r = view(l.solvency_report(usdc.clone()));
    assert_eq!(
        (r["token"].as_str(), r["expected_custody"].as_str(), r["owed_total"].as_str()),
        (Some("usdc.test.near"), Some("540"), Some("40"))
    );
    let t = view(l.solvency_report(tok));
    assert_eq!((t["expected_custody"].as_str(), t["owed_total"].as_str()), (Some("7"), Some("0")));
    assert_eq!(view(l.solvency_report(acct("other.test.near")))["expected_custody"], "0");
}

#[test]
fn the_delay_is_recorded_validated_and_reported() {
    let mut l = launcher();
    let a = create(&mut l, "alice.test.near", "AAA", 10, 600);
    let b = create(&mut l, "bob.test.near", "BBB", 12, 0);
    let c = create(&mut l, "carol.test.near", "CCC", 14, 3_600);
    for (id, want) in [(a, 600), (b, 0), (c, 3_600)] {
        let v = view(l.get_instant(U64(id)).unwrap());
        assert_eq!((v["trade_delay_secs"].as_u64(), v["trade_from_ns"].as_str()), (Some(want), Some("0")), "{id}");
    }
    ctx("dave.test.near", 16, l.required());
    let msg = refused(|| {
        let _ = l.create_instant(InstantParams { trade_delay_secs: 3_601, ..InstantParams::example("DDD") }, None);
    });
    assert!(msg.contains("R_TRADE_DELAY"), "{msg}");
    assert_eq!(l.next_id, 3, "a refused delay creates nothing");
    let p = view(l.preview_instant(InstantParams { trade_delay_secs: 4_000, ..InstantParams::example("DDD") }, None));
    assert_eq!(p["ok"], false);
    assert_eq!(p["violations"][0]["code"], "R_TRADE_DELAY");
}

#[test]
fn the_charter_hash_covers_a_non_zero_delay_and_only_then() {
    let mut l = launcher();
    let a = create(&mut l, "alice.test.near", "AAA", 10, 600);
    let b = create(&mut l, "alice.test.near", "AAB", 30, 0);
    let (ra, rb) = (l.instant(a), l.instant(b));
    // same creator, symbol-independent derived data: only launch id, created_at and the delay differ; rebuild each hash by hand
    let plain = |r: &Instant| {
        let c = Charter {
            launch_id: r.launch_id,
            launcher: env::current_account_id(),
            creator: r.creator.clone(),
            payout_recipient: r.payout_recipient.clone(),
            created_at: r.created_at,
            unit_ns: l.cfg.unit_ns,
            params: r.params.clone(),
            derived: r.derived.clone(),
        };
        near_sdk::borsh::to_vec(&c).unwrap()
    };
    assert_eq!(rb.charter_hash, env::sha256_array(plain(&rb)), "delay 0 hashes exactly as before");
    let mut with_delay = plain(&ra);
    with_delay.extend_from_slice(&600u32.to_le_bytes());
    assert_eq!(ra.charter_hash, env::sha256_array(with_delay));
    assert_ne!(ra.charter_hash, env::sha256_array(plain(&ra)));
}

/// A launch stored the way an older launcher stored it: a record and nothing beside it.
fn legacy(l: &mut Launcher, id: u64, creator: &str) {
    let r = Instant { launch_id: id, creator: acct(creator), ..stored_launch() };
    l.save(r);
}

#[test]
fn a_launch_stored_before_these_records_reads_as_delay_zero_and_not_indexed_until_backfilled() {
    let mut l = launcher();
    legacy(&mut l, INSTANT_ID_BASE, "alice.test.near");
    legacy(&mut l, INSTANT_ID_BASE + 1, "alice.test.near");
    l.next_id = 2;
    let v = view(l.get_instant(U64(INSTANT_ID_BASE)).unwrap());
    assert_eq!((v["trade_delay_secs"].as_u64(), v["trade_from_ns"].as_str()), (Some(0), Some("0")));
    assert_eq!(view(l.instants_by_creator(acct("alice.test.near"), None, None))["total"], "0");
    ctx("anyone.test.near", 20, 0);
    assert_eq!(l.index_creators(U64(INSTANT_ID_BASE), 10), 2);
    assert_eq!(l.index_creators(U64(INSTANT_ID_BASE), 10), 0, "idempotent");
    let page = view(l.instants_by_creator(acct("alice.test.near"), None, None));
    assert_eq!(ids(&page), vec![INSTANT_ID_BASE.to_string(), (INSTANT_ID_BASE + 1).to_string()]);
    for bad in [(0, 5), (INSTANT_ID_BASE, 0), (INSTANT_ID_BASE, 51)] {
        assert!(
            refused(|| {
                let _ = l.index_creators(U64(bad.0), bad.1);
            })
            .contains("R_NOTHING"),
            "{bad:?}"
        );
    }
}

#[test]
fn a_new_launch_is_indexed_once_and_the_backfill_does_not_add_it_again() {
    let mut l = launcher();
    let a = create(&mut l, "alice.test.near", "AAA", 10, 600);
    ctx("anyone.test.near", 20, 0);
    assert_eq!(l.index_creators(U64(a), 5), 0);
    assert_eq!(view(l.instants_by_creator(acct("alice.test.near"), None, None))["total"], "1");
}

#[test]
fn the_seed_leg_announces_the_open_delay_seconds_after_it_is_sent_and_zero_announces_nothing() {
    for (delay, want) in [(600u64, Some(1_000 + 600)), (0, Some(0))] {
        let mut l = launcher();
        let id = create(&mut l, "alice.test.near", "AAA", 10, delay as u32);
        let mut r = l.instant(id);
        r.status = Status::Seeded;
        r.seed_total = 250_000_000;
        r.seed_due = 250_000_000;
        l.seed_due_total = 250_000_000;
        l.custody_add(&acct("usdc.test.near"), 250_000_000);
        l.save(r);
        ctx("anyone.test.near", 1_000, 0);
        l.open_instant(U64(id));
        let v = view(l.get_instant(U64(id)).unwrap());
        assert_eq!(v["trade_from_ns"].as_str().map(|s| s.parse::<u64>().unwrap() / SEC), want, "delay {delay}");
    }
}
