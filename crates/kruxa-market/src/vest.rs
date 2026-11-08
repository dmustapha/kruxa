//! Creator fee epochs: 24 h buckets from the pool's opening. Of each bucket `fee_vest_bps` vests linearly over
//! `fee_vest_days` starting at the epoch close; the rest is claimable at once.
use crate::MarketError;
use kruxa_logic::FeeTerms;
use kruxa_math::{linear_unlocked, mul_div_floor, BPS, DAY_NS};

pub const EPOCH_NS: u64 = DAY_NS;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EpochAccrual {
    pub epoch: u32,
    pub amount: u128,
}

pub fn epoch_of(opened_ns: u64, now_ns: u64) -> u32 {
    (now_ns.saturating_sub(opened_ns) / EPOCH_NS).min(u32::MAX as u64) as u32
}

fn epoch_close_ns(opened_ns: u64, epoch: u32) -> u64 {
    opened_ns.saturating_add((epoch as u64 + 1).saturating_mul(EPOCH_NS))
}

fn vest_dur_ns(terms: &FeeTerms) -> u64 {
    terms.fee_vest_days as u64 * DAY_NS
}

/// Add a creator slice to the epoch of `now_ns` (merges into the newest entry when it is the same epoch).
pub fn record_creator_fee(list: &mut Vec<EpochAccrual>, opened_ns: u64, now_ns: u64, amount: u128) {
    if amount == 0 {
        return;
    }
    let epoch = epoch_of(opened_ns, now_ns);
    match list.last_mut() {
        Some(last) if last.epoch == epoch => last.amount += amount,
        _ => list.push(EpochAccrual { epoch, amount }),
    }
}

fn entry_unlocked(e: &EpochAccrual, opened_ns: u64, terms: &FeeTerms, now_ns: u64) -> Result<u128, MarketError> {
    let vested_part = mul_div_floor(e.amount, terms.fee_vest_bps as u128, BPS)?;
    let immediate = e.amount - vested_part;
    let lin = linear_unlocked(vested_part, epoch_close_ns(opened_ns, e.epoch), vest_dur_ns(terms), now_ns)?;
    Ok(immediate + lin)
}

/// Total creator amount claimable at `now_ns` (before subtracting what was already paid).
pub fn creator_unlocked(list: &[EpochAccrual], folded_unlocked: u128, opened_ns: u64, terms: &FeeTerms, now_ns: u64) -> Result<u128, MarketError> {
    let mut total = folded_unlocked;
    for e in list {
        total = total.checked_add(entry_unlocked(e, opened_ns, terms, now_ns)?).ok_or(MarketError::Math)?;
    }
    Ok(total)
}

/// Move fully vested entries into `folded_unlocked` so the list stays at most `fee_vest_days + 2` long.
pub fn fold_vested(list: &mut Vec<EpochAccrual>, folded_unlocked: &mut u128, opened_ns: u64, terms: &FeeTerms, now_ns: u64) {
    let done_at = |e: &EpochAccrual| epoch_close_ns(opened_ns, e.epoch).saturating_add(vest_dur_ns(terms));
    list.retain(|e| {
        if now_ns >= done_at(e) {
            *folded_unlocked += e.amount;
            false
        } else {
            true
        }
    });
}
