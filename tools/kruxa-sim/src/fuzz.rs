//! `kruxa-sim fuzz`: random books through the contract's own settlement arithmetic, checking the money identities.
//! Deterministic for a given `--seed` (xorshift64*), so a failure reproduces.
use crate::cli::*;
use kruxa_logic::{allocate, fold_book, hex, inputs_hash, settle_position, verdict, BookEvent, Rules, VerdictInputs};
use std::collections::BTreeMap;

pub const SPEC: Spec = Spec { values: &["n", "seed"], optional_values: &[], switches: &[] };

const N_SALE: u128 = 600_000_000_000_000;
const N_BACKER: u128 = 50_000_000_000_000;
const USDC: u128 = 1_000_000;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn between(&mut self, lo: u128, hi: u128) -> u128 {
        lo + u128::from(self.next()) % (hi - lo + 1)
    }
    fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            v.swap(i, self.between(0, i as u128) as usize);
        }
    }
}

#[derive(Default)]
struct Tally {
    conservation: u64,
    order: u64,
    no_overpay: u64,
    worst_residue: u128,
    worst_dust: u128,
}

/// Splits `amount` into 1 to 3 pieces that add up to it exactly.
fn split(rng: &mut Rng, amount: u128) -> Vec<u128> {
    let first = rng.between(1, amount - 1);
    match rng.between(1, 3) {
        1 => vec![amount],
        2 => vec![first, amount - first],
        _ => {
            let second = rng.between(0, amount - first - 1);
            vec![first, second, amount - first - second]
        }
    }
}

/// Per-buyer event queues: the pieces in the given order, then (for a walker) one Walk of everything they put in.
fn queues(buyers: &[(String, Vec<u128>, bool)]) -> Vec<Vec<BookEvent>> {
    buyers
        .iter()
        .map(|(who, pieces, walks)| {
            let mut q: Vec<BookEvent> = pieces.iter().map(|n| BookEvent::Contributed { holder: who.clone(), net: *n }).collect();
            if *walks {
                q.push(BookEvent::Walked { holder: who.clone(), amount: pieces.iter().sum() });
            }
            q
        })
        .collect()
}

/// A random interleaving of the queues that keeps each buyer's own order (a Walk always follows that buyer's contributions).
fn interleave(rng: &mut Rng, mut qs: Vec<Vec<BookEvent>>) -> Vec<BookEvent> {
    qs.iter_mut().for_each(|q| q.reverse());
    let mut out = Vec::new();
    loop {
        let live: Vec<usize> = (0..qs.len()).filter(|i| !qs[*i].is_empty()).collect();
        if live.is_empty() {
            return out;
        }
        let pick = live[rng.between(0, live.len() as u128 - 1) as usize];
        out.push(qs[pick].pop().expect("live queue"));
    }
}

/// What the book ends with, however the events were ordered: the verdict, the inputs hash, the funder count, the total, and every
/// remaining holder's position. The rolling `book_hash` is left out on purpose: it is order-dependent by design.
type Outcome = (u128, u32, String, String, BTreeMap<String, u128>);

fn end_state(events: &[BookEvent], soft_cap: u128) -> Result<Outcome, &'static str> {
    let f = fold_book(events).map_err(|_| "fold")?;
    let mut positions: BTreeMap<String, u128> = BTreeMap::new();
    for e in events {
        match e {
            BookEvent::Contributed { holder, net } => *positions.entry(holder.clone()).or_default() += net,
            BookEvent::Walked { holder, .. } => {
                positions.remove(holder);
            }
        }
    }
    let i = VerdictInputs {
        launch_id: 1,
        charter_hash: [7; 32],
        total_active: f.total_active,
        active_funders: f.active_funders,
        soft_cap,
        min_funders: 10,
        cancelled: false,
    };
    Ok((f.total_active, f.active_funders, format!("{:?}", verdict(&i)), hex(&inputs_hash(&i)), positions))
}

/// Two different orderings of the same buyers must end in the same state. Err names what differed.
fn same_end_state(a: &[BookEvent], b: &[BookEvent], soft_cap: u128) -> Result<Outcome, &'static str> {
    let (x, y) = (end_state(a, soft_cap)?, end_state(b, soft_cap)?);
    if (x.0, x.1) != (y.0, y.1) {
        return Err("order-independence: total or funders");
    }
    if (&x.2, &x.3) != (&y.2, &y.3) {
        return Err("order-independence: verdict or inputs hash");
    }
    if x.4 != y.4 {
        return Err("order-independence: positions");
    }
    Ok(x)
}

/// Builds buyers (the final `commits` plus a few who commit and then Walk), folds two random interleavings, and settles from the
/// positions each fold ends with: the per-buyer settlement must equal `rows`, the one computed straight from `commits`.
fn book_order_check(rng: &mut Rng, commits: &[u128], rows: &[(u128, u128, u128, u128)]) -> Result<Outcome, &'static str> {
    let mut buyers: Vec<(String, Vec<u128>, bool)> =
        commits.iter().enumerate().map(|(i, c)| (format!("near:b{i}.test"), split(rng, *c), false)).collect();
    for w in 0..rng.between(0, 3) {
        let amount = rng.between(20, 100) * USDC;
        buyers.push((format!("near:walker{w}.test"), split(rng, amount), true));
    }
    let a = interleave(rng, queues(&buyers));
    buyers.iter_mut().for_each(|b| rng.shuffle(&mut b.1)); // same amounts, different piece order
    let b = interleave(rng, queues(&buyers));
    let end = same_end_state(&a, &b, 350 * USDC)?;
    let mut settled = commits.to_vec();
    let mut held: Vec<u128> = end.4.values().copied().collect();
    settled.sort();
    held.sort();
    if settled != held || rows.len() != held.len() {
        return Err("order-independence: positions");
    }
    Ok(end)
}

