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
    use crate::verdict::{hex, inputs_hash, verdict, Outcome, VerdictInputs};
    use proptest::prelude::*;
    use sha2::Digest;

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

    /// How the reference may be deliberately broken, so the test can prove it is able to fail.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum Sabotage {
        None,
        /// Hash the byte `kind + 1` instead of `kind` on the first event.
        KindByte,
        /// Count a returning funder twice.
        DoubleCountFunder,
    }

    /// Everything the independent reference derives from raw operations.
    struct Reference {
        log: Vec<BookEvent>,
        total: u128,
        funders: u32,
        hash: [u8; 32],
        inputs_hash: [u8; 32],
        outcome: (bool, u8),
        /// True when the sabotage actually changed something for these operations.
        sabotaged: bool,
    }

    /// Independent reference. It shares no code with `fold_book`, `book_next`, `verdict` or `inputs_hash`: positions live in a Vec
    /// scanned linearly (not a HashMap), the hash preimage is spelled out byte by byte from the documented layout
    /// `prev || kind || len u16 LE || holder || amount u128 LE || total u128 LE || funders u32 LE` and hashed with one `Sha256::digest`
    /// call, and the verdict is the written rule: PASS iff not cancelled, total >= soft cap and funders >= minimum.
    fn reference(ops: &[(usize, u128, bool)], sabotage: Sabotage) -> Reference {
        const SOFT_CAP: u128 = 350_000_000;
        const MIN_FUNDERS: u32 = 10;
        let mut open: Vec<(String, u128)> = Vec::new();
        let (mut total, mut funders, mut hash, mut log, mut sabotaged) = (0u128, 0u32, [0u8; 32], Vec::new(), false);
        for (who, amount, walk) in ops {
            let holder = format!("near:buyer{who}.test");
            let at = open.iter().position(|(h, _)| *h == holder);
            let held = at.map_or(0, |i| open[i].1);
            let (kind, moved) = if *walk {
                if held == 0 {
                    continue; // the contract refuses (R_NO_POSITION) and emits nothing
                }
                open[at.unwrap()].1 = 0;
                total -= held;
                funders -= 1;
                log.push(BookEvent::Walked { holder: holder.clone(), amount: held });
                (2u8, held)
            } else {
                match at {
                    Some(i) => open[i].1 += amount,
                    None => open.push((holder.clone(), *amount)),
                }
                if held == 0 {
                    let extra = u32::from(sabotage == Sabotage::DoubleCountFunder && !log.is_empty());
                    sabotaged |= extra == 1;
                    funders += 1 + extra;
                }
                total += amount;
                log.push(BookEvent::Contributed { holder: holder.clone(), net: *amount });
                (1u8, *amount)
            };
            let mut pre = hash.to_vec();
            let flip = sabotage == Sabotage::KindByte && log.len() == 1;
            sabotaged |= flip;
            pre.push(kind + u8::from(flip));
            pre.extend_from_slice(&(holder.len() as u16).to_le_bytes());
            pre.extend_from_slice(holder.as_bytes());
            pre.extend_from_slice(&moved.to_le_bytes());
            pre.extend_from_slice(&total.to_le_bytes());
            pre.extend_from_slice(&funders.to_le_bytes());
            hash = sha2::Sha256::digest(&pre).into();
        }
        let mut enc = Vec::new();
        enc.extend_from_slice(&1u64.to_le_bytes());
        enc.extend_from_slice(&[3u8; 32]);
        enc.extend_from_slice(&total.to_le_bytes());
        enc.extend_from_slice(&funders.to_le_bytes());
        enc.extend_from_slice(&SOFT_CAP.to_le_bytes());
        enc.extend_from_slice(&MIN_FUNDERS.to_le_bytes());
        enc.push(0);
        let reasons = u8::from(total < SOFT_CAP) | (u8::from(funders < MIN_FUNDERS) << 1);
        Reference { log, total, funders, hash, inputs_hash: sha2::Sha256::digest(&enc).into(), outcome: (reasons == 0, reasons), sabotaged }
    }

    fn op_strategy() -> impl Strategy<Value = Vec<(usize, u128, bool)>> {
        proptest::collection::vec((0usize..12, 20_000_000u128..=100_000_000, any::<bool>()), 1..80)
    }

    /// What `fold_book` plus the shipped verdict code say about the reference's own event log.
    fn shipped(r: &Reference) -> ((u128, u32, [u8; 32]), [u8; 32], Outcome) {
        let f = fold_book(&r.log).unwrap();
        let i = VerdictInputs {
            launch_id: 1,
            charter_hash: [3; 32],
            total_active: f.total_active,
            active_funders: f.active_funders,
            soft_cap: 350_000_000,
            min_funders: 10,
            cancelled: false,
        };
        ((f.total_active, f.active_funders, f.book_hash), inputs_hash(&i), verdict(&i))
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        /// P-RECOMPUTE: replaying the events with `fold_book` reproduces the hash, counters, inputs_hash and verdict that an
        /// independent reference derives from the raw operations.
        #[test]
        fn p_recompute(ops in op_strategy()) {
            let r = reference(&ops, Sabotage::None);
            let (state, ih, outcome) = shipped(&r);
            prop_assert_eq!(state, (r.total, r.funders, r.hash));
            prop_assert_eq!(ih, r.inputs_hash);
            let want = if r.outcome.0 { Outcome::Pass } else { Outcome::Fail(r.outcome.1) };
            prop_assert_eq!(outcome, want);
        }

        /// The comparison above can fail: a reference with one wrong hash byte, or one extra funder, is always caught.
        #[test]
        fn p_recompute_detects_a_corrupted_reference(ops in op_strategy()) {
            for sabotage in [Sabotage::KindByte, Sabotage::DoubleCountFunder] {
                let r = reference(&ops, sabotage);
                if !r.sabotaged { continue; }
                let (state, _, _) = shipped(&r);
                prop_assert!(state != (r.total, r.funders, r.hash), "{sabotage:?} slipped through");
            }
        }
    }
}
