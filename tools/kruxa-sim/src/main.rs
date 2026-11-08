//! kruxa-sim: recompute Kruxa results with the SAME pure code the contract runs.
//!   kruxa-sim verdict --launch-id 1 --total-active 360000000 --funders 12 --soft-cap 350000000 --min-funders 10 [--cancelled] [--charter-hash <64 hex>]
//!   kruxa-sim settle --total-active 1400000000 --hard-cap 1000000000 --commit 100000000
//!   kruxa-sim verify --rpc URL [--rpc2 URL] --contract core.kruxa.testnet --launch 1 [--tamper [FIELD] | --tamper-all]
//! Exit codes (CO-6 E-4): 0 MATCH, 2 only MISMATCH, 3 pending, 4 RPC or view failure, 64 usage, 1 tamper self-test failure.
mod cli;
mod verify;

use cli::*;
use kruxa_logic::{allocate, hex, inputs_hash, settle_position, verdict, Outcome, Rules, VerdictInputs};

fn parse_hash(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    if s.len() != 64 || (0..32).any(|i| s.get(2 * i..2 * i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()).map(|b| out[i] = b).is_none())
    {
        usage("charter hash must be 64 hex chars");
    }
    out
}

fn run_verdict(args: &[String]) {
    const SPEC: Spec = Spec {
        values: &["launch-id", "total-active", "funders", "soft-cap", "min-funders", "charter-hash"],
        optional_values: &[],
        switches: &["cancelled"],
    };
    let f = parse_flags(args, &SPEC);
    let i = VerdictInputs {
        launch_id: num(&f, "launch-id"),
        charter_hash: f.get("charter-hash").map_or([0; 32], |h| parse_hash(h)),
        total_active: num(&f, "total-active"),
        active_funders: num(&f, "funders"),
        soft_cap: num(&f, "soft-cap"),
        min_funders: num(&f, "min-funders"),
        cancelled: f.contains_key("cancelled"),
    };
    let out = match verdict(&i) {
        Outcome::Pass => "PASS".to_string(),
        Outcome::Fail(r) => format!("FAIL(reasons={r})"),
    };
    println!("outcome={out}\ninputs_hash={}", hex(&inputs_hash(&i)));
}

fn run_settle(args: &[String]) {
    const SPEC: Spec = Spec { values: &["total-active", "hard-cap", "commit"], optional_values: &[], switches: &[] };
    let f = parse_flags(args, &SPEC);
    let (total, hard, commit): (u128, u128, u128) = (num(&f, "total-active"), num(&f, "hard-cap"), num(&f, "commit"));
    let r = Rules { max_hard_cap: hard.max(Rules::ladder().max_hard_cap), ..Rules::ladder() };
    let a = allocate(total, hard, 6_000, 2_500, &r).unwrap_or_else(|e| usage(&format!("{e:?}")));
    let p =
        settle_position(commit, total, a.accepted, 600_000_000_000_000, 50_000_000_000_000).unwrap_or_else(|e| usage(&format!("{e:?}")));
    println!(
        "accepted={} launch_fee={} lp_quote={} stream={} excess_pool={}\nspend={} refund={} tokens={} bonus={}",
        a.accepted, a.launch_fee, a.lp_quote, a.stream, a.excess_pool, p.spend, p.refund, p.tokens, p.bonus
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest = args.get(1..).unwrap_or(&[]);
    match args.first().map(String::as_str) {
        Some("verdict") => run_verdict(rest),
        Some("settle") => run_settle(rest),
        Some("verify") => verify::run(rest),
        _ => usage("kruxa-sim verdict|settle|verify (see the file header)"),
    }
}