/// One book. Returns Err(name of the broken identity).
fn trial(rng: &mut Rng, t: &mut Tally) -> Result<(), &'static str> {
    let rules = Rules::ladder();
    let hard = rng.between(500, 1_000) * USDC;
    let commits: Vec<u128> = (0..rng.between(10, 100)).map(|_| rng.between(20, 100) * USDC + u128::from(rng.next() % 1_000_000)).collect();
    let total: u128 = commits.iter().sum();
    if total < 350 * USDC || total > hard * 2 {
        return Ok(()); // not a passable or admissible book; counted by the caller as skipped
    }
    let a = allocate(total, hard, 6_000, 2_500, &rules).map_err(|_| "allocate")?;
    let each = |order: &[u128]| -> Result<Vec<(u128, u128, u128, u128)>, &'static str> {
        order
            .iter()
            .map(|c| {
                settle_position(*c, total, a.accepted, N_SALE, N_BACKER).map(|s| (*c, s.spend, s.refund, s.tokens)).map_err(|_| "settle")
            })
            .collect()
    };
    let rows = each(&commits)?;
    let (spend, refund, tokens): (u128, u128, u128) = rows.iter().fold((0, 0, 0), |x, r| (x.0 + r.1, x.1 + r.2, x.2 + r.3));
    if a.launch_fee + a.lp_quote + a.stream + a.excess_pool != total || spend + refund != total || rows.iter().any(|r| r.1 + r.2 != r.0) {
        return Err("conservation");
    }
    t.conservation += 1;
    if spend < a.accepted || refund > a.excess_pool || tokens > N_SALE {
        return Err("no-overpay");
    }
    t.no_overpay += 1;
    let end = book_order_check(rng, &commits, &rows)?;
    if end.0 != total || end.1 as usize != commits.len() {
        return Err("order-independence: fold disagrees with the model");
    }
    t.order += 1;
    t.worst_residue = t.worst_residue.max(spend - a.accepted);
    t.worst_dust = t.worst_dust.max(N_SALE - tokens);
    Ok(())
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let n: u64 = if f.contains_key("n") { num(&f, "n") } else { 1_000 };
    let seed: u64 = if f.contains_key("seed") { num(&f, "seed") } else { 1 };
    let mut rng = Rng(seed.max(1));
    let (mut t, mut run_books) = (Tally::default(), 0u64);
    while run_books < n {
        let before = t.conservation;
        if let Err(name) = trial(&mut rng, &mut t) {
            println!("FAILED {name} at book {run_books} (seed {seed})");
            std::process::exit(EXIT_SELF_TEST);
        }
        run_books += u64::from(t.conservation > before);
    }
    println!("worst rounding residue {} micro-USDC, worst token dust {} base units", t.worst_residue, t.worst_dust);
    println!("order-independence {}/{n} ok", t.order);
    println!("no-overpay {}/{n} ok", t.no_overpay);
    println!("conservation {}/{n} ok", t.conservation);
    std::process::exit(EXIT_MATCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(h: &str, n: u128) -> BookEvent {
        BookEvent::Contributed { holder: h.into(), net: n }
    }

    #[test]
    fn same_buyers_in_another_interleaving_end_in_the_same_state_and_a_different_hash() {
        let a = [c("near:a", 30), c("near:b", 40), c("near:a", 20)];
        let b = [c("near:b", 40), c("near:a", 20), c("near:a", 30)];
        assert!(same_end_state(&a, &b, 100).is_ok());
        assert_ne!(fold_book(&a).unwrap().book_hash, fold_book(&b).unwrap().book_hash);
    }

    #[test]
    fn the_check_fails_when_an_ordering_loses_a_piece_changes_a_position_or_flips_the_verdict() {
        let a = [c("near:a", 30), c("near:b", 40)];
        assert_eq!(same_end_state(&a, &[c("near:a", 30)], 50), Err("order-independence: total or funders"));
        assert_eq!(same_end_state(&a, &[c("near:a", 40), c("near:b", 30)], 50), Err("order-independence: positions"));
        let (x, y) = ([c("near:a", 30), c("near:b", 40)], [c("near:a", 30), c("near:b", 40)]);
        assert!(same_end_state(&x, &y, 70).is_ok());
        let walked = [c("near:a", 30), c("near:b", 40), c("near:z", 5), BookEvent::Walked { holder: "near:z".into(), amount: 5 }];
        assert_eq!(same_end_state(&x, &walked, 70).map(|o| o.0), Ok(70), "a Walk of an extra buyer leaves the same end state");
    }

    #[test]
    fn a_random_book_passes_and_a_tampered_model_is_refused() {
        let mut rng = Rng(7);
        let commits: Vec<u128> = (0..12).map(|_| rng.between(20, 100) * USDC).collect();
        let rows: Vec<(u128, u128, u128, u128)> = commits.iter().map(|c| (*c, 0, 0, 0)).collect();
        assert!(book_order_check(&mut rng, &commits, &rows).is_ok());
        assert!(book_order_check(&mut rng, &commits, &rows[1..]).is_err(), "a model with a missing buyer is caught");
    }
}
