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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_detects_a_missing_unit() {
        let ok = LedgerTotals { credited: 100, open: 40, due: 20, in_flight: 10, refunded: 5, spent: 25 };
        assert!(check_flow(&ok).is_ok());
        assert!(check_flow(&LedgerTotals { spent: 24, ..ok }).is_err());
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
