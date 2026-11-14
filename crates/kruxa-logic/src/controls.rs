//! Admin controls as pure functions of the clock: the pause level (with FROZEN auto-expiry) and the cap-raise timelock.
//! The contract's `pause_level()` and `apply_*_cap` call these, so the tests here exercise the code that runs on chain.

/// One day in nanoseconds (block timestamps are ns).
pub const DAY_NS: u64 = 86_400_000_000_000;
/// FROZEN lifts itself after 7 days without a transaction (RULING 2026-11-07; W1-DC-9).
pub const FREEZE_MAX_NS: u64 = 7 * DAY_NS;
/// Raising a cap is public for 7 days before it applies (RULING 2026-11-07: "raising caps is timelocked").
pub const CAP_TIMELOCK_NS: u64 = 7 * DAY_NS;
/// Global cap in micro-USDC (RULING 2026-11-07: $3,000).
pub const GLOBAL_CAP_USDC: u128 = 3_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pause {
    /// Everything open.
    None,
    /// New risk blocked, exits (Walk, refunds, claims) stay open, no expiry.
    Paused,
    /// Everything blocked, including exits; becomes `Paused` on its own once `frozen_until` is reached.
    Frozen,
}

/// The effective pause level at `now`. `frozen_until` is only read while the stored level is `Frozen`.
pub fn pause_at(stored: Pause, frozen_until: u64, now: u64) -> Pause {
    match stored {
        Pause::Frozen if now >= frozen_until => Pause::Paused,
        other => other,
    }
}

/// When a freeze started at `now` stops being a freeze.
pub fn frozen_until(now: u64) -> u64 {
    now.saturating_add(FREEZE_MAX_NS)
}

/// The earliest time the guardian may freeze again after a freeze that runs until `frozen_until`: one full `FREEZE_MAX_NS` window
/// after it ends, so exits are open for at least that long between two guardian freezes (however the first one ended).
pub fn freeze_barrier(frozen_until: u64) -> u64 {
    frozen_until.saturating_add(FREEZE_MAX_NS)
}

/// True when a freeze at `now` may take effect. The owner is never held back (it is also the only account that can unpause);
/// the guardian must wait until `barrier`. Equality counts as passed.
pub fn freeze_allowed(by_owner: bool, barrier: u64, now: u64) -> bool {
    by_owner || now >= barrier
}

/// When a cap raise queued at `now` may be applied.
pub fn timelock_effective_at(now: u64) -> u64 {
    now.saturating_add(CAP_TIMELOCK_NS)
}

/// True once a queued change may be applied. Equality counts as elapsed.
pub fn timelock_elapsed(effective_at: u64, now: u64) -> bool {
    now >= effective_at
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_frozen_expires_exactly_at_frozen_until() {
        let until = frozen_until(1_000);
        assert_eq!(until, 1_000 + 7 * 86_400 * 1_000_000_000);
        assert_eq!(pause_at(Pause::Frozen, until, until - 1), Pause::Frozen, "one ns before: still frozen");
        assert_eq!(pause_at(Pause::Frozen, until, until), Pause::Paused, "at the boundary: exits are open again");
        assert_eq!(pause_at(Pause::Frozen, until, u64::MAX), Pause::Paused, "and it never goes back to Frozen or None");
    }

    #[test]
    fn freeze_barrier_is_one_window_after_the_freeze_ends() {
        let until = frozen_until(1_000);
        assert_eq!(freeze_barrier(until), 1_000 + 2 * FREEZE_MAX_NS);
        assert_eq!(freeze_barrier(u64::MAX), u64::MAX, "saturates instead of wrapping to an already-passed time");
    }

    #[test]
    fn guardian_freeze_waits_for_the_barrier_and_owner_never_does() {
        let barrier = freeze_barrier(frozen_until(0));
        assert!(!freeze_allowed(false, barrier, 0), "right after the freeze started");
        assert!(!freeze_allowed(false, barrier, frozen_until(0)), "the moment the freeze ends the guardian still waits");
        assert!(!freeze_allowed(false, barrier, barrier - 1), "one ns before the barrier");
        assert!(freeze_allowed(false, barrier, barrier), "at the barrier");
        assert!(freeze_allowed(true, barrier, 0), "the owner is not bound");
        assert!(freeze_allowed(false, 0, 0), "no freeze ever happened: barrier 0 never blocks");
    }

    #[test]
    fn pause_levels_other_than_frozen_never_change_with_time() {
        for now in [0, 1, FREEZE_MAX_NS, u64::MAX] {
            assert_eq!(pause_at(Pause::None, 0, now), Pause::None);
            assert_eq!(pause_at(Pause::Paused, 0, now), Pause::Paused, "a plain pause has no expiry");
        }
    }

    #[test]
    fn timelock_applies_at_exactly_seven_days_not_before() {
        let at = timelock_effective_at(500);
        assert_eq!(at, 500 + 7 * DAY_NS);
        assert!(!timelock_elapsed(at, at - 1));
        assert!(timelock_elapsed(at, at));
        assert_eq!(timelock_effective_at(u64::MAX), u64::MAX, "saturates instead of wrapping to an instantly-applicable time");
    }

    #[test]
    fn ruled_cap_constants() {
        assert_eq!(GLOBAL_CAP_USDC, 3_000 * 1_000_000, "$3,000 global");
        assert_eq!((FREEZE_MAX_NS, CAP_TIMELOCK_NS), (604_800_000_000_000, 604_800_000_000_000));
    }
}
