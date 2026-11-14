//! Announced open (CO-7 2.7): a pool may carry `trade_from_ns`, the first instant a buy is accepted. 0 means "trading opens
//! with the pool", which is also what every pool stored before the field existed means.

/// Rule code of a buy refused before `trade_from_ns`.
pub const R_NOT_YET_TRADING: &str = "R_NOT_YET_TRADING";
/// Rule code of a seed whose `trade_from_ns` is further away than the launcher's own bound.
pub const R_TRADE_FROM: &str = "R_TRADE_FROM";
/// One hour in ns: the longest announced open the market accepts (the launcher's `trade_delay_secs` maximum).
pub const MAX_TRADE_DELAY_NS: u64 = 3_600 * 1_000_000_000;

/// Buys are accepted from `trade_from_ns` on, inclusive.
pub fn trading_open(now: u64, trade_from_ns: u64) -> bool {
    now >= trade_from_ns
}

/// A seed may announce an open at most `MAX_TRADE_DELAY_NS` ahead of now; the past is fine (trade at once).
pub fn trade_from_in_range(now: u64, trade_from_ns: u64) -> bool {
    trade_from_ns <= now.saturating_add(MAX_TRADE_DELAY_NS)
}

/// Opening-fee clock: it starts when trading starts, never before the pool exists.
pub fn fee_elapsed_ns(now: u64, opened_ns: u64, trade_from_ns: u64) -> u64 {
    now.saturating_sub(opened_ns.max(trade_from_ns))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_means_open_at_once() {
        assert!(trading_open(0, 0) && trading_open(5, 0));
    }

    #[test]
    fn buys_open_exactly_at_trade_from() {
        assert!(!trading_open(999, 1_000) && trading_open(1_000, 1_000) && trading_open(1_001, 1_000));
    }

    #[test]
    fn the_announced_open_is_bounded_ahead_not_behind() {
        let now = 10 * MAX_TRADE_DELAY_NS;
        assert!(trade_from_in_range(now, now + MAX_TRADE_DELAY_NS) && trade_from_in_range(now, 1) && trade_from_in_range(now, 0));
        assert!(!trade_from_in_range(now, now + MAX_TRADE_DELAY_NS + 1));
        assert!(trade_from_in_range(u64::MAX, u64::MAX));
    }

    #[test]
    fn the_fee_clock_starts_at_trade_from_and_never_before_the_pool() {
        assert_eq!(fee_elapsed_ns(1_500, 1_000, 0), 500, "no announced open: from the pool opening, as before");
        assert_eq!(fee_elapsed_ns(1_500, 1_000, 1_200), 300, "from trade_from");
        assert_eq!(fee_elapsed_ns(1_100, 1_000, 1_200), 0, "before trade_from the clock has not started");
        assert_eq!(fee_elapsed_ns(1_500, 1_000, 400), 500, "a stale trade_from cannot start the clock before the pool exists");
    }
}
