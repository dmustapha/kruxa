//! Fee rate (with opening decay), five-slice router, and the terms check.
use crate::{MarketError, FEE_DENOM_PPM};
use kruxa_logic::FeeTerms;
use kruxa_math::{mul_div_ceil, mul_div_floor, BPS};

/// Which slices have a live destination. M-A has neither the Hold Vault nor referral lots,
/// so both slices are redirected to LP (ARCHITECTURE 5.1, PRD C5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Routing {
    pub holders_live: bool,
    pub referral_live: bool,
}

impl Routing {
    pub const M_A: Routing = Routing { holders_live: false, referral_live: false };
}

/// The five slices. `creator + platform + holders + lp + referral == total` always.
/// `surcharge`, `red_holders` and `red_referral` are subsets of `lp`, kept for reporting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FeeSlices {
    pub total: u128,
    pub creator: u128,
    pub platform: u128,
    pub holders: u128,
    pub lp: u128,
    pub referral: u128,
    pub surcharge: u128,
    pub red_holders: u128,
    pub red_referral: u128,
}

impl FeeSlices {
    pub fn sum(&self) -> u128 {
        self.creator + self.platform + self.holders + self.lp + self.referral
    }
}

/// Base fee rate in ppm (bps * 100).
pub fn base_rate_ppm(terms: &FeeTerms) -> u128 {
    terms.total_fee_bps as u128 * 100
}

/// Applied rate in ppm at `elapsed_ns` after the pool opened: the opening rate decays linearly to the base over
/// `opening_decay_minutes`; after that, or when the start is not above the base, it is the base.
pub fn applied_rate_ppm(terms: &FeeTerms, elapsed_ns: u64) -> u128 {
    let base = base_rate_ppm(terms);
    let start = terms.opening_fee_start_bps as u128 * 100;
    let dur = terms.opening_decay_minutes as u128 * 60 * 1_000_000_000;
    if start <= base || dur == 0 || elapsed_ns as u128 >= dur {
        return base;
    }
    base + (start - base) * (dur - elapsed_ns as u128) / dur
}

/// Cut `q_leg * rate` into the five slices. Rounds the fee up (favours the pool); creator, platform, holders and
/// referral floor; LP takes the base remainder (all rounding dust) plus the whole opening surcharge.
pub fn route_fee(q_leg: u128, terms: &FeeTerms, elapsed_ns: u64, routing: Routing) -> Result<FeeSlices, MarketError> {
    let total = mul_div_ceil(q_leg, applied_rate_ppm(terms, elapsed_ns), FEE_DENOM_PPM)?;
    if total >= q_leg {
        return Err(MarketError::Math);
    }
    let base_fee = mul_div_ceil(q_leg, base_rate_ppm(terms), FEE_DENOM_PPM)?.min(total);
    let part = |bps: u16| mul_div_floor(base_fee, bps as u128, BPS);
    let (creator, platform, holders, referral) =
        (part(terms.creator_bps)?, part(terms.platform_bps)?, part(terms.holders_bps)?, part(terms.referral_bps)?);
    let surcharge = total - base_fee;
    let lp_base = base_fee - creator - platform - holders - referral;
    let (red_holders, holders) = if routing.holders_live { (0, holders) } else { (holders, 0) };
    let (red_referral, referral) = if routing.referral_live { (0, referral) } else { (referral, 0) };
    let lp = lp_base + surcharge + red_holders + red_referral;
    Ok(FeeSlices { total, creator, platform, holders, lp, referral, surcharge, red_holders, red_referral })
}

/// Creator-take bound (ARCHITECTURE 5.1): the creator slice never exceeds `q_leg * total_fee_bps * creator_bps` plus one unit of rounding.
pub fn creator_take_ok(creator: u128, q_leg: u128, terms: &FeeTerms) -> bool {
    let lhs = kruxa_math::U256::from(creator) * kruxa_math::U256::from(BPS * BPS);
    let rhs = kruxa_math::U256::from(q_leg) * kruxa_math::U256::from(terms.total_fee_bps as u128 * terms.creator_bps as u128)
        + kruxa_math::U256::from(BPS * BPS);
    lhs <= rhs
}

/// Validate the terms a launch hands over. Same bounds as `kruxa_logic::Rules::ladder()` for the fee block, plus the opening-fee and vest limits.
pub fn validate_market_terms(t: &FeeTerms) -> Result<(), MarketError> {
    let sum = t.creator_bps as u32 + t.platform_bps as u32 + t.holders_bps as u32 + t.lp_bps as u32 + t.referral_bps as u32;
    let ok = sum == 10_000
        && t.total_fee_bps >= 1
        && t.total_fee_bps <= 200
        && t.creator_bps <= 6_000
        && t.platform_bps >= 1_500
        && (1_000..=3_000).contains(&t.holders_bps)
        && t.lp_bps >= 500
        && t.holders_bps as u32 + t.lp_bps as u32 >= 2_000
        && t.referral_bps <= 2_000
        && t.total_fee_bps as u64 * t.creator_bps as u64 <= 1_000_000
        && t.opening_fee_start_bps <= 1_000
        && t.opening_decay_minutes <= 120
        && t.fee_vest_bps <= 10_000
        && t.fee_vest_days <= 365;
    if ok {
        Ok(())
    } else {
        Err(MarketError::FeeTerms)
    }
}
