//! Creator-allocation vesting: a cliff, then the same linear formula as the trial's capped stream (`kruxa_math::linear_unlocked`).
use kruxa_math::{linear_unlocked, MathError};

/// Fixed at pool open. Durations in ns (the contract multiplies days by its profile's unit).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Schedule {
    pub total: u128,
    pub opened_at: u64,
    pub cliff_ns: u64,
    pub vest_ns: u64,
}

/// `0` before `opened_at + cliff`, then `floor(total * elapsed / vest)` counted from `opened_at`, `total` from `opened_at + vest`.
pub fn alloc_unlocked(s: &Schedule, now: u64) -> Result<u128, MathError> {
    if now < s.opened_at.saturating_add(s.cliff_ns) {
        return Ok(0);
    }
    linear_unlocked(s.total, s.opened_at, s.vest_ns, now)
}

/// What a pull may take now: `unlocked - claimed`, never negative.
pub fn claimable(s: &Schedule, claimed: u128, now: u64) -> Result<u128, MathError> {
    Ok(alloc_unlocked(s, now)?.saturating_sub(claimed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const DAY: u64 = 86_400_000_000_000;

    fn sched(total: u128, cliff_days: u64, vest_days: u64) -> Schedule {
        Schedule { total, opened_at: 1_000 * DAY, cliff_ns: cliff_days * DAY, vest_ns: vest_days * DAY }
    }

    #[test]
    fn zero_before_the_cliff_positive_at_it() {
        let s = sched(50_000_000_000_000, 7, 90);
        assert_eq!(alloc_unlocked(&s, s.opened_at).unwrap(), 0);
        assert_eq!(alloc_unlocked(&s, s.opened_at + 7 * DAY - 1).unwrap(), 0);
        let at = alloc_unlocked(&s, s.opened_at + 7 * DAY).unwrap();
        assert_eq!(at, 50_000_000_000_000u128 * 7 / 90);
        assert!(at > 0);
    }

    #[test]
    fn full_amount_at_and_after_the_vest_end() {
        let s = sched(123_456_789, 7, 30);
        assert_eq!(alloc_unlocked(&s, s.opened_at + 30 * DAY).unwrap(), 123_456_789);
        assert_eq!(alloc_unlocked(&s, u64::MAX).unwrap(), 123_456_789);
    }

    #[test]
    fn claimable_never_negative() {
        let s = sched(1_000, 7, 30);
        assert_eq!(claimable(&s, 5_000, s.opened_at + 8 * DAY).unwrap(), 0);
    }

    proptest! {
        #[test]
        fn monotonic_and_bounded(total in 0u128..=1_000_000_000_000_000u128, cliff in 7u64..=30, extra in 0u64..=335, a in 0u64..400, b in 0u64..400) {
            let vest = (30u64).max(cliff) + extra.min(365 - (30u64).max(cliff));
            let s = sched(total, cliff, vest);
            let (lo, hi) = (a.min(b), a.max(b));
            let (ulo, uhi) = (alloc_unlocked(&s, s.opened_at + lo * DAY / 2).unwrap(), alloc_unlocked(&s, s.opened_at + hi * DAY / 2).unwrap());
            prop_assert!(ulo <= uhi);
            prop_assert!(uhi <= total);
            prop_assert_eq!(alloc_unlocked(&s, s.opened_at + vest * DAY).unwrap(), total);
        }

        #[test]
        fn nothing_before_the_pool_opens(total in 0u128..=1_000_000_000_000_000u128, t in 0u64..1_000) {
            let s = sched(total, 7, 90);
            prop_assert_eq!(alloc_unlocked(&s, t * DAY).unwrap(), 0);
        }

        #[test]
        fn matches_the_trial_stream_formula_after_the_cliff(total in 1u128..=1_000_000_000_000_000u128, d in 7u64..=90) {
            let s = sched(total, 7, 90);
            let now = s.opened_at + d * DAY;
            prop_assert_eq!(alloc_unlocked(&s, now).unwrap(), kruxa_math::linear_unlocked(total, s.opened_at, 90 * DAY, now).unwrap());
        }
    }
}
