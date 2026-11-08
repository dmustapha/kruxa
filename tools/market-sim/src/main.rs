//! market-sim: runs the real `kruxa-market` math (no mocks) and prints evidence.
//!   market-sim demo          one buy then one sell on a pool, checks the slices, prints SLICES OK
//!   market-sim table [DAYS]  daily fee table (default 60 days) for a fixed, hypothetical daily trade size
use kruxa_logic::FeeTerms;
use kruxa_market::{creator_unlocked, quote_buy, quote_sell, record_creator_fee, Reserves, Routing, Swap, EPOCH_NS};

const USDC: u128 = 1_000_000;
const SEED: Reserves = Reserves { q: 1_000 * USDC, t: 1_000_000_000_000_000 };
const HOUR_NS: u64 = 3_600 * 1_000_000_000;

fn terms() -> FeeTerms {
    FeeTerms { opening_fee_start_bps: 500, opening_decay_minutes: 60, ..FeeTerms::standard() }
}

/// The checks the contract relies on, applied to one swap. Returns false on any violation.
fn check(before: Reserves, s: &Swap, custody_delta: i128, label: &str) -> bool {
    let sum = s.fee.creator + s.fee.platform + s.fee.holders + s.fee.lp + s.fee.referral;
    let k_ok = s.after.k() >= before.k();
    let creator_ok = kruxa_market::fees::creator_take_ok(s.fee.creator, s.q_leg, &terms());
    let ok = sum == s.fee.total && k_ok && creator_ok && custody_delta == 0;
    println!("  {label}: fee {} = creator {} + platform {} + holders {} + lp {} + referral {} | k_ok={k_ok} creator_bound={creator_ok} custody_delta={custody_delta}",
        s.fee.total, s.fee.creator, s.fee.platform, s.fee.holders, s.fee.lp, s.fee.referral);
    ok
}

fn demo() -> bool {
    let t = terms();
    println!(
        "market-sim demo: pool {} USDC / {} tokens, fee 1.00% (opening 5.00% decaying over 60 min), split 50/15/15/10/10, M-A routing",
        SEED.q / USDC,
        SEED.t
    );
    let buy = quote_buy(SEED, 100 * USDC, 1, &t, 0, Routing::M_A).expect("buy");
    // custody delta: USDC in minus (reserve gain + creator + platform + live slices) must be zero
    let d_buy =
        buy.amount_in as i128 - ((buy.after.q - SEED.q) + buy.fee.creator + buy.fee.platform + buy.fee.holders + buy.fee.referral) as i128;
    let ok_buy = check(SEED, &buy, d_buy, "BUY  100 USDC at t=0 (opening fee)");
    println!("    tokens out {}", buy.amount_out);
    let sell = quote_sell(buy.after, buy.amount_out, 1, &t, 2 * HOUR_NS, Routing::M_A).expect("sell");
    let d_sell = (buy.after.q - sell.after.q) as i128 + sell.fee.lp as i128
        - (sell.amount_out + sell.fee.creator + sell.fee.platform + sell.fee.holders + sell.fee.referral + sell.fee.lp) as i128;
    let ok_sell = check(buy.after, &sell, d_sell, "SELL all back at t=2h (base fee)");
    println!("    net USDC out {} (round trip cost {} micro-USDC)", sell.amount_out, 100 * USDC - sell.amount_out);
    let round_trip_loses = sell.amount_out < 100 * USDC;
    println!("  round trip loses value: {round_trip_loses}");
    if ok_buy && ok_sell && round_trip_loses {
        println!("SLICES OK");
        true
    } else {
        println!("SLICES FAILED");
        false
    }
}

fn table(days: u64) {
    let t = terms();
    println!("SIMULATION: hypothetical flat daily trading (buy 500 USDC then sell it all back each day); not a forecast. Amounts in USDC.");
    println!(
        "{:>3} {:>9} {:>8} {:>8} {:>8} {:>8} {:>8} {:>9} {:>10}",
        "day", "volume", "fee", "creator", "platform", "to_lp", "fee_bps", "q_after", "cr_unlock"
    );
    let (mut r, mut list, mut cum) = (SEED, vec![], (0u128, 0u128, 0u128));
    for day in 0..days {
        let now = day * EPOCH_NS + if day == 0 { 0 } else { 2 * HOUR_NS };
        let b = quote_buy(r, 500 * USDC, 1, &t, now, Routing::M_A).expect("buy");
        let s = quote_sell(b.after, b.amount_out, 1, &t, now, Routing::M_A).expect("sell");
        r = s.after;
        let fee = b.fee.total + s.fee.total;
        let (cr, pl, lp) = (b.fee.creator + s.fee.creator, b.fee.platform + s.fee.platform, b.fee.lp + s.fee.lp);
        record_creator_fee(&mut list, 0, now, cr);
        cum = (cum.0 + fee, cum.1 + cr, cum.2 + pl);
        let vol = b.amount_in + s.amount_out + s.fee.total;
        let unlocked = creator_unlocked(&list, 0, 0, &t, now + EPOCH_NS).expect("unlock");
        let bps = fee * 10_000 / vol.max(1);
        if day < 3 || day % 10 == 9 || day + 1 == days {
            println!(
                "{:>3} {:>9.2} {:>8.2} {:>8.2} {:>8.2} {:>8.2} {:>8} {:>9.2} {:>10.2}",
                day + 1,
                f(vol),
                f(fee),
                f(cr),
                f(pl),
                f(lp),
                bps,
                f(r.q),
                f(unlocked)
            );
        }
    }
    println!("totals over {days} days: fee {:.2}, creator {:.2}, platform {:.2}", f(cum.0), f(cum.1), f(cum.2));
    println!("BOUND OK: creator never above 50% of the fee (creator {:.2} of fee {:.2})", f(cum.1), f(cum.0));
    assert!(cum.1 * 2 <= cum.0);
}

fn f(v: u128) -> f64 {
    v as f64 / USDC as f64
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("demo") => std::process::exit(if demo() { 0 } else { 1 }),
        Some("table") => table(args.get(2).and_then(|d| d.parse().ok()).unwrap_or(60)),
        _ => {
            eprintln!("usage: market-sim demo | table [DAYS]");
            std::process::exit(2);
        }
    }
}
