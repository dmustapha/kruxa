//! Integration and property tests for swarm-sim. Seeded fuzz is hand-rolled (the Rng is deterministic), so a failing
//! seed number reproduces the failure exactly: `cargo run -p swarm-sim -- run --seed N`.
use kruxa_logic::{Outcome, Rules, TrialParams};
use swarm_sim::book::{Book, ROUNDS, USDC, WALK_END};
use swarm_sim::invariants::{check_book, check_settlement, check_stream, stream_draw};
use swarm_sim::report::{summarize, to_json};
use swarm_sim::settle::settle;
use swarm_sim::sim::{run, Config};

fn go(cfg: &Config) -> (swarm_sim::sim::Run, swarm_sim::report::Summary) {
    let r = run(cfg).expect("setup");
    let s = summarize(&r);
    (r, s)
}

#[test]
fn recorded_seeds_hold_every_invariant_in_every_round() {
    for seed in 1..=3 {
        let (r, _) = go(&Config::for_seed(seed));
        assert_eq!(r.rounds.len(), ROUNDS as usize);
        assert!(r.violations().is_empty(), "seed {seed}: {:?}", r.violations());
        assert!(r.rounds.iter().all(|x| x.checks == 10));
    }
}

#[test]
fn same_seed_gives_byte_identical_json() {
    let a = to_json(&go(&Config::for_seed(2)).0, &go(&Config::for_seed(2)).1);
    let b = to_json(&go(&Config::for_seed(2)).0, &go(&Config::for_seed(2)).1);
    assert_eq!(a.to_string(), b.to_string());
}

#[test]
fn recorded_presets_show_pass_flip_and_fail() {
    let (_, s1) = go(&Config::for_seed(1));
    assert!(s1.passed && !s1.flip_succeeded, "seed 1: comfortable pass");
    let (r2, s2) = go(&Config::for_seed(2));
    assert!(s2.flip_succeeded && !s2.passed, "seed 2: the walk-flip lands");
    assert!(!s2.adversaries_beat_honest, "a successful flip is bounded, not a price or cap win");
    assert!(r2.settlement.positions.iter().all(|p| p.spend == 0 && p.refund == p.commit), "everyone refunded in full");
    let (_, s3) = go(&Config::for_seed(3));
    assert!(!s3.passed && !s3.flip_succeeded, "seed 3: cold crowd fails on its own");
}

#[test]
fn sweep_recorded_scenario_over_many_seeds() {
    let (mut pass, mut fail, mut flips) = (0, 0, 0);
    for seed in 1..=400 {
        let (r, s) = go(&Config::for_seed(seed));
        assert!(r.violations().is_empty(), "seed {seed}: {:?}", r.violations());
        assert!(!s.adversaries_beat_honest, "seed {seed}");
        assert!(s.price_parity, "seed {seed}: price deviation {} ppm", s.max_price_dev_ppm);
        pass += s.passed as u32;
        fail += !s.passed as u32;
        flips += s.flip_succeeded as u32;
    }
    assert!(pass > 20 && fail > 20, "sweep must exercise both verdicts: pass {pass} fail {fail}");
    assert!(flips > 0, "sweep must exercise a successful walk-flip");
}

#[test]
fn fuzz_wider_parameters_hold_invariants() {
    for seed in 1..=400 {
        let cfg = Config::fuzz(seed);
        let (r, s) = go(&cfg);
        assert!(r.violations().is_empty(), "fuzz seed {seed}: {:?}", r.violations());
        assert!(!s.adversaries_beat_honest && s.price_parity, "fuzz seed {seed}");
        for a in &r.book.accts {
            assert!(a.peak <= r.book.derived.wallet_cap, "fuzz seed {seed}: peak above wallet cap");
        }
    }
}

#[test]
fn a_flip_needs_a_margin_smaller_than_one_position_and_refunds_everyone() {
    for seed in 1..=400 {
        let (r, s) = go(&Config::for_seed(seed));
        if !s.flip_succeeded {
            continue;
        }
        let f = r.book.accts.iter().find(|a| a.walked_amount > 0 && a.walked_round == Some(23)).expect("flipper");
        let after = r.settlement.inputs.total_active;
        assert!(after < r.book.params.soft_cap && after + f.walked_amount >= r.book.params.soft_cap, "seed {seed}");
        assert!(f.walked_amount <= r.book.derived.wallet_cap);
        assert!(r.settlement.outcome != Outcome::Pass);
    }
}

