//! kruxa-math: pure integer math. No near-sdk, no I/O. Linked by the contract, kruxa-sim and verify.
#![forbid(unsafe_code)]

/// The macro expansion trips clippy lints we do not control; the allow is scoped to this module only.
#[allow(clippy::manual_div_ceil, clippy::assign_op_pattern)]
mod wide {
    uint::construct_uint! { pub struct U256(4); }
}
pub use wide::U256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    DivByZero,
    Overflow,
}

pub const BPS: u128 = 10_000;
pub const SEC_NS: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * SEC_NS;

fn narrow(x: U256) -> Result<u128, MathError> {
    if x > U256::from(u128::MAX) {
        Err(MathError::Overflow)
    } else {
        Ok(x.low_u128())
    }
}

/// floor(a * b / d) with a 256-bit intermediate. Never overflows internally.
pub fn mul_div_floor(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::DivByZero);
    }
    narrow(U256::from(a) * U256::from(b) / U256::from(d))
}

/// ceil(a * b / d) with a 256-bit intermediate.
pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::DivByZero);
    }
    let (q, r) = (U256::from(a) * U256::from(b)).div_mod(U256::from(d));
    narrow(if r.is_zero() { q } else { q + U256::one() })
}

pub fn bps_floor(amount: u128, bps: u16) -> Result<u128, MathError> {
    mul_div_floor(amount, bps as u128, BPS)
}

pub fn bps_ceil(amount: u128, bps: u16) -> Result<u128, MathError> {
    mul_div_ceil(amount, bps as u128, BPS)
}

pub fn days_to_ns(days: u64) -> Option<u64> {
    days.checked_mul(DAY_NS)
}

pub fn secs_to_ns(secs: u64) -> Option<u64> {
    secs.checked_mul(SEC_NS)
}

/// Saturating elapsed time in ns.
pub fn elapsed(now: u64, since: u64) -> u64 {
    now.saturating_sub(since)
}

/// Linear unlock: 0 at or before `t0`, `total` at or after `t0 + dur`, floor in between.
/// Used by the stream (creator proceeds) and the backer-bonus vest. Depends only on (constants, now).
pub fn linear_unlocked(total: u128, t0: u64, dur_ns: u64, now: u64) -> Result<u128, MathError> {
    if now <= t0 {
        return Ok(0);
    }
    let el = elapsed(now, t0);
    if dur_ns == 0 || el >= dur_ns {
        return Ok(total);
    }
    mul_div_floor(total, el as u128, dur_ns as u128)
}

/// serde adapters: u128/u64 as decimal strings, matching NEAR JSON conventions (JS safe).
pub mod dec {
    use serde::{Deserialize, Deserializer, Serializer};

    pub mod u128 {
        use super::*;
        pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
            s.serialize_str(&v.to_string())
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
            let s = String::deserialize(d)?;
            s.parse().map_err(serde::de::Error::custom)
        }
    }

    pub mod u64 {
        use super::*;
        pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
            s.serialize_str(&v.to_string())
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
            let s = String::deserialize(d)?;
            s.parse().map_err(serde::de::Error::custom)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn floor_and_ceil_basic() {
        assert_eq!(mul_div_floor(10, 3, 4), Ok(7));
        assert_eq!(mul_div_ceil(10, 3, 4), Ok(8));
        assert_eq!(mul_div_ceil(10, 4, 4), Ok(10));
    }

    #[test]
    fn handles_products_beyond_u128() {
        assert_eq!(mul_div_floor(u128::MAX, u128::MAX, u128::MAX), Ok(u128::MAX));
        assert_eq!(mul_div_floor(u128::MAX, 2, 1), Err(MathError::Overflow));
        assert_eq!(mul_div_floor(1, 1, 0), Err(MathError::DivByZero));
    }

    #[test]
    fn spec_example_three_rounding() {
        // S1-B 2.6 example 3: H = 100e6, three buyers of 50_000_001, sigma = 150_000_003.
        assert_eq!(mul_div_ceil(50_000_001, 100_000_000, 150_000_003), Ok(33_333_334));
    }

    #[test]
    fn decimal_string_serde_accepts_owned_and_borrowed_input() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct W(#[serde(with = "dec::u128")] u128);
        let v = serde_json::to_value(W(u128::MAX)).unwrap();
        assert_eq!(serde_json::from_value::<W>(v).unwrap(), W(u128::MAX), "owned strings (from_value) must work");
        assert_eq!(serde_json::from_str::<W>("\"7\"").unwrap(), W(7), "borrowed strings must work");
    }

    #[test]
    fn linear_unlock_bounds() {
        assert_eq!(linear_unlocked(1000, 100, 100, 100), Ok(0));
        assert_eq!(linear_unlocked(1000, 100, 100, 150), Ok(500));
        assert_eq!(linear_unlocked(1000, 100, 100, 999), Ok(1000));
    }

    proptest! {
        #[test]
        fn floor_le_ceil_le_floor_plus_one(a in any::<u128>(), b in any::<u128>(), d in 1u128..) {
            if let (Ok(f), Ok(c)) = (mul_div_floor(a, b, d), mul_div_ceil(a, b, d)) {
                prop_assert!(f <= c && c <= f + 1);
            }
        }

        #[test]
        fn identity_when_numerator_equals_denominator(a in any::<u128>(), d in 1u128..) {
            prop_assert_eq!(mul_div_floor(a, d, d), Ok(a));
            prop_assert_eq!(mul_div_ceil(a, d, d), Ok(a));
        }

        #[test]
        fn matches_u128_when_product_fits(a in 0u64.., b in 0u64.., d in 1u64..) {
            let (a, b, d) = (a as u128, b as u128, d as u128);
            prop_assert_eq!(mul_div_floor(a, b, d), Ok(a * b / d));
        }

        #[test]
        fn linear_unlock_monotone(total in 0u128..u64::MAX as u128, t0 in 0u64..1000, dur in 1u64..1000, n1 in 0u64..3000, n2 in 0u64..3000) {
            let (lo, hi) = if n1 <= n2 { (n1, n2) } else { (n2, n1) };
            prop_assert!(linear_unlocked(total, t0, dur, lo).unwrap() <= linear_unlocked(total, t0, dur, hi).unwrap());
        }
    }
}
