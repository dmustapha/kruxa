//! market-sim: runs the real `kruxa-market` math (no mocks) and prints evidence.
//!   market-sim demo          one buy then one sell on a pool, checks the slices, prints SLICES OK
//!   market-sim table [DAYS]  daily fee table (default 60 days) for a fixed, hypothetical daily trade size
//!   market-sim sim [DAYS]    `make sim`: three volume scenarios, the supply table, BOUND OK per scenario and a SIM sha256 line
use kruxa_logic::FeeTerms;
use kruxa_market::fees::applied_rate_ppm;
use kruxa_market::{creator_unlocked, quote_buy, quote_sell, record_creator_fee, Reserves, Routing, Swap, EPOCH_NS};
use sha2::{Digest, Sha256};
use std::fmt::Write;

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
    println!("    fee_bps_applied={} tokens out {}", bps_applied(&t, 0), buy.amount_out);
    let sell = quote_sell(buy.after, buy.amount_out, 1, &t, 2 * HOUR_NS, Routing::M_A).expect("sell");
    let d_sell = (buy.after.q - sell.after.q) as i128 + sell.fee.lp as i128
        - (sell.amount_out + sell.fee.creator + sell.fee.platform + sell.fee.holders + sell.fee.referral + sell.fee.lp) as i128;
    let ok_sell = check(buy.after, &sell, d_sell, "SELL all back at t=2h (base fee)");
    println!(
        "    fee_bps_applied={} net USDC out {} (round trip cost {} micro-USDC)",
        bps_applied(&t, 2 * HOUR_NS),
        sell.amount_out,
        100 * USDC - sell.amount_out
    );
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

/// Fee rate in whole bps the contract applies `elapsed_ns` after the pool opened (the `fee_bps_applied` of a swap).
fn bps_applied(t: &FeeTerms, elapsed_ns: u64) -> u128 {
    applied_rate_ppm(t, elapsed_ns) / 100
}

/// Final state of one scenario, enough for the supply table.
struct Outcome {
    reserves: Reserves,
    fee: u128,
    creator: u128,
    unlocked: u128,
}

/// Daily round trip (buy `daily` USDC, sell it all back) for `days` days. Appends the daily rows to `out`.
fn run_scenario(daily: u128, days: u64, out: &mut String) -> Outcome {
    let t = terms();
    writeln!(
        out,
        "{:>3} {:>9} {:>8} {:>8} {:>8} {:>8} {:>8} {:>9} {:>10}",
        "day", "volume", "fee", "creator", "platform", "to_lp", "fee_bps", "q_after", "cr_unlock"
    )
    .unwrap();
    let (mut r, mut list, mut cum) = (SEED, vec![], (0u128, 0u128, 0u128));
    let mut unlocked = 0;
    for day in 0..days {
        let now = day * EPOCH_NS + if day == 0 { 0 } else { 2 * HOUR_NS };
        let b = quote_buy(r, daily, 1, &t, now, Routing::M_A).expect("buy");
        let s = quote_sell(b.after, b.amount_out, 1, &t, now, Routing::M_A).expect("sell");
        r = s.after;
        let fee = b.fee.total + s.fee.total;
        let (cr, pl, lp) = (b.fee.creator + s.fee.creator, b.fee.platform + s.fee.platform, b.fee.lp + s.fee.lp);
        record_creator_fee(&mut list, 0, now, cr);
        cum = (cum.0 + fee, cum.1 + cr, cum.2 + pl);
        let vol = b.amount_in + s.amount_out + s.fee.total;
        unlocked = creator_unlocked(&list, 0, 0, &t, now + EPOCH_NS).expect("unlock");
        if day < 3 || day % 10 == 9 || day + 1 == days {
            let bps = fee * 10_000 / vol.max(1);
            writeln!(
                out,
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
            )
            .unwrap();
        }
    }
    writeln!(out, "totals over {days} days: fee {:.2}, creator {:.2}, platform {:.2}", f(cum.0), f(cum.1), f(cum.2)).unwrap();
    assert!(cum.1 * 2 <= cum.0);
    writeln!(out, "BOUND OK: creator never above 50% of the fee (creator {:.2} of fee {:.2})", f(cum.1), f(cum.0)).unwrap();
    Outcome { reserves: r, fee: cum.0, creator: cum.1, unlocked }
}

fn table(days: u64) {
    let mut out = String::new();
    println!("SIMULATION: hypothetical flat daily trading (buy 500 USDC then sell it all back each day); not a forecast. Amounts in USDC.");
    run_scenario(500 * USDC, days, &mut out);
    print!("{out}");
}

/// `make sim`: three volume scenarios, the supply table, a hash of everything printed above it.
fn sim(days: u64) {
    let t = terms();
    let mut out = String::new();
    writeln!(out, "SIMULATION: hypothetical flat daily trading (buy, then sell it all back each day) over {days} days; not a forecast. Amounts in USDC.").unwrap();
    writeln!(out, "pool {} USDC / {} tokens, fee 1.00%, opening 5.00% decaying over 60 min, split 50/15/15/10/10, M-A routing", SEED.q / USDC, SEED.t).unwrap();
    writeln!(out, "fee_bps_applied: day 1 at pool open = {} bps, from day 2 (2h after the epoch start) = {} bps", bps_applied(&t, 0), bps_applied(&t, 2 * HOUR_NS)).unwrap();
    let scenarios = [("LOW", 100u128), ("BASE", 500), ("HIGH", 2_500)];
    let mut outcomes = vec![];
    for (name, daily) in scenarios {
        writeln!(out, "\nTABLE {name}: {daily} USDC bought and sold back each day").unwrap();
        outcomes.push(run_scenario(daily * USDC, days, &mut out));
    }
    writeln!(out, "\nTABLE SUPPLY: token supply is fixed at creation, no emission and no mint; the pool only trades what exists").unwrap();
    writeln!(out, "{:<8} {:>18} {:>18} {:>12} {:>10} {:>10}", "scenario", "total_supply", "pool_tokens", "outside_pool", "fee", "cr_unlock").unwrap();
    for ((name, _), o) in scenarios.iter().zip(&outcomes) {
        let outside = SEED.t.checked_sub(o.reserves.t).unwrap_or(0);
        writeln!(out, "{:<8} {:>18} {:>18} {:>12} {:>10.2} {:>10.2}", name, SEED.t, o.reserves.t, outside, f(o.fee), f(o.unlocked)).unwrap();
        assert!(o.reserves.t <= SEED.t && o.creator * 2 <= o.fee);
    }
    writeln!(out, "BOUND OK: all {} scenarios, creator never above 50% of the fee; supply never above the fixed total", scenarios.len()).unwrap();
    print!("{out}");
    println!("SIM sha256 {}", hex(&Sha256::digest(out.as_bytes())));
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn f(v: u128) -> f64 {
    v as f64 / USDC as f64
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("demo") => std::process::exit(if demo() { 0 } else { 1 }),
        Some("table") => table(args.get(2).and_then(|d| d.parse().ok()).unwrap_or(60)),
        Some("sim") => sim(args.get(2).and_then(|d| d.parse().ok()).unwrap_or(60)),
        _ => {
            eprintln!("usage: market-sim demo | table [DAYS] | sim [DAYS]");
            std::process::exit(2);
        }
    }
}
