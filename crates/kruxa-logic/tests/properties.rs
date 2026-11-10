//! Property layer (PLAN Depth 2, AUDIT-PLAN item 8): P-NO-OVERPAY, P-ORDER-INDEPENDENCE, P-WALK-MONOTONE, P-STATE-MACHINE, P-CONSOL.
//! The other named properties already live next to the code: P-CONSERVATION in `settle.rs` (`conservation_across_random_books`),
//! P-RECOMPUTE in `book.rs`, and the stream cap monotone test in the contract tests. Every property here runs 10,000 cases.
//! Run: `cargo test -p kruxa-logic --test properties`.
use kruxa_logic::*;
use proptest::collection::vec;
use proptest::prelude::*;

const U: u128 = 1_000_000;
const N_SALE: u128 = 600_000_000_000_000;
const N_BACKER: u128 = 50_000_000_000_000;

fn commits() -> impl Strategy<Value = Vec<u128>> {
    vec(20 * U..=100 * U, 10..60)
}

fn contributed(commits: &[(usize, u128)]) -> Vec<BookEvent> {
    commits.iter().map(|(i, net)| BookEvent::Contributed { holder: format!("near:u{i}"), net: *net }).collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// P-NO-OVERPAY: no buyer is charged more than their pro-rata share (ceiling, so at most one unit above exact), refunds never exceed
    /// the excess pool, and the sale and bonus tokens handed out never exceed what exists. `i5_no_overpay` is the ledger-side check.
    #[test]
    fn p_no_overpay(commits in commits(), hard in 500 * U..=1_000 * U) {
        let total: u128 = commits.iter().sum();
        prop_assume!(total >= 350 * U);
        let a = allocate(total, hard, 6_000, 2_500, &Rules::ladder()).unwrap();
        let (mut refunds, mut tokens, mut bonus) = (0u128, 0u128, 0u128);
        for c in &commits {
            let s = settle_position(*c, total, a.accepted, N_SALE, N_BACKER).unwrap();
            prop_assert!(s.spend <= *c, "charged more than committed");
            prop_assert!(s.spend == 0 || (s.spend - 1) * total < *c * a.accepted, "charged more than the ceiling of the pro-rata share");
            (refunds, tokens, bonus) = (refunds + s.refund, tokens + s.tokens, bonus + s.bonus);
        }
        prop_assert!(i5_no_overpay(&[("refunds", refunds, a.excess_pool), ("sale tokens", tokens, N_SALE), ("bonus tokens", bonus, N_BACKER)]).is_ok());
    }

    /// P-ORDER-INDEPENDENCE: the arrival order of the same commits changes nothing a buyer is owed (uniform price) and nothing in the
    /// verdict inputs. The rolling `book_hash` DOES depend on order by design (it commits to the sequence), so only totals are compared.
    #[test]
    fn p_order_independence((a, b) in commits().prop_flat_map(|v| (Just(v.clone()), Just(v).prop_shuffle())), hard in 500 * U..=1_000 * U) {
        let (total_a, total_b): (u128, u128) = (a.iter().sum(), b.iter().sum());
        prop_assert_eq!(total_a, total_b);
        prop_assume!(total_a >= 350 * U);
        let alloc = allocate(total_a, hard, 6_000, 2_500, &Rules::ladder()).unwrap();
        let owed = |v: &[u128]| {
            let mut out: Vec<_> = v.iter().map(|c| { let s = settle_position(*c, total_a, alloc.accepted, N_SALE, N_BACKER).unwrap(); (*c, s.spend, s.refund, s.tokens, s.bonus) }).collect();
            out.sort_unstable();
            out
        };
        prop_assert_eq!(owed(&a), owed(&b));
        let fa = fold_book(&contributed(&a.iter().copied().enumerate().collect::<Vec<_>>())).unwrap();
        let idx: Vec<(usize, u128)> = b.iter().copied().enumerate().collect();
        let fb = fold_book(&contributed(&idx)).unwrap();
        prop_assert_eq!((fa.total_active, fa.active_funders), (fb.total_active, fb.active_funders));
    }

    /// P-WALK-MONOTONE: a Walk removes exactly the walker's whole amount and one funder, total_active never rises, and a FAIL can never
    /// become a PASS by walking (the set of failure reasons only grows).
    #[test]
    fn p_walk_monotone(commits in commits(), mask in vec(any::<bool>(), 60), soft in 200 * U..=2_000 * U, min_funders in 1u32..40) {
        let indexed: Vec<(usize, u128)> = commits.iter().copied().enumerate().collect();
        let mut events = contributed(&indexed);
        let before = fold_book(&events).unwrap();
        let walkers: Vec<(usize, u128)> = indexed.iter().filter(|(i, _)| mask[*i]).copied().collect();
        events.extend(walkers.iter().map(|(i, net)| BookEvent::Walked { holder: format!("near:u{i}"), amount: *net }));
        let after = fold_book(&events).unwrap();
        for w in after.steps[commits.len()..].windows(2) {
            prop_assert!(w[1].0 < w[0].0 && w[1].1 + 1 == w[0].1, "each walk removes the whole amount and exactly one funder");
        }
        prop_assert_eq!(after.total_active, before.total_active - walkers.iter().map(|(_, n)| n).sum::<u128>());
        prop_assert_eq!(after.active_funders as usize, commits.len() - walkers.len());
        let inputs = |f: &Folded| VerdictInputs { launch_id: 1, charter_hash: [7; 32], total_active: f.total_active, active_funders: f.active_funders, soft_cap: soft, min_funders, cancelled: false };
        if let Outcome::Fail(r0) = verdict(&inputs(&before)) {
            prop_assert!(matches!(verdict(&inputs(&after)), Outcome::Fail(r1) if r1 & r0 == r0), "a FAIL stayed a FAIL and kept its reasons");
        }
        if let Some((i, net)) = walkers.first() {
            let again = [events.clone(), vec![BookEvent::Walked { holder: format!("near:u{i}"), amount: *net }]].concat();
            prop_assert!(matches!(fold_book(&again), Err(FoldError::WalkWithoutPosition { .. })), "a second Walk has nothing to remove");
        }
    }

    /// P-STATE-MACHINE (clock side): the phase never moves backwards as time advances, Walk and settle never overlap, and the stage of a
    /// settled launch always agrees with the verdict function (I4), while a stage that disagrees is always rejected.
    #[test]
    fn p_state_machine(
        opens in 0u64..1_000_000, commit in 1u64..1_000_000, tail in 1u64..1_000_000, t1 in 0u64..4_000_000, dt in 0u64..4_000_000,
        total in 0u128..2_000 * U, funders in 0u32..80, soft in 1u128..1_000 * U, min_funders in 1u32..40,
    ) {
        let (commit_end, walk_end) = (opens + commit, opens + commit + tail);
        let rank = |p: Phase| match p { Phase::Scheduled => 0, Phase::Open => 1, Phase::Closing => 2, Phase::Ready => 3 };
        let (p1, p2) = (phase_at(t1, opens, commit_end, walk_end), phase_at(t1 + dt, opens, commit_end, walk_end));
        prop_assert!(rank(p1) <= rank(p2), "phase went backwards");
        for (t, p) in [(t1, p1), (t1 + dt, p2)] {
            prop_assert!(!(p == Phase::Ready && walk_window_open(t, opens, walk_end)), "Walk and settle overlap");
            prop_assert_eq!(walk_window_open(t, opens, walk_end), matches!(p, Phase::Open | Phase::Closing));
        }
        let v = VerdictInputs { launch_id: 1, charter_hash: [0; 32], total_active: total, active_funders: funders, soft_cap: soft, min_funders, cancelled: false };
        let (class, record) = match verdict(&v) { Outcome::Pass => (StatusClass::Passed, (true, 0)), Outcome::Fail(r) => (StatusClass::Failed, (false, r)) };
        let reasons = if let Outcome::Fail(r) = verdict(&v) { r } else { 0 };
        prop_assert!(i4_status_monotone(class, Some(record), reasons).is_ok());
        let wrong = if class == StatusClass::Passed { StatusClass::Failed } else { StatusClass::Passed };
        prop_assert!(i4_status_monotone(wrong, Some(record), reasons).is_err());
        prop_assert!(i4_status_monotone(StatusClass::Open, Some(record), reasons).is_err(), "an Open launch cannot carry a settlement");
    }
}

