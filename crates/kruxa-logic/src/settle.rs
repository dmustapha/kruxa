use kruxa_math::{bps_ceil, bps_floor, mul_div_ceil, mul_div_floor, MathError};
use serde::{Deserialize, Serialize};

use crate::rules::Rules;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Scheduled,
    Open,
    Closing,
    Ready,
}

/// Clock-derived phase. Nothing is stored, so nothing can fail to happen.
pub fn phase_at(now: u64, opens_at: u64, commit_end: u64, walk_end: u64) -> Phase {
    if now < opens_at {
        Phase::Scheduled
    } else if now < commit_end {
        Phase::Open
    } else if now < walk_end {
        Phase::Closing
    } else {
        Phase::Ready
    }
}

/// Launch fee = min(max_fee, 3% of A, max(ceil(1.5% of A), min_fee)). Rounded so the platform never loses a unit.
pub fn launch_fee(accepted: u128, r: &Rules) -> Result<u128, MathError> {
    let rate = bps_ceil(accepted, r.launch_fee_bps)?;
    let ceiling = bps_floor(accepted, r.max_launch_fee_bps)?;
    Ok(r.launch_fee_max.min(ceiling).min(rate.max(r.launch_fee_min)))
}

/// The four settlement buckets. launch_fee + lp_quote + stream + excess_pool == total_active, always.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Allocation {
    pub accepted: u128,
    pub launch_fee: u128,
    pub lp_quote: u128,
    pub stream: u128,
    pub excess_pool: u128,
}

pub fn allocate(total_active: u128, hard_cap: u128, sale_bps: u16, lp_bps: u16, r: &Rules) -> Result<Allocation, MathError> {
    let accepted = total_active.min(hard_cap);
    let fee = launch_fee(accepted, r)?;
    let lp_quote = mul_div_floor(accepted, lp_bps as u128, sale_bps as u128)?;
    let stream = accepted.checked_sub(fee).and_then(|x| x.checked_sub(lp_quote)).ok_or(MathError::Overflow)?;
    Ok(Allocation { accepted, launch_fee: fee, lp_quote, stream, excess_pool: total_active - accepted })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PositionSettlement {
    pub spend: u128,
    pub refund: u128,
    pub tokens: u128,
    pub bonus: u128,
}

/// Uniform-price pro-rata. Charged amounts round UP, paid amounts round DOWN; dust goes to the LP bucket.
pub fn settle_position(
    commit: u128,
    total_active: u128,
    accepted: u128,
    n_sale: u128,
    n_backer: u128,
) -> Result<PositionSettlement, MathError> {
    let spend = mul_div_ceil(commit, accepted, total_active)?;
    Ok(PositionSettlement {
        spend,
        refund: commit - spend,
        tokens: mul_div_floor(commit, n_sale, total_active)?,
        bonus: mul_div_floor(commit, n_backer, total_active)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const U: u128 = 1_000_000;

    #[test]
    fn spec_example_one_oversubscribed() {
        // S1-B 2.6 example 1 with H = 5,000 USDC, sigma = 12,500 USDC (rules relaxed to allow the cap).
        let r = Rules { max_hard_cap: 5_000 * U, ..Rules::ladder() };
        let a = allocate(12_500 * U, 5_000 * U, 6_000, 2_500, &r).unwrap();
        assert_eq!(a.launch_fee, 75_000_000);
        assert_eq!(a.lp_quote, 2_083_333_333);
        assert_eq!(a.stream, 2_841_666_667);
        assert_eq!(a.excess_pool, 7_500 * U);
        let s = settle_position(100 * U, 12_500 * U, a.accepted, 600_000_000_000_000, 50_000_000_000_000).unwrap();
        assert_eq!((s.spend, s.refund), (40 * U, 60 * U));
        assert_eq!(s.tokens, 4_800_000_000_000);
    }

    #[test]
    fn spec_example_two_undersubscribed_sells_everything_cheaper() {
        let r = Rules { max_hard_cap: 5_000 * U, ..Rules::ladder() };
        let a = allocate(2_000 * U, 5_000 * U, 6_000, 2_500, &r).unwrap();
        assert_eq!((a.accepted, a.excess_pool), (2_000 * U, 0));
        let s = settle_position(50 * U, 2_000 * U, a.accepted, 600_000_000_000_000, 0).unwrap();
        assert_eq!((s.spend, s.refund, s.tokens), (50 * U, 0, 15_000_000_000_000));
    }

    #[test]
    fn minimum_fee_applies_at_the_soft_cap() {
        let r = Rules::ladder();
        assert_eq!(launch_fee(350 * U, &r).unwrap(), 10 * U);
        assert_eq!(launch_fee(1_000 * U, &r).unwrap(), 15 * U);
    }

    #[test]
    fn phases_follow_the_clock() {
        assert_eq!(phase_at(5, 10, 20, 30), Phase::Scheduled);
        assert_eq!(phase_at(10, 10, 20, 30), Phase::Open);
        assert_eq!(phase_at(20, 10, 20, 30), Phase::Closing);
        assert_eq!(phase_at(30, 10, 20, 30), Phase::Ready);
    }

    proptest! {
        #[test]
        fn conservation_across_random_books(commits in proptest::collection::vec(20u128 * U..=100 * U, 10..60), hard in 500u128 * U..=1_000 * U) {
            let r = Rules::ladder();
            let total: u128 = commits.iter().sum();
            prop_assume!(total >= 350 * U);
            let (n_sale, n_backer) = (600_000_000_000_000u128, 50_000_000_000_000u128);
            let a = allocate(total, hard, 6_000, 2_500, &r).unwrap();
            prop_assert_eq!(a.launch_fee + a.lp_quote + a.stream + a.excess_pool, total);
            let (mut spend, mut refund, mut tokens, mut bonus) = (0u128, 0u128, 0u128, 0u128);
            for c in &commits {
                let s = settle_position(*c, total, a.accepted, n_sale, n_backer).unwrap();
                prop_assert_eq!(s.spend + s.refund, *c);
                spend += s.spend; refund += s.refund; tokens += s.tokens; bonus += s.bonus;
            }
            prop_assert_eq!(spend + refund, total);
            prop_assert!(spend >= a.accepted && spend - a.accepted < commits.len() as u128);
            prop_assert!(refund <= a.excess_pool);
            prop_assert!(tokens <= n_sale && bonus <= n_backer);
            prop_assert!(n_sale - tokens < commits.len() as u128);
        }
    }
}
