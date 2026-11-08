use serde::{Deserialize, Serialize};

/// Per-launch money counters (micro-USDC). Every unit credited is in exactly one of these places.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerTotals {
    pub credited: u128,
    pub open: u128,
    pub due: u128,
    pub in_flight: u128,
    pub refunded: u128,
    pub spent: u128,
}

/// L1 flow conservation: credited == open + due + in_flight + refunded + spent.
pub fn check_flow(t: &LedgerTotals) -> Result<(), &'static str> {
    let sum = t
        .open
        .checked_add(t.due)
        .and_then(|x| x.checked_add(t.in_flight))
        .and_then(|x| x.checked_add(t.refunded))
        .and_then(|x| x.checked_add(t.spent));
    if sum == Some(t.credited) {
        Ok(())
    } else {
        Err("L1: credited != open + due + in_flight + refunded + spent")
    }
}

/// Settlement buckets after PASS.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Buckets {
    pub launch_fee_due: u128,
    pub lp_seed_due: u128,
    pub stream_total: u128,
    pub excess_pool: u128,
}

/// L4: launch_fee + lp_seed + stream + excess_pool == open + spent. Holds at settle and after every lazy position settlement.
pub fn check_pass_conservation(b: &Buckets, open: u128, spent: u128) -> Result<(), &'static str> {
    let lhs = b.launch_fee_due + b.lp_seed_due + b.stream_total + b.excess_pool;
    if lhs == open + spent {
        Ok(())
    } else {
        Err("L4: buckets != open + spent")
    }
}

/// What `get_invariants` sums over the position records of one launch (bounded by the holder cap).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BookSums {
    /// A verdict (PASS or FAIL) has been recorded.
    pub verdict_reached: bool,
    pub total_active: u128,
    pub active_funders: u32,
    pub positions_unsettled: u32,
    /// Ledger `open_native + open_intents`.
    pub ledger_open: u128,
    /// Sum of `open` over all stored positions.
    pub sum_open: u128,
    /// Positions with `open > 0` that are not yet settled.
    pub count_open_unsettled: u32,
}

/// I2 position sum. Before a verdict the open amounts ARE the book: their sum is `total_active` and their count is `active_funders`.
/// After a verdict positions settle lazily, so the unsettled ones must match `positions_unsettled`. Always: positions sum to the ledger.
pub fn i2_position_count(b: &BookSums) -> Result<(), &'static str> {
    if b.sum_open != b.ledger_open {
        return Err("I2: sum of position open != ledger open");
    }
    if !b.verdict_reached && (b.sum_open != b.total_active || b.count_open_unsettled != b.active_funders) {
        return Err("I2: positions do not sum to total_active / active_funders");
    }
    if b.verdict_reached && b.count_open_unsettled != b.positions_unsettled {
        return Err("I2: unsettled positions != positions_unsettled");
    }
    Ok(())
}

/// I3 verdict inputs frozen. Once a settlement is recorded, the live `total_active` and the recomputed `inputs_hash` still equal it.
/// `recorded` is `(total_active, inputs_hash)` from the settlement; `None` before a verdict.
pub fn i3_inputs_frozen(
    recorded: Option<(u128, [u8; 32])>,
    live_total_active: u128,
    live_inputs_hash: [u8; 32],
) -> Result<(), &'static str> {
    match recorded {
        Some((total, hash)) if total != live_total_active || hash != live_inputs_hash => {
            Err("I3: verdict inputs changed after the verdict")
        }
        _ => Ok(()),
    }
}

/// Stage of a launch with the payload of `Status` removed. Declaration order is the only legal direction of travel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StatusClass {
    Creating,
    CreationFailed,
    Open,
    Passed,
    Failed,
    Dissolved,
}

/// What a snapshot can prove about I4: the stage agrees with the settlement record. A launch that moved back to Open would still
/// carry a settlement, and a Passed launch without one is impossible. The sandbox suite checks the history side (rank never drops).
/// `settlement` is `(pass, reasons)`; `status_reasons` is the payload of `Failed`.
pub fn i4_status_monotone(class: StatusClass, settlement: Option<(bool, u8)>, status_reasons: u8) -> Result<(), &'static str> {
    let ok = match (class, settlement) {
        (StatusClass::Creating | StatusClass::CreationFailed | StatusClass::Open, None) => true,
        (StatusClass::Passed, Some((true, 0))) => true,
        (StatusClass::Failed, Some((false, r))) => r == status_reasons && r != 0,
        (StatusClass::Dissolved, Some((false, _))) => true,
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err("I4: status disagrees with the settlement record")
    }
}

