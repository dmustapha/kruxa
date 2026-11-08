//! Constant-product swaps. Fee is always in quote (USDC): on the input for buys, on the gross output for sells.
//! The LP slice stays in the quote reserve (permanent); creator and platform slices leave it for custody counters.
use crate::fees::{creator_take_ok, route_fee, FeeSlices, Routing};
use crate::{MarketError, MIN_TRADE_QUOTE, RESERVE_BOUND_Q};
use kruxa_logic::FeeTerms;
use kruxa_math::{mul_div_floor, U256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reserves {
    pub q: u128,
    pub t: u128,
}

impl Reserves {
    pub fn k(&self) -> U256 {
        U256::from(self.q) * U256::from(self.t)
    }
}

/// Result of a quoted swap. `amount_out` is what the trader receives (tokens for a buy, net USDC for a sell).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Swap {
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee: FeeSlices,
    pub after: Reserves,
    /// Quote leg: the amount the fee was taken from (gross input for a buy, gross output for a sell).
    pub q_leg: u128,
}

/// Plain constant-product output, floor: `out = reserve_out * in / (reserve_in + in)`. Never reaches `reserve_out`.
pub fn cp_out(reserve_in: u128, reserve_out: u128, amount_in: u128) -> Result<u128, MarketError> {
    let denom = reserve_in.checked_add(amount_in).ok_or(MarketError::Math)?;
    Ok(mul_div_floor(reserve_out, amount_in, denom)?)
}

fn check_reserves(r: &Reserves) -> Result<(), MarketError> {
    if r.q == 0 || r.t == 0 || r.q > RESERVE_BOUND_Q {
        return Err(MarketError::Math);
    }
    Ok(())
}

/// Buy: `amount_in` USDC in, tokens out. `min_out` is mandatory (zero is refused).
pub fn quote_buy(r: Reserves, amount_in: u128, min_out: u128, terms: &FeeTerms, elapsed_ns: u64, routing: Routing) -> Result<Swap, MarketError> {
    check_reserves(&r)?;
    if min_out == 0 {
        return Err(MarketError::MinOut);
    }
    if amount_in < MIN_TRADE_QUOTE {
        return Err(MarketError::MinTrade);
    }
    let fee = route_fee(amount_in, terms, elapsed_ns, routing)?;
    debug_assert!(creator_take_ok(fee.creator, amount_in, terms));
    let net = amount_in - fee.total;
    let out = cp_out(r.q, r.t, net)?;
    if out == 0 || out < min_out {
        return Err(MarketError::MinOut);
    }
    // Reserve gains the net swap input plus the LP slice; creator and platform slices (and live holder/referral slices) go to custody.
    let q_after = r.q.checked_add(net).and_then(|x| x.checked_add(fee.lp)).ok_or(MarketError::Math)?;
    let after = Reserves { q: q_after, t: r.t - out };
    check_reserves(&after)?;
    Ok(Swap { amount_in, amount_out: out, fee, after, q_leg: amount_in })
}

/// Sell: `amount_in` tokens in, net USDC out (gross output minus fee).
pub fn quote_sell(r: Reserves, amount_in: u128, min_out: u128, terms: &FeeTerms, elapsed_ns: u64, routing: Routing) -> Result<Swap, MarketError> {
    check_reserves(&r)?;
    if min_out == 0 {
        return Err(MarketError::MinOut);
    }
    let gross = cp_out(r.t, r.q, amount_in)?;
    if gross < MIN_TRADE_QUOTE {
        return Err(MarketError::MinTrade);
    }
    let fee = route_fee(gross, terms, elapsed_ns, routing)?;
    debug_assert!(creator_take_ok(fee.creator, gross, terms));
    let out = gross - fee.total;
    if out < min_out {
        return Err(MarketError::MinOut);
    }
    // Gross leaves the reserve; the LP slice is put back; the rest of the fee sits in custody counters.
    let q_after = r.q - gross + fee.lp;
    let t_after = r.t.checked_add(amount_in).ok_or(MarketError::Math)?;
    let after = Reserves { q: q_after, t: t_after };
    check_reserves(&after)?;
    Ok(Swap { amount_in, amount_out: out, fee, after, q_leg: gross })
}
