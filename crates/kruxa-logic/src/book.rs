//! The contribution book as a pure fold. The contract keeps a rolling `book_hash` while it mutates state; this module replays
//! the same `contributed` / `walked` events from scratch, so a judge can reproduce the stored hash, `total_active` and
//! `active_funders` without trusting the contract (`kruxa-sim fold`, property test P-RECOMPUTE).
use std::collections::HashMap;

use crate::verdict::book_next;

/// One entry of the public event log that changes the book. `holder` is the text key (`near:<account>` or `sol:<base58>`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BookEvent {
    Contributed { holder: String, net: u128 },
    Walked { holder: String, amount: u128 },
}

/// State of the book after the last event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Folded {
    pub total_active: u128,
    pub active_funders: u32,
    pub book_hash: [u8; 32],
    /// `(total_active, active_funders, book_hash)` after every event, in order.
    pub steps: Vec<(u128, u32, [u8; 32])>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FoldError {
    /// A Walk for a holder with nothing active.
    WalkWithoutPosition {
        index: usize,
    },
    /// A Walk must return the holder's whole active amount; this one did not.
    WalkAmountMismatch {
        index: usize,
        open: u128,
        amount: u128,
    },
    Overflow {
        index: usize,
    },
}

/// Replays events in order. Semantics are exactly the contract's: a contribution by a holder with nothing active makes them a
/// funder; a Walk removes the holder's whole active amount and one funder.
pub fn fold_book(events: &[BookEvent]) -> Result<Folded, FoldError> {
    let (mut total, mut funders, mut hash) = (0u128, 0u32, [0u8; 32]);
    let mut open: HashMap<&str, u128> = HashMap::new();
    let mut steps = Vec::with_capacity(events.len());
    for (index, ev) in events.iter().enumerate() {
        match ev {
            BookEvent::Contributed { holder, net } => {
                let slot = open.entry(holder.as_str()).or_insert(0);
                if *slot == 0 {
                    funders += 1;
                }
                *slot = slot.checked_add(*net).ok_or(FoldError::Overflow { index })?;
                total = total.checked_add(*net).ok_or(FoldError::Overflow { index })?;
                hash = book_next(&hash, 1, holder.as_bytes(), *net, total, funders);
            }
            BookEvent::Walked { holder, amount } => {
                let held = open.get(holder.as_str()).copied().unwrap_or(0);
                if held == 0 {
                    return Err(FoldError::WalkWithoutPosition { index });
                }
                if held != *amount {
                    return Err(FoldError::WalkAmountMismatch { index, open: held, amount: *amount });
                }
                open.insert(holder.as_str(), 0);
                total -= held;
                funders -= 1;
                hash = book_next(&hash, 2, holder.as_bytes(), held, total, funders);
            }
        }
        steps.push((total, funders, hash));
    }
    Ok(Folded { total_active: total, active_funders: funders, book_hash: hash, steps })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verdict::{hex, inputs_hash, verdict, VerdictInputs};
    use proptest::prelude::*;

    fn c(h: &str, n: u128) -> BookEvent {
        BookEvent::Contributed { holder: h.into(), net: n }
    }
    fn w(h: &str, n: u128) -> BookEvent {
        BookEvent::Walked { holder: h.into(), amount: n }
    }

    #[test]
    fn fold_counts_funders_once_per_holder_and_walk_removes_the_whole_position() {
        let f = fold_book(&[c("near:a", 30), c("near:b", 40), c("near:a", 20), w("near:a", 50)]).unwrap();
        assert_eq!((f.total_active, f.active_funders), (40, 1));
        assert_eq!(f.steps.iter().map(|s| (s.0, s.1)).collect::<Vec<_>>(), vec![(30, 1), (70, 2), (90, 2), (40, 1)]);
        assert_ne!(f.book_hash, [0; 32]);
    }

    #[test]
    fn fold_rejects_impossible_walks_and_is_order_sensitive() {
        assert_eq!(fold_book(&[w("near:a", 5)]), Err(FoldError::WalkWithoutPosition { index: 0 }));
        assert_eq!(fold_book(&[c("near:a", 5), w("near:a", 4)]), Err(FoldError::WalkAmountMismatch { index: 1, open: 5, amount: 4 }));
        let ab = fold_book(&[c("near:a", 5), c("near:b", 6)]).unwrap().book_hash;
        let ba = fold_book(&[c("near:b", 6), c("near:a", 5)]).unwrap().book_hash;
        assert_ne!(ab, ba);
        assert_eq!(hex(&fold_book(&[]).unwrap().book_hash), "0".repeat(64));
    }

    /// The contract's own bookkeeping, written the way `intake.rs` does it: mutate counters, extend the rolling hash, emit an event.
    struct ContractModel {
        open: HashMap<String, u128>,
        total: u128,
        funders: u32,
        hash: [u8; 32],
        log: Vec<BookEvent>,
    }

    impl ContractModel {
        fn contribute(&mut self, holder: &str, net: u128) {
            let slot = self.open.entry(holder.to_string()).or_insert(0);
            if *slot == 0 {
                self.funders += 1;
            }
            *slot += net;
            self.total += net;
            self.hash = book_next(&self.hash, 1, holder.as_bytes(), net, self.total, self.funders);
            self.log.push(c(holder, net));
        }

        fn walk(&mut self, holder: &str) {
            let on = self.open.get(holder).copied().unwrap_or(0);
            if on == 0 {
                return; // the contract refuses (R_NO_POSITION); nothing is emitted
            }
            self.open.insert(holder.to_string(), 0);
            self.total -= on;
            self.funders -= 1;
            self.hash = book_next(&self.hash, 2, holder.as_bytes(), on, self.total, self.funders);
            self.log.push(w(holder, on));
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        /// P-RECOMPUTE: folding the events a contract-shaped book emitted reproduces its stored book_hash, counters, inputs_hash and verdict.
        #[test]
        fn p_recompute(ops in proptest::collection::vec((0usize..12, 20_000_000u128..=100_000_000, any::<bool>()), 1..80)) {
            let mut m = ContractModel { open: HashMap::new(), total: 0, funders: 0, hash: [0; 32], log: vec![] };
            for (who, amount, walk) in ops {
                let holder = format!("near:buyer{who}.test");
                if walk { m.walk(&holder) } else { m.contribute(&holder, amount) }
            }
            let f = fold_book(&m.log).unwrap();
            prop_assert_eq!((f.total_active, f.active_funders, f.book_hash), (m.total, m.funders, m.hash));
            let inputs = |total, funders| VerdictInputs { launch_id: 1, charter_hash: [3; 32], total_active: total, active_funders: funders,
                                                           soft_cap: 350_000_000, min_funders: 10, cancelled: false };
            let (a, b) = (inputs(f.total_active, f.active_funders), inputs(m.total, m.funders));
            prop_assert_eq!(verdict(&a), verdict(&b));
            prop_assert_eq!(inputs_hash(&a), inputs_hash(&b));
        }
    }
}