/// I5 no double money. Each entry is `(what, paid_plus_inflight, limit)`; the first entry above its limit is the error.
pub fn i5_no_overpay(entries: &[(&'static str, u128, u128)]) -> Result<(), &'static str> {
    entries.iter().find(|(_, out, limit)| out > limit).map_or(Ok(()), |(what, _, _)| Err(*what))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_detects_a_missing_unit() {
        let ok = LedgerTotals { credited: 100, open: 40, due: 20, in_flight: 10, refunded: 5, spent: 25 };
        assert!(check_flow(&ok).is_ok());
        assert!(check_flow(&LedgerTotals { spent: 24, ..ok }).is_err());
    }

    fn book(verdict_reached: bool) -> BookSums {
        BookSums {
            verdict_reached,
            total_active: 300,
            active_funders: 3,
            positions_unsettled: 3,
            ledger_open: 300,
            sum_open: 300,
            count_open_unsettled: 3,
        }
    }

    #[test]
    fn i2_position_sums_match_before_and_after_a_verdict() {
        assert!(i2_position_count(&book(false)).is_ok());
        assert!(i2_position_count(&book(true)).is_ok());
        assert!(i2_position_count(&BookSums { sum_open: 299, ..book(false) }).is_err(), "positions disagree with the ledger");
        assert!(
            i2_position_count(&BookSums { total_active: 301, ledger_open: 300, ..book(false) }).is_err(),
            "book disagrees with total_active"
        );
        assert!(i2_position_count(&BookSums { count_open_unsettled: 2, ..book(false) }).is_err(), "funder count off by one");
        assert!(i2_position_count(&BookSums { count_open_unsettled: 2, ..book(true) }).is_err(), "unsettled count off by one");
        let half = BookSums { positions_unsettled: 1, count_open_unsettled: 1, sum_open: 100, ledger_open: 100, ..book(true) };
        assert!(i2_position_count(&half).is_ok(), "lazy settlement in progress");
    }

    #[test]
    fn i3_inputs_stay_frozen_after_the_verdict() {
        let h = [1u8; 32];
        assert!(i3_inputs_frozen(None, 5, h).is_ok(), "no verdict yet, nothing to freeze");
        assert!(i3_inputs_frozen(Some((5, h)), 5, h).is_ok());
        assert!(i3_inputs_frozen(Some((5, h)), 6, h).is_err());
        assert!(i3_inputs_frozen(Some((5, h)), 5, [2; 32]).is_err());
    }

    #[test]
    fn i4_status_must_agree_with_the_settlement_record() {
        use StatusClass::*;
        assert!(i4_status_monotone(Open, None, 0).is_ok());
        assert!(i4_status_monotone(Passed, Some((true, 0)), 0).is_ok());
        assert!(i4_status_monotone(Failed, Some((false, 3)), 3).is_ok());
        assert!(i4_status_monotone(Dissolved, Some((false, 3)), 0).is_ok());
        assert!(i4_status_monotone(Open, Some((true, 0)), 0).is_err(), "a launch that went back to Open");
        assert!(i4_status_monotone(Passed, None, 0).is_err());
        assert!(i4_status_monotone(Failed, Some((false, 1)), 3).is_err(), "reason bits differ");
        assert!(i4_status_monotone(Failed, Some((true, 0)), 0).is_err());
        assert!(Open < Passed && Passed < Failed && Failed < Dissolved, "rank order is the legal direction of travel");
    }

    #[test]
    fn i5_no_overpay_names_the_first_offender() {
        assert!(i5_no_overpay(&[("refund", 60, 100), ("tokens", 5, 5)]).is_ok());
        assert_eq!(i5_no_overpay(&[("refund", 60, 100), ("stream", 11, 10)]), Err("stream"));
        assert!(i5_no_overpay(&[]).is_ok());
    }

    #[test]
    fn pass_conservation_survives_a_lazy_settlement_step() {
        let b = Buckets { launch_fee_due: 10, lp_seed_due: 40, stream_total: 50, excess_pool: 100 };
        assert!(check_pass_conservation(&b, 200, 0).is_ok());
        // one position (commit 60) settles: spend 18, refund 42 -> excess_pool -= 42, open -= 60, spent += 18
        let after = Buckets { excess_pool: 58, ..b };
        assert!(check_pass_conservation(&after, 140, 18).is_ok());
    }
}