#[test]
fn whales_and_snipers_are_blocked_by_rule_codes() {
    let (_, s) = go(&Config::for_seed(1));
    let n = |g: &str, c: &str| s.blocked.get(&(g.to_string(), c.to_string())).copied().unwrap_or(0);
    assert!(n("whale", "R_CAP_ACCOUNT") >= 2, "whale over-cap commits refused");
    assert!(n("sniper", "R_WRONG_PHASE") >= 2, "post-close commits refused");
    assert!(n("sybil", "R_CAP_ACCOUNT") >= 1, "the single 4x commit is refused");
}

#[test]
fn sybil_ring_gets_four_caps_and_is_not_blocked() {
    let (r, s) = go(&Config::for_seed(1));
    let ring: u128 = (11..15).map(|i| r.book.accts[i].peak).sum();
    assert_eq!(ring, 4 * r.book.derived.wallet_cap, "four accounts each at the cap: bounded, not blocked");
    assert_eq!(s.sybil_multiple_x100, 400);
}

#[test]
fn post_close_probes_refuse_walk_and_commit_and_open_settle() {
    let (r, _) = go(&Config::for_seed(1));
    let res: Vec<_> = r.probes.iter().map(|p| p.result).collect();
    assert_eq!(res, vec!["R_WALK_CLOSED", "R_WRONG_PHASE", "Ready"]);
}

// ---- admission rules against a small book ----

fn small_book(budgets: &[u128]) -> Book {
    Book::new(TrialParams::example("TST"), Rules::ladder(), budgets).expect("valid params")
}

#[test]
fn admission_rule_codes() {
    let mut b = small_book(&[500 * USDC, 500 * USDC]);
    assert_eq!(b.commit(0, 19 * USDC, 0), Err("R_MIN_CONTRIBUTION"));
    assert_eq!(b.commit(0, 101 * USDC, 0), Err("R_CAP_ACCOUNT"));
    assert_eq!(b.commit(0, 100 * USDC, 0), Ok(()));
    assert_eq!(b.commit(0, 20 * USDC, 0), Err("R_CAP_ACCOUNT"), "cap is on the running position");
    assert_eq!(b.commit(1, 20 * USDC, 20), Err("R_WRONG_PHASE"), "commit window ends at round 20");
    assert_eq!(b.commit(1, 20 * USDC, 19), Ok(()));
    assert_eq!(b.walk(1, WALK_END), Err("R_WALK_CLOSED"));
    assert_eq!(b.walk(1, WALK_END - 1), Ok(20 * USDC), "Walk still open on the last tail round");
    assert_eq!(b.walk(1, 5), Err("R_NO_POSITION"));
    assert!(check_book(&b, 0).is_empty());
}

#[test]
fn launch_ceiling_blocks_the_commit_that_would_cross_it() {
    let mut p = TrialParams::example("TST");
    p.wallet_bps = 500;
    let r = Rules { max_oversub_bps: 10_000, ..Rules::ladder() };
    let budgets = vec![100 * USDC; 12];
    let mut b = Book::new(p, r, &budgets).unwrap();
    for i in 0..10 {
        assert_eq!(b.commit(i, 100 * USDC, 0), Ok(()));
    }
    assert_eq!(b.commit(10, 20 * USDC, 0), Err("R_CAP_LAUNCH"), "ceiling = hard cap at 10000 bps");
}

#[test]
fn stream_cap_mirrors_the_contract() {
    let dur = 30 * 86_400 * 1_000_000_000u64;
    assert_eq!(stream_draw(1000, 0, dur, 0, 0, 1), Err("STREAM_CAP"));
    assert_eq!(stream_draw(1000, 0, dur, dur / 2, 0, 500), Ok(500));
    assert_eq!(stream_draw(1000, 0, dur, dur / 2, 500, 1), Err("STREAM_CAP"));
    assert_eq!(stream_draw(1000, 0, dur, dur, 500, 500), Ok(1000));
}

// ---- the checker can fail: deliberate bugs in test-only copies ----

