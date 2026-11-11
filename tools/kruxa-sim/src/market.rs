//! `kruxa-sim verify-market`: check C34, the market custody identity, recomputed from raw pool state (FG-04).
//!   USDC custody = sum of pool reserves q + creator fees unpaid + platform fees unpaid + owed USDC
//!   token custody (per token) = sum of pool token reserves t + owed
//! The raw inputs are `get_pool`, `ledger_report`, `solvency_report` and the REAL `ft_balance_of(market)` on each token. The market's own
//! `get_invariants` identity boolean is not read. Pools are found by scanning launch ids from 1 (stops after `GAP` empty ids in a row)
//! or listed with `--pools 1,2,3` (instant market ids start at 1000000000). Not recomputable: k non-decreasing (needs the swap history).
use crate::cli::*;
use crate::recompute::*;
use crate::verify::view;
use serde_json::{json, Value};

pub const TAMPER_FIELDS: [&str; 6] = ["pool_q", "pool_t", "global_q", "platform_unpaid", "usdc_expected", "token_expected"];
pub const SPEC: Spec =
    Spec { values: &["rpc", "rpc2", "market", "core", "pools"], optional_values: &["tamper"], switches: &["tamper-all"] };
const GAP: u64 = 8;
const SCAN_LIMIT: u64 = 256;
const APPLICABLE: [&str; 5] = ["global_q", "usdc_identity", "usdc_custody", "token_identity", "token_custody"];

#[derive(Clone)]
struct Pool {
    token: String,
    q: u128,
    t: u128,
    creator_unpaid: u128,
}

#[derive(Clone)]
struct TokenBook {
    token: String,
    expected: u128,
    owed: u128,
    balance: u128,
}

#[derive(Clone)]
struct Rec {
    pools: Vec<Pool>,
    global_q: u128,
    platform_unpaid: u128,
    owed_usdc: u128,
    usdc_expected: u128,
    usdc_balance: u128,
    tokens: Vec<TokenBook>,
}

fn check(r: &Rec) -> Vec<&'static str> {
    let mut bad = vec![];
    let (q, creator): (u128, u128) = (r.pools.iter().map(|p| p.q).sum(), r.pools.iter().map(|p| p.creator_unpaid).sum());
    if q != r.global_q {
        bad.push("global_q");
    }
    let usdc_re = q + creator + r.platform_unpaid + r.owed_usdc;
    if usdc_re != r.usdc_expected {
        bad.push("usdc_identity");
    }
    if r.usdc_balance < r.usdc_expected {
        bad.push("usdc_custody");
    }
    let wrong_id = |b: &&TokenBook| b.expected != b.owed + r.pools.iter().filter(|p| p.token == b.token).map(|p| p.t).sum::<u128>();
    if r.tokens.iter().any(|b| wrong_id(&b)) {
        bad.push("token_identity");
    }
    if r.tokens.iter().any(|b| b.balance < b.expected) {
        bad.push("token_custody");
    }
    bad
}

fn mutate(r: &Rec, field: &str) -> Rec {
    let mut t = r.clone();
    match field {
        "pool_q" => t.pools.iter_mut().take(1).for_each(|p| p.q += 1),
        "pool_t" => t.pools.iter_mut().take(1).for_each(|p| p.t += 1),
        "global_q" => t.global_q += 1,
        "platform_unpaid" => t.platform_unpaid += 1,
        "usdc_expected" => t.usdc_expected += 1,
        "token_expected" => t.tokens.iter_mut().take(1).for_each(|b| b.expected += 1),
        other => unreachable!("tamper field '{other}' is validated before use"),
    }
    t
}

fn pool_ids(rpcs: &[String], market: &str, listed: Option<&String>) -> Vec<u64> {
    if let Some(list) = listed {
        return list.split(',').map(|s| s.trim().parse().unwrap_or_else(|_| usage("--pools is a comma list of launch ids"))).collect();
    }
    let (mut found, mut gap) = (vec![], 0);
    for id in 1..=SCAN_LIMIT {
        if gap >= GAP {
            break;
        }
        if view(rpcs, market, "get_pool", &json!({ "launch_id": id.to_string() })).is_null() {
            gap += 1;
        } else {
            found.push(id);
            gap = 0;
        }
    }
    found
}

