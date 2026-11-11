//! kruxa-sim: recompute Kruxa results with the SAME pure code the contract runs.
//!   kruxa-sim verdict --launch-id 1 --total-active 360000000 --funders 12 --soft-cap 350000000 --min-funders 10 [--cancelled] [--charter-hash <64 hex>]
//!   kruxa-sim verdict --inputs fixtures/pass.json
//!   kruxa-sim settle --total-active 1400000000 --hard-cap 1000000000 --commit 100000000
//!   kruxa-sim settle --inputs fixtures/oversub.json --buyer 7
//!   kruxa-sim fold --events events.jsonl [--book-hash HEX] [--launch N] [--tamper]
//!   kruxa-sim validate --params fixtures/hostile.json [--profile ladder|demo] [--headroom N] [--brand]
//!   kruxa-sim fuzz [--n 10000] [--seed 1]
//!   kruxa-sim verify --rpc URL [--rpc2 URL] --contract core.kruxa.testnet --launch 1 [--tamper [FIELD] | --tamper-all]
//!   kruxa-sim verify-ledger --rpc URL [--rpc2 URL] --contract core.kruxa.testnet --launch 1 [--tamper [FIELD] | --tamper-all]      C33
//!   kruxa-sim verify-market --rpc URL [--rpc2 URL] (--market ACCOUNT | --core ACCOUNT) [--pools 1,2] [--tamper [FIELD] | --tamper-all]   C34
//!   kruxa-sim verify-instant --rpc URL [--rpc2 URL] --launcher ACCOUNT --launch 1000000000 [--tamper [FIELD] | --tamper-all]
//!   kruxa-sim rules [--profile ladder|demo] [--rpc URL --contract ACCOUNT]    the Rules defaults, or a live get_rule_set compared key by key (C-04)
//! Exit codes (CO-6 E-4): 0 MATCH, 2 only MISMATCH, 3 pending, 4 RPC or view failure, 64 usage, 1 tamper self-test failure.
mod cli;
mod fold;
mod fuzz;
mod instant;
mod ledger;
mod market;
mod recompute;
mod rules;
mod validate;
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

fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> T {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| usage(&format!("cannot read --inputs {path}: {e}")));
    serde_json::from_str(&text).unwrap_or_else(|e| usage(&format!("{path} is not valid for this command: {e}")))
}

fn reason_names(bits: u8) -> String {
    [(1, "BELOW_SOFT_CAP"), (2, "BELOW_MIN_FUNDERS"), (4, "CANCELLED")]
        .iter()
        .filter(|(b, _)| bits & b != 0)
        .map(|(_, n)| *n)
        .collect::<Vec<_>>()
        .join("|")
}

fn run_verdict(args: &[String]) {
    const SPEC: Spec = Spec {
        values: &["inputs", "launch-id", "total-active", "funders", "soft-cap", "min-funders", "charter-hash"],
        optional_values: &[],
        switches: &["cancelled"],
    };
    let f = parse_flags(args, &SPEC);
    let i: VerdictInputs = match f.get("inputs") {
        Some(path) => read_json(path),
        None => VerdictInputs {
            launch_id: num(&f, "launch-id"),
            charter_hash: f.get("charter-hash").map_or([0; 32], |h| parse_hash(h)),
            total_active: num(&f, "total-active"),
            active_funders: num(&f, "funders"),
            soft_cap: num(&f, "soft-cap"),
            min_funders: num(&f, "min-funders"),
            cancelled: f.contains_key("cancelled"),
        },
    };
    match verdict(&i) {
        Outcome::Pass => println!("outcome=PASS"),
        Outcome::Fail(r) => println!("outcome=FAIL(reasons={r})\nreasons={}", reason_names(r)),
    }
    println!("inputs_hash={}", hex(&inputs_hash(&i)));
}

/// `settle --inputs FILE --buyer N`: the fixture is `{"hard_cap": "...", "commits": ["...", ...]}`; N is 1-based.
#[derive(serde::Deserialize)]
struct BookFixture {
    #[serde(with = "kruxa_math::dec::u128")]
    hard_cap: u128,
    commits: Vec<String>,
}

fn micro(v: u128) -> String {
    format!("{}.{:06}", v / 1_000_000, v % 1_000_000)
}

fn run_settle_book(path: &str, buyer: usize) {
    let book: BookFixture = read_json(path);
    let commits: Vec<u128> =
        book.commits.iter().map(|c| c.parse().unwrap_or_else(|_| usage(&format!("commit '{c}' is not an integer")))).collect();
    let commit = *commits.get(buyer.wrapping_sub(1)).unwrap_or_else(|| usage(&format!("--buyer {buyer} is outside 1..={}", commits.len())));
    let total: u128 = commits.iter().sum();
    print_settlement(total, book.hard_cap, commit, Some(buyer));
}

fn print_settlement(total: u128, hard: u128, commit: u128, buyer: Option<usize>) {
    let r = Rules { max_hard_cap: hard.max(Rules::ladder().max_hard_cap), ..Rules::ladder() };
    let a = allocate(total, hard, 6_000, 2_500, &r).unwrap_or_else(|e| usage(&format!("{e:?}")));
    let p =
        settle_position(commit, total, a.accepted, 600_000_000_000_000, 50_000_000_000_000).unwrap_or_else(|e| usage(&format!("{e:?}")));
    println!(
        "accepted={} launch_fee={} lp_quote={} stream={} excess_pool={}\nspend={} refund={} tokens={} bonus={}",
        a.accepted, a.launch_fee, a.lp_quote, a.stream, a.excess_pool, p.spend, p.refund, p.tokens, p.bonus
    );
    if let Some(n) = buyer {
        println!("buyer {n}: spend {} refund {} tokens {}", micro(p.spend), micro(p.refund), micro(p.tokens));
    }
}

fn run_settle(args: &[String]) {
    const SPEC: Spec = Spec { values: &["inputs", "buyer", "total-active", "hard-cap", "commit"], optional_values: &[], switches: &[] };
    let f = parse_flags(args, &SPEC);
    if let Some(path) = f.get("inputs") {
        return run_settle_book(path, num(&f, "buyer"));
    }
    print_settlement(num(&f, "total-active"), num(&f, "hard-cap"), num(&f, "commit"), None);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest = args.get(1..).unwrap_or(&[]);
    match args.first().map(String::as_str) {
        Some("verdict") => run_verdict(rest),
        Some("settle") => run_settle(rest),
        Some("verify") => verify::run(rest),
        Some("rules") => rules::run(rest),
        Some("verify-instant") => instant::run(rest),
        Some("verify-ledger") => ledger::run(rest),
        Some("verify-market") => market::run(rest),
        Some("fold") => fold::run(rest),
        Some("validate") => validate::run(rest),
        Some("fuzz") => fuzz::run(rest),
        _ => usage(
            "kruxa-sim verdict|settle|fold|validate|fuzz|verify|verify-ledger|verify-market|verify-instant|rules (see the file header)",
        ),
    }
}
