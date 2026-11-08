//! Property tests for the market math: k never falls, slices sum to the fee, creator take is bounded,
//! no value is created or lost, the opening fee decays, and creator vesting is monotone and bounded.
use kruxa_logic::FeeTerms;
use kruxa_market::*;
use proptest::prelude::*;

const MIN: u128 = 1_000_000;

fn terms(total: u16, start: u16, decay: u16) -> FeeTerms {
    FeeTerms { total_fee_bps: total, opening_fee_start_bps: start, opening_decay_minutes: decay, ..FeeTerms::standard() }
}

fn reserves() -> impl Strategy<Value = Reserves> {
    (10_000_000u128..5_000_000_000u128, 1_000_000_000u128..1_000_000_000_000_000_000_000_000_000u128).prop_map(|(q, t)| Reserves { q, t })
}

fn any_terms() -> impl Strategy<Value = FeeTerms> {
    (1u16..=100, 0u16..=1_000, 0u16..=120).prop_map(|(total, start, decay)| terms(total, start, decay))
}

proptest! {
    #[test]
    fn buy_k_nondecreasing_and_slices_sum(r in reserves(), amt in MIN..2_000_000_000u128, ft in any_terms(), el in 0u64..8_000_000_000_000u64) {
        if let Ok(s) = quote_buy(r, amt, 1, &ft, el, Routing::M_A) {
            prop_assert!(s.after.k() >= r.k());
            prop_assert_eq!(s.fee.sum(), s.fee.total);
            prop_assert!(s.fee.total < amt);
            prop_assert!(s.amount_out < r.t);
        }
    }

    #[test]
    fn sell_k_nondecreasing_and_slices_sum(r in reserves(), tin in 1u128..100_000_000_000_000_000_000_000_000u128, ft in any_terms(), el in 0u64..8_000_000_000_000u64) {
        if let Ok(s) = quote_sell(r, tin, 1, &ft, el, Routing::M_A) {
            prop_assert!(s.after.k() >= r.k());
            prop_assert_eq!(s.fee.sum(), s.fee.total);
            prop_assert_eq!(s.amount_out + s.fee.total, s.q_leg);
        }
    }

    /// Value conservation on a buy: USDC in = reserve gain + creator + platform + live slices. Tokens: out + reserve left = start.
    #[test]
    fn buy_conserves_value(r in reserves(), amt in MIN..2_000_000_000u128, ft in any_terms(), el in 0u64..8_000_000_000_000u64) {
        if let Ok(s) = quote_buy(r, amt, 1, &ft, el, Routing::M_A) {
            let custody = s.fee.creator + s.fee.platform + s.fee.holders + s.fee.referral;
            prop_assert_eq!(s.after.q - r.q + custody, amt);
            prop_assert_eq!(s.after.t + s.amount_out, r.t);
        }
    }

    #[test]
    fn sell_conserves_value(r in reserves(), tin in 1u128..100_000_000_000_000_000_000_000_000u128, ft in any_terms(), el in 0u64..8_000_000_000_000u64) {
        if let Ok(s) = quote_sell(r, tin, 1, &ft, el, Routing::M_A) {
            let custody = s.fee.creator + s.fee.platform + s.fee.holders + s.fee.referral;
            // gross leaves the reserve; trader gets out; custody gets its slices; the LP slice stays.
            prop_assert_eq!(r.q - s.after.q, s.q_leg - s.fee.lp);
            prop_assert_eq!(s.amount_out + custody + s.fee.lp, s.q_leg);
            prop_assert_eq!(s.after.t, r.t + tin);
        }
    }

    #[test]
    fn creator_take_bounded(amt in MIN..4_000_000_000_000u128, ft in any_terms(), el in 0u64..8_000_000_000_000u64) {
        let f = route_fee(amt, &ft, el, Routing::M_A).unwrap();
        prop_assert!(fees_creator_ok(f.creator, amt, &ft));
        // surcharge never feeds the creator: creator <= base fee * creator_bps
        prop_assert!(f.creator * 10_000 <= (amt * ft.total_fee_bps as u128).div_ceil(10_000) * ft.creator_bps as u128);
    }

    #[test]
    fn opening_fee_decays_monotonically(ft in any_terms(), a in 0u64..8_000_000_000_000u64, b in 0u64..8_000_000_000_000u64) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        prop_assert!(applied(&ft, lo) >= applied(&ft, hi));
        prop_assert!(applied(&ft, hi) >= base_rate_ppm(&ft));
    }

    #[test]
    fn vest_monotone_and_bounded(amounts in proptest::collection::vec(1u128..1_000_000_000_000, 1..30), t1 in 0u64..400, dt in 0u64..400) {
        let ft = FeeTerms::standard();
        let opened = 1_000;
        let mut list = vec![];
        for (i, a) in amounts.iter().enumerate() {
            record_creator_fee(&mut list, opened, opened + i as u64 * EPOCH_NS + 5, *a);
        }
        let total: u128 = amounts.iter().sum();
        let n1 = opened + t1 * EPOCH_NS;
        let n2 = n1 + dt * EPOCH_NS;
        let u1 = creator_unlocked(&list, 0, opened, &ft, n1).unwrap();
        let u2 = creator_unlocked(&list, 0, opened, &ft, n2).unwrap();
        prop_assert!(u1 <= u2 && u2 <= total);
        // folding changes nothing
        let (mut l2, mut folded) = (list.clone(), 0u128);
        fold_vested(&mut l2, &mut folded, opened, &ft, n1);
        prop_assert_eq!(creator_unlocked(&l2, folded, opened, &ft, n2).unwrap(), u2);
    }
}