fn read_pool(rpcs: &[String], market: &str, id: u64) -> Pool {
    let arg = json!({ "launch_id": id.to_string() });
    let (p, l) = (view(rpcs, market, "get_pool", &arg), view(rpcs, market, "ledger_report", &arg));
    let token = p["token"].as_str().unwrap_or_else(|| infra(&format!("get_pool {id} has no token"))).to_string();
    let (acc, paid) = (dec(&l, "acc_creator", "ledger_report"), dec(&l, "paid_creator", "ledger_report"));
    Pool { token, q: dec(&p, "q", "get_pool"), t: dec(&p, "t", "get_pool"), creator_unpaid: acc.saturating_sub(paid) }
}

fn read_token(rpcs: &[String], market: &str, token: &str) -> TokenBook {
    let s = view(rpcs, market, "solvency_report", &json!({ "token_id": token }));
    let (expected, owed) = (dec(&s, "expected_custody", "solvency_report"), dec(&s, "owed_total", "solvency_report"));
    TokenBook { token: token.to_string(), expected, owed, balance: ft_balance(rpcs, token, market) }
}

fn read(rpcs: &[String], market: &str, listed: Option<&String>) -> Rec {
    let cfg = view(rpcs, market, "get_config", &json!({}));
    let usdc = cfg["usdc"].as_str().unwrap_or_else(|| infra("get_config has no usdc")).to_string();
    let ids = pool_ids(rpcs, market, listed);
    let Some(first) = ids.first() else {
        println!("PENDING {market} has no pool yet, so there is no platform_unpaid reading and nothing to recompute");
        std::process::exit(EXIT_PENDING);
    };
    let pools: Vec<Pool> = ids.iter().map(|id| read_pool(rpcs, market, *id)).collect();
    let inv = view(rpcs, market, "get_invariants", &json!({}));
    let ledger = view(rpcs, market, "ledger_report", &json!({ "launch_id": first.to_string() }));
    let mut tokens: Vec<String> = pools.iter().map(|p| p.token.clone()).collect();
    tokens.sort();
    tokens.dedup();
    let usdc_book = read_token(rpcs, market, &usdc);
    Rec {
        global_q: dec(&cfg, "global_q", "get_config"),
        platform_unpaid: dec(&ledger, "platform_unpaid_global", "ledger_report"),
        owed_usdc: usdc_book.owed,
        usdc_expected: dec(&inv, "usdc_expected", "get_invariants"),
        usdc_balance: usdc_book.balance,
        tokens: tokens.iter().map(|t| read_token(rpcs, market, t)).collect(),
        pools,
    }
}

/// The market account: `--market` directly, or `--core` and the `market` field of its `get_config`.
fn market_account(f: &Flags, rpcs: &[String]) -> Option<String> {
    if let Some(m) = f.get("market") {
        return Some(m.clone());
    }
    let core = required(f, "core");
    let cfg: Value = view(rpcs, &core, "get_config", &json!({}));
    cfg["market"].as_str().map(str::to_string)
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let rpcs = rpcs_of(&f);
    let (one, all) = tamper_request(&f, &TAMPER_FIELDS);
    let Some(market) = market_account(&f, &rpcs) else {
        println!("PENDING the core has no market set, so there is no market identity to recompute");
        std::process::exit(EXIT_PENDING)
    };
    let r = read(&rpcs, &market, f.get("pools"));
    println!(
        "C34 market {market}: pools={} sum_q={} global_q={} platform_unpaid={} owed_usdc={} usdc_expected={} usdc_balance={}",
        r.pools.len(),
        r.pools.iter().map(|p| p.q).sum::<u128>(),
        r.global_q,
        r.platform_unpaid,
        r.owed_usdc,
        r.usdc_expected,
        r.usdc_balance
    );
    conclude(&format!("C34 {market}"), &r, &APPLICABLE, check, (TAMPER_FIELDS.to_vec(), one, all), mutate)
}
