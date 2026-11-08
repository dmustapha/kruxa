//! In-VM tests of the leg state machine (reviews N-01, N-03, N-05). The sandbox cannot interleave receipts or starve a callback
//! of gas, so these drive the callbacks directly with chosen promise results, prepaid gas and clock. Storage is the mocked
//! trie, so the code under test is the real code path (`Map`, `custody`, events), not a model of it.
use super::*;
use kruxa_instant::{derive, InstantParams};
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, Gas, PromiseResult, RuntimeFeesConfig};

const ID: u64 = INSTANT_ID_BASE;
const SEC: u64 = SEC_NS;
const SEED: u128 = 250_000_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn set_env(who: &str, prepaid: Gas, at_secs: u64, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(acct("instant.test.near"))
        .predecessor_account_id(acct(who))
        .prepaid_gas(prepaid)
        .block_timestamp(at_secs * SEC)
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

fn user_call(who: &str, at_secs: u64) {
    set_env(who, Gas::from_tgas(300), at_secs, vec![]);
}

/// A callback run: predecessor is the launcher itself.
fn callback(prepaid: Gas, at_secs: u64, result: PromiseResult) {
    set_env("instant.test.near", prepaid, at_secs, vec![result]);
}

fn amount(v: u128) -> PromiseResult {
    PromiseResult::Successful(format!("\"{v}\"").into_bytes())
}

fn pool(state: &str) -> PromiseResult {
    PromiseResult::Successful(format!(r#"{{"token":"tkn.factory.test.near","state":"{state}"}}"#).into_bytes())
}

fn no_pool() -> PromiseResult {
    PromiseResult::Successful(b"null".to_vec())
}

/// Ample prepaid gas: the mocked VM charges far more than the real one per host call, so 150 Tgas is not enough here.
fn big() -> Gas {
    Gas::from_tgas(1000)
}

/// A seeded launch (status `Seeded`, the seed still ours) on a fresh mocked chain.
fn seeded() -> Launcher {
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    user_call("owner.test.near", 1);
    let mut l = Launcher::new(
        acct("owner.test.near"),
        acct("guardian.test.near"),
        acct("treasury.test.near"),
        acct("usdc.test.near"),
        acct("factory.test.near"),
        "demo".to_string(),
    );
    l.cfg.market = Some(acct("market.test.near"));
    l.cfg.market_locked = true;
    let params = InstantParams::example("TKN");
    let derived = derive(&params, &l.limits()).unwrap();
    let r = Instant {
        launch_id: ID,
        creator: acct("alice.test.near"),
        payout_recipient: acct("alice.test.near"),
        params,
        derived: derived.clone(),
        charter_hash: [0; 32],
        token: acct("tkn.factory.test.near"),
        status: Status::Seeded,
        created_at: 1,
        seeded_at: 1,
        opened_at: 0,
        inflight_since: 0,
        seed_total: SEED,
        seed_due: SEED,
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
    };
    l.seeds_held = SEED;
    l.seed_due_total = SEED;
    l.custody_add(&acct("usdc.test.near"), SEED);
    l.custody_add(&acct("tkn.factory.test.near"), derived.n_total);
    l.save(r);
    l
}

fn rec(l: &Launcher) -> Instant {
    l.instant(ID)
}

fn usdc_custody(l: &Launcher) -> u128 {
    l.custody_of(&acct("usdc.test.near"))
}

fn token_custody(l: &Launcher) -> u128 {
    l.custody_of(&acct("tkn.factory.test.near"))
}

fn open(l: &mut Launcher, at_secs: u64) {
    user_call("anyone.test.near", at_secs);
    l.open_instant(U64(ID));
}

fn seed_cb(l: &mut Launcher, nonce: u64, result: PromiseResult, prepaid: Gas, at_secs: u64) {
    callback(prepaid, at_secs, result);
    l.on_instant_leg(U64(ID), Leg::Seed, U128(SEED), U64(nonce));
}

// ---- N-01: a stale reconcile view must not book over a newer in-flight leg --------------------------------------------

#[test]
fn n01_a_stale_view_cannot_rebook_a_newer_token_leg() {
    let mut l = seeded();
    open(&mut l, 10); // seed leg, nonce 1
    user_call("stranger.test.near", 400);
    let _ = l.reconcile(U64(ID)); // requests a view stamped with nonce 1
    let stamped = rec(&l).leg_nonce;
    assert_eq!(stamped, 1);
    // meanwhile the seed callback lands, consumes the seed and sends the token leg
    seed_cb(&mut l, 1, amount(SEED), big(), 401);
    let r = rec(&l);
    let n_pool = r.derived.n_pool;
    assert_eq!((r.seed_sent, r.tokens_inflight, r.leg_nonce), (SEED, n_pool, 2), "token leg is out");
    let held_before = token_custody(&l);
    // the stale view (taken before the token leg: pool exists but awaits its token) arrives
    callback(Gas::from_tgas(30), 402, pool("AwaitToken"));
    l.on_reconcile(U64(ID), U64(stamped));
    let r = rec(&l);
    assert_eq!((r.tokens_inflight, r.tokens_sent), (n_pool, 0), "the live token leg stays in flight: {}", r.tokens_inflight);
    assert_eq!(token_custody(&l), held_before, "the bucket was not re-credited while it sits in the market");
    // a view requested after the token leg (nonce 2) is honoured
    callback(Gas::from_tgas(30), 403, pool("Open"));
    l.on_reconcile(U64(ID), U64(2));
    let r = rec(&l);
    assert_eq!((r.status, r.tokens_inflight, r.tokens_sent), (Status::Open, 0, n_pool));
}

#[test]
fn n01_a_stale_none_view_cannot_refund_a_seed_the_market_consumed() {
    let mut l = seeded();
    open(&mut l, 10); // seed leg 1, nonce 1
    user_call("stranger.test.near", 400);
    let _ = l.reconcile(U64(ID)); // view stamped nonce 1 (the market will answer "no pool")
                                  // leg 1 comes back refused (used 0): the seed is ours again; anyone re-sends it (nonce 2)
    seed_cb(&mut l, 1, amount(0), big(), 401);
    assert_eq!((rec(&l).seed_due, rec(&l).seed_inflight), (SEED, 0));
    open(&mut l, 402);
    assert_eq!((rec(&l).seed_inflight, rec(&l).leg_nonce), (SEED, 2));
    // the stale none-view lands now
    callback(Gas::from_tgas(30), 403, no_pool());
    l.on_reconcile(U64(ID), U64(1));
    let r = rec(&l);
    assert_eq!((r.seed_inflight, r.seed_due), (SEED, 0), "the re-sent leg is still in flight, not booked as unused");
    // 72 hours later the creator cannot pull the seed back while the market may hold it
    user_call("alice.test.near", 402 + 72 * 10 + 5); // demo unit is 10 s
    let usdc_before = usdc_custody(&l);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l.abort_instant(U64(ID))));
    assert!(refused.is_err(), "abort_instant must refuse while a leg is in flight");
    assert_eq!(usdc_custody(&l), usdc_before);
    // and the real answer of leg 2 still books
    seed_cb(&mut l, 2, amount(SEED), big(), 900);
    assert_eq!((rec(&l).seed_sent, rec(&l).seed_due), (SEED, 0));
}

#[test]
fn n01_a_late_callback_of_an_older_leg_is_ignored() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, amount(0), big(), 11); // refused
    open(&mut l, 12); // re-sent: nonce 2, same amount in flight
    seed_cb(&mut l, 1, amount(SEED), big(), 13); // a duplicate of leg 1's callback shows up late
    assert_eq!((rec(&l).seed_inflight, rec(&l).seed_sent), (SEED, 0), "leg 2 untouched by leg 1's callback");
    seed_cb(&mut l, 2, amount(SEED), big(), 14);
    assert_eq!((rec(&l).seed_inflight, rec(&l).seed_sent), (0, SEED));
}