fn funded_book() -> Book {
    let mut b = small_book(&[100 * USDC; 12]);
    for i in 0..12 {
        b.commit(i, 100 * USDC, 1).unwrap();
    }
    b
}

fn ids(v: &[swarm_sim::invariants::Violation]) -> Vec<&'static str> {
    v.iter().map(|x| x.id).collect()
}

#[test]
fn control_clean_book_has_no_violations() {
    let b = funded_book();
    assert!(check_book(&b, 3).is_empty());
    assert!(check_settlement(&b, &settle(&b), 3).is_empty());
    assert!(check_stream(&settle(&b), 30 * 86_400 * 1_000_000_000, 3).is_empty());
}

/// BUG 1: a commit path with the per-wallet cap check removed.
fn buggy_commit_no_cap(b: &mut Book, i: usize, amount: u128) {
    if b.accts[i].open == 0 {
        b.ledger_funders += 1;
    }
    b.accts[i].wallet -= amount;
    b.accts[i].open += amount;
    b.ledger_total += amount;
}

#[test]
fn checker_catches_a_missing_wallet_cap_check() {
    let mut b = small_book(&[1_000 * USDC]);
    buggy_commit_no_cap(&mut b, 0, 500 * USDC);
    let v = check_book(&b, 7);
    assert!(ids(&v).contains(&"K1"), "{v:?}");
    assert_eq!(v[0].round, 7, "violation carries its round");
}

/// BUG 2: a walk that shrinks the ledger but forgets to pay the wallet.
#[test]
fn checker_catches_a_walk_that_loses_funds() {
    let mut b = funded_book();
    b.accts[3].open = 0;
    b.ledger_total -= 100 * USDC;
    b.ledger_funders -= 1;
    assert!(ids(&check_book(&b, 4)).contains(&"C1"));
}

/// BUG 3: ledger counter drifts from the positions (a double-counted commit).
#[test]
fn checker_catches_ledger_drift() {
    let mut b = funded_book();
    b.ledger_total += 20 * USDC;
    let v = ids(&check_book(&b, 5));
    assert!(v.contains(&"C2"), "{v:?}");
}

/// BUG 4 to 7: settlement bugs injected into a copy of the correct settlement.
#[test]
fn checker_catches_settlement_bugs() {
    let b = funded_book();
    let good = settle(&b);
    assert_eq!(good.outcome, Outcome::Pass);

    let mut over = good.clone();
    over.positions[0].tokens += 1;
    assert!(ids(&check_settlement(&b, &over, 9)).contains(&"A1"), "token above entitlement");

    let mut refund = good.clone();
    refund.positions[1].refund += 1;
    assert!(ids(&check_settlement(&b, &refund, 9)).contains(&"A2"), "refund != commit - spend");

    let mut price = good.clone();
    price.positions[2].spend -= 1;
    price.positions[2].refund += 1;
    assert!(ids(&check_settlement(&b, &price, 9)).contains(&"A2"), "spend below the ceiling share (a discount)");

    let mut buckets = good.clone();
    buckets.alloc.as_mut().unwrap().stream += 1;
    assert!(ids(&check_settlement(&b, &buckets, 9)).contains(&"A3"), "buckets do not sum");

    let mut fail = settle(&small_book(&[100 * USDC]));
    assert_eq!(fail.outcome, Outcome::Fail(3));
    let mut fb = small_book(&[100 * USDC]);
    fb.commit(0, 100 * USDC, 0).unwrap();
    fail = settle(&fb);
    fail.positions[0].spend = 1;
    fail.positions[0].refund = 100 * USDC - 1;
    assert!(ids(&check_settlement(&fb, &fail, 9)).contains(&"A4"), "FAIL must refund in full");
}

#[test]
fn checker_catches_a_stream_without_a_cap() {
    let b = funded_book();
    let s = settle(&b);
    assert!(check_stream(&s, 0, 11).iter().any(|v| v.id == "T1"), "zero-duration stream lets the creator withdraw all at once");
}

#[test]
fn checker_catches_conservation_after_settlement() {
    let mut b = funded_book();
    b.accts[0].wallet += 1;
    let v = ids(&check_settlement(&b, &settle(&b), 9));
    assert!(v.contains(&"C1"), "{v:?}");
}