fn fees_creator_ok(creator: u128, q_leg: u128, ft: &FeeTerms) -> bool {
    kruxa_market::fees::creator_take_ok(creator, q_leg, ft)
}

fn applied(ft: &FeeTerms, el: u64) -> u128 {
    kruxa_market::fees::applied_rate_ppm(ft, el)
}

#[test]
fn opening_fee_500_bps_decays_over_60_min() {
    let ft = terms(100, 500, 60);
    assert_eq!(applied(&ft, 0), 50_000);
    assert_eq!(applied(&ft, 30 * 60 * 1_000_000_000), 30_000);
    assert_eq!(applied(&ft, 60 * 60 * 1_000_000_000), 10_000);
    assert_eq!(applied(&ft, u64::MAX), 10_000);
}

#[test]
fn surcharge_goes_to_lp_and_creator_unchanged() {
    let ft = terms(100, 500, 60);
    let at0 = route_fee(100_000_000, &ft, 0, Routing::M_A).unwrap();
    let late = route_fee(100_000_000, &ft, u64::MAX, Routing::M_A).unwrap();
    assert_eq!(at0.total, 5_000_000);
    assert_eq!(late.total, 1_000_000);
    assert_eq!(at0.creator, late.creator);
    assert_eq!(at0.platform, late.platform);
    assert_eq!(at0.surcharge, 4_000_000);
    assert_eq!(at0.lp - late.lp, 4_000_000);
}

#[test]
fn default_split_at_1_percent() {
    let f = route_fee(100_000_000, &FeeTerms::standard(), 0, Routing::M_A).unwrap();
    assert_eq!((f.total, f.creator, f.platform), (1_000_000, 500_000, 150_000));
    assert_eq!((f.red_holders, f.red_referral, f.holders, f.referral), (150_000, 100_000, 0, 0));
    assert_eq!(f.lp, 350_000);
    let live = route_fee(100_000_000, &FeeTerms::standard(), 0, Routing { holders_live: true, referral_live: true }).unwrap();
    assert_eq!((live.holders, live.referral, live.lp), (150_000, 100_000, 100_000));
}

#[test]
fn min_out_is_mandatory() {
    let r = Reserves { q: 1_000_000_000, t: 1_000_000_000_000 };
    let ft = FeeTerms::standard();
    assert_eq!(quote_buy(r, 10_000_000, 0, &ft, 0, Routing::M_A).unwrap_err(), MarketError::MinOut);
    assert_eq!(quote_sell(r, 1_000_000_000, 0, &ft, 0, Routing::M_A).unwrap_err(), MarketError::MinOut);
    let ok = quote_buy(r, 10_000_000, 1, &ft, 0, Routing::M_A).unwrap();
    assert_eq!(quote_buy(r, 10_000_000, ok.amount_out + 1, &ft, 0, Routing::M_A).unwrap_err(), MarketError::MinOut);
}

#[test]
fn dust_trade_refused_and_terms_validated() {
    let r = Reserves { q: 1_000_000_000, t: 1_000_000_000_000 };
    assert_eq!(quote_buy(r, 999_999, 1, &FeeTerms::standard(), 0, Routing::M_A).unwrap_err(), MarketError::MinTrade);
    assert!(validate_market_terms(&FeeTerms::standard()).is_ok());
    let bad = FeeTerms { creator_bps: 6_001, platform_bps: 1_499, ..FeeTerms::standard() };
    assert_eq!(validate_market_terms(&bad), Err(MarketError::FeeTerms));
    assert_eq!(validate_market_terms(&terms(100, 1_001, 60)), Err(MarketError::FeeTerms));
}

#[test]
fn round_trip_never_profits() {
    let r = Reserves { q: 1_000_000_000, t: 1_000_000_000_000 };
    let ft = FeeTerms::standard();
    let b = quote_buy(r, 50_000_000, 1, &ft, 0, Routing::M_A).unwrap();
    let s = quote_sell(b.after, b.amount_out, 1, &ft, 0, Routing::M_A).unwrap();
    assert!(s.amount_out < 50_000_000);
}

#[test]
fn creator_vest_schedule() {
    let ft = FeeTerms::standard(); // 50% vests over 90 days
    let mut list = vec![];
    record_creator_fee(&mut list, 0, 10, 1_000_000);
    assert_eq!(creator_unlocked(&list, 0, 0, &ft, 20).unwrap(), 500_000); // immediate half, vest has not started (before epoch close)
    let close = EPOCH_NS;
    assert_eq!(creator_unlocked(&list, 0, 0, &ft, close + 45 * EPOCH_NS).unwrap(), 750_000);
    assert_eq!(creator_unlocked(&list, 0, 0, &ft, close + 90 * EPOCH_NS).unwrap(), 1_000_000);
}