// ---- N-05: failed or unreadable answers stay reconcilable ---------------------------------------------------------------

#[test]
fn n05_a_failed_leg_the_market_actually_consumed_is_found_by_reconcile() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, PromiseResult::Failed, big(), 11);
    let r = rec(&l);
    assert_eq!((r.seed_due, r.seed_sent, r.unconfirmed, r.unconfirmed_amount), (SEED, 0, Unconfirmed::Seed, SEED));
    // the creator cannot take the seed back while the market may hold it
    user_call("alice.test.near", 10_000);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l.abort_instant(U64(ID))));
    assert!(refused.is_err(), "abort_instant waits for reconcile");
    // reconcile needs no five-minute wait for an unconfirmed leg
    user_call("stranger.test.near", 12);
    let _ = l.reconcile(U64(ID));
    callback(Gas::from_tgas(30), 13, pool("AwaitToken"));
    l.on_reconcile(U64(ID), U64(1));
    let r = rec(&l);
    assert_eq!((r.seed_due, r.seed_sent, r.unconfirmed, r.unconfirmed_amount), (0, SEED, Unconfirmed::No, 0));
    assert_eq!((l.seed_due_total, l.seeds_held, usdc_custody(&l)), (0, 0, 0), "counters follow the seed into the market");
    // the next open_instant sends the token leg
    open(&mut l, 14);
    assert_eq!(rec(&l).tokens_inflight, rec(&l).derived.n_pool);
}