/// One step of the consolidation model: new proceeds settle, a consolidation is started, or the oldest one resolves (ok or failed).
#[derive(Clone, Debug)]
enum Op {
    Spend(u128),
    Consolidate,
    Resolve(bool),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![(1u128..5_000 * U).prop_map(Op::Spend), Just(Op::Consolidate), any::<bool>().prop_map(Op::Resolve)]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// P-CONSOL. A MODEL of the three formulas in `contracts/core/src/payout.rs` (`consolidate`: amount = spent_intents - consolidated -
    /// consolidating, then consolidating += amount; callback: consolidating -= a and consolidated += a only when the move succeeded).
    /// It proves the arithmetic cannot double-move or lose a unit under any interleaving of starts, successes and failures. It is NOT a
    /// test of the contract code; the contract side is exercised by the sandbox suites `adversarial`, `intents`, `solvency`, `admin_ops`.
    #[test]
    fn p_consol(ops in vec(op(), 1..80)) {
        let (mut spent, mut consolidated, mut consolidating) = (0u128, 0u128, 0u128);
        let mut in_flight: std::collections::VecDeque<u128> = Default::default();
        let mut moved_ok = 0u128;
        for op in ops {
            match op {
                Op::Spend(x) => spent += x,
                Op::Consolidate => {
                    let amount = spent - consolidated - consolidating;
                    if amount > 0 { consolidating += amount; in_flight.push_back(amount); }
                }
                Op::Resolve(ok) => if let Some(a) = in_flight.pop_front() {
                    consolidating -= a;
                    if ok { consolidated += a; moved_ok += a; }
                },
            }
            prop_assert!(consolidated + consolidating <= spent, "more consolidated or in flight than was ever spent");
            prop_assert_eq!(consolidated, moved_ok, "consolidated counts exactly the successful moves");
            prop_assert_eq!(consolidating, in_flight.iter().sum::<u128>());
        }
        while let Some(a) = in_flight.pop_front() { consolidating -= a; consolidated += a; }
        let rest = spent - consolidated - consolidating;
        prop_assert_eq!(consolidated + rest, spent, "after everything resolves, moved plus still-movable equals spent");
    }
}