#[test]
fn n05_a_failed_leg_the_market_never_saw_is_cleared_and_abortable() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, PromiseResult::Failed, big(), 11);
    user_call("stranger.test.near", 12);
    let _ = l.reconcile(U64(ID));
    callback(Gas::from_tgas(30), 13, no_pool());
    l.on_reconcile(U64(ID), U64(1));
    let r = rec(&l);
    assert_eq!((r.seed_due, r.seed_sent, r.unconfirmed), (SEED, 0, Unconfirmed::No));
    user_call("alice.test.near", 1 + 72 * 10 + 1);
    let _ = l.abort_instant(U64(ID));
    assert_eq!(rec(&l).status, Status::Aborted);
}

#[test]
fn n05_an_unconfirmed_answer_is_dropped_if_a_newer_leg_was_sent() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, PromiseResult::Failed, big(), 11);
    user_call("stranger.test.near", 12);
    let _ = l.reconcile(U64(ID)); // stamped nonce 1
    open(&mut l, 13); // creator re-sends before the view lands: nonce 2
    callback(Gas::from_tgas(30), 14, no_pool());
    l.on_reconcile(U64(ID), U64(1));
    let r = rec(&l);
    assert_eq!((r.seed_inflight, r.unconfirmed), (SEED, Unconfirmed::Seed), "nothing changed");
}

#[test]
fn n05_a_long_answer_is_not_read_as_a_failure() {
    let mut l = seeded();
    open(&mut l, 10);
    // a valid amount padded past the 64-byte read cap: the status is success, the amount is unreadable
    let padded = format!("\"{SEED}\"{}", " ".repeat(200)).into_bytes();
    seed_cb(&mut l, 1, PromiseResult::Successful(padded), big(), 11);
    let r = rec(&l);
    assert_eq!((r.seed_sent, r.unconfirmed), (0, Unconfirmed::Seed), "unknown, so reconcilable, not silently final");
    user_call("stranger.test.near", 12);
    let _ = l.reconcile(U64(ID));
    callback(Gas::from_tgas(30), 13, pool("AwaitToken"));
    l.on_reconcile(U64(ID), U64(1));
    assert_eq!((rec(&l).seed_sent, rec(&l).unconfirmed), (SEED, Unconfirmed::No));
}

#[test]
fn n05_a_consumed_resend_clears_the_mark() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, PromiseResult::Failed, big(), 11);
    open(&mut l, 12);
    seed_cb(&mut l, 2, amount(SEED), big(), 13);
    assert_eq!((rec(&l).seed_sent, rec(&l).unconfirmed, rec(&l).unconfirmed_amount), (SEED, Unconfirmed::No, 0));
}

#[test]
fn n05_a_failed_token_leg_the_market_consumed_opens_the_launch() {
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, amount(SEED), big(), 11); // sends the token leg, nonce 2
    let n_pool = rec(&l).derived.n_pool;
    callback(Gas::from_tgas(30), 12, PromiseResult::Failed);
    l.on_instant_leg(U64(ID), Leg::Token, U128(n_pool), U64(2));
    let r = rec(&l);
    assert_eq!((r.tokens_sent, r.unconfirmed, r.status), (0, Unconfirmed::Token, Status::Handoff));
    user_call("stranger.test.near", 13);
    let _ = l.reconcile(U64(ID));
    callback(Gas::from_tgas(30), 14, pool("Open"));
    l.on_reconcile(U64(ID), U64(2));
    let r = rec(&l);
    assert_eq!((r.tokens_sent, r.unconfirmed, r.status), (n_pool, Unconfirmed::No, Status::Open));
    assert_eq!(token_custody(&l), r.derived.n_alloc, "only the creator allocation is still held");
}

#[test]
fn n05_resolve_payout_decides_success_from_the_status_alone() {
    let mut l = seeded();
    let (token, to) = (acct("tkn.factory.test.near"), acct("alice.test.near"));
    // a token whose ft_transfer returns a long value: the transfer happened, nothing is owed
    callback(Gas::from_tgas(20), 20, PromiseResult::Successful(vec![b'x'; 4096]));
    l.resolve_payout(token.clone(), to.clone(), U128(7), "alloc".to_string());
    assert_eq!(l.owed_of(&to, &token), 0, "a long answer must not be read as a failed transfer (double pay)");
    callback(Gas::from_tgas(20), 21, PromiseResult::Failed);
    l.resolve_payout(token.clone(), to.clone(), U128(7), "alloc".to_string());
    assert_eq!(l.owed_of(&to, &token), 7, "a failed transfer is still owed");
}

// ---- N-03: the callback sends the token leg only with 145 Tgas left; the next open_instant finishes the job -------------

#[test]
fn n03_the_gas_rule_flips_exactly_at_145_tgas_left() {
    let need = NEED_FOR_TOKEN_LEG.as_gas();
    let used = Gas::from_tgas(3);
    let prepaid = |extra: i64| Gas::from_gas((used.as_gas() as i64 + need as i64 + extra) as u64);
    assert!(!open::enough_gas_for_token_leg(prepaid(-1), used), "one gas short");
    assert!(open::enough_gas_for_token_leg(prepaid(0), used), "exactly enough");
    assert!(open::enough_gas_for_token_leg(prepaid(1), used));
    assert!(!open::enough_gas_for_token_leg(used, Gas::from_tgas(5)), "used above prepaid saturates, never wraps to a huge remainder");
}

#[derive(Debug, PartialEq, Eq)]
enum Reaction {
    Skipped,
    Sent,
    /// The check passed but the mocked VM (several times dearer than the real one) ran dry creating the promises.
    RanDry,
}

fn seed_cb_reaction(prepaid: Gas) -> Reaction {
    let mut l = seeded();
    open(&mut l, 10);
    callback(prepaid, 11, amount(SEED));
    let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l.on_instant_leg(U64(ID), Leg::Seed, U128(SEED), U64(1))));
    match (run.is_ok(), run.is_ok() && rec(&l).tokens_inflight > 0) {
        (false, _) => Reaction::RanDry,
        (true, true) => Reaction::Sent,
        (true, false) => Reaction::Skipped,
    }
}

/// Smallest prepaid gas at which the callback gets past the check, found by bisection on the real callback.
fn threshold() -> u64 {
    let (mut lo, mut hi) = (Gas::from_tgas(1).as_gas(), Gas::from_tgas(1000).as_gas());
    assert_ne!(seed_cb_reaction(Gas::from_gas(hi)), Reaction::Skipped);
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if seed_cb_reaction(Gas::from_gas(mid)) == Reaction::Skipped {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    hi
}

#[test]
fn n03_the_callback_skips_the_token_leg_one_gas_below_the_threshold_and_sends_it_at_and_above() {
    let t = threshold();
    // the callback's own gas before the check is what lifts the flip point above 145 Tgas
    assert!(t > NEED_FOR_TOKEN_LEG.as_gas(), "flip at {t}");
    assert_eq!(seed_cb_reaction(Gas::from_gas(t - 1)), Reaction::Skipped, "one gas below the flip: skip");
    assert_ne!(seed_cb_reaction(Gas::from_gas(t)), Reaction::Skipped, "at the flip: past the check");
    assert_eq!(seed_cb_reaction(Gas::from_tgas(300)), Reaction::Sent, "well above: the leg is created");
}

#[test]
fn n03_a_skipped_token_leg_is_sent_by_the_next_open_and_the_launch_opens() {
    let t = threshold();
    let mut l = seeded();
    open(&mut l, 10);
    seed_cb(&mut l, 1, amount(SEED), Gas::from_gas(t - 1), 11); // skip branch
    let r = rec(&l);
    assert_eq!((r.status, r.seed_sent, r.seed_due, r.tokens_inflight, r.tokens_sent), (Status::Handoff, SEED, 0, 0, 0));
    assert_eq!((l.seed_due_total, l.seeds_held), (0, 0), "the seed counts as consumed");
    open(&mut l, 12); // retry: sends only the token leg
    let r = rec(&l);
    assert_eq!((r.tokens_inflight, r.leg_nonce), (r.derived.n_pool, 2));
    let n_pool = r.derived.n_pool;
    callback(big(), 13, amount(n_pool));
    l.on_instant_leg(U64(ID), Leg::Token, U128(n_pool), U64(2));
    let r = rec(&l);
    assert_eq!((r.status, r.tokens_sent, r.tokens_inflight), (Status::Open, n_pool, 0));
    assert_eq!(token_custody(&l), r.derived.n_alloc);
}
