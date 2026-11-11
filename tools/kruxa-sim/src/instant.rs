//! `kruxa-sim verify-instant`: recheck one launch on the instant launcher from read-only views (FG-03, CO-7 acceptance 2).
//! IL-1 supply conservation, the token buckets, custody against the REAL `ft_balance_of`, and the vesting bounds (IL-5).
//! The launcher's own `get_invariants` booleans are not read; only its raw numbers are, and each identity is recomputed here.
//! Not recomputable from public views: the launcher's global `seed_due_total` and `owed_total` (it exposes the sums, not the parts),
//! so those enter custody as a lower bound.
use crate::cli::*;
use crate::recompute::*;
use crate::verify::view;
use kruxa_math::mul_div_floor;
use serde_json::json;

pub const TAMPER_FIELDS: [&str; 9] = [
    "total_supply",
    "n_alloc",
    "n_pool",
    "alloc_claimed",
    "tokens_sent",
    "tokens_inflight",
    "tokens_unsent",
    "token_expected",
    "usdc_expected",
];
const APPLICABLE: [&str; 7] =
    ["IL1_supply", "IL1_alloc_split", "bucket_pool", "bucket_claimed", "vest_bounds", "custody_token", "custody_usdc"];
const BPS: u128 = 10_000;
pub const SPEC: Spec = Spec { values: &["rpc", "rpc2", "launcher", "launch"], optional_values: &["tamper"], switches: &["tamper-all"] };

/// The recorded inputs: every number is read once from a view or a token, then only recomputed.
#[derive(Clone)]
struct Rec {
    created: bool,
    total_supply: u128,
    alloc_bps: u128,
    n_alloc: u128,
    n_pool: u128,
    claimed: u128,
    vest_claimed: u128,
    vest_unlocked: u128,
    vest_total: u128,
    tokens_sent: u128,
    tokens_inflight: u128,
    tokens_unsent: u128,
    seed_due: u128,
    fee_held: u128,
    platform_unpaid: u128,
    owed_usdc: u128,
    token_expected: u128,
    usdc_expected: u128,
    token_balance: u128,
    usdc_balance: u128,
}

fn check(r: &Rec) -> Vec<&'static str> {
    let mut bad = vec![];
    let split = mul_div_floor(r.total_supply, r.alloc_bps, BPS).ok();
    if r.n_alloc.checked_add(r.n_pool) != Some(r.total_supply) {
        bad.push("IL1_supply");
    }
    if split != Some(r.n_alloc) {
        bad.push("IL1_alloc_split");
    }
    let out = r.tokens_sent.saturating_add(r.tokens_inflight);
    if out > r.n_pool || r.tokens_unsent != r.n_pool - out {
        bad.push("bucket_pool");
    }
    if r.claimed > r.n_alloc || r.claimed != r.vest_claimed {
        bad.push("bucket_claimed");
    }
    if r.vest_total != r.n_alloc || r.claimed > r.vest_unlocked || r.vest_unlocked > r.vest_total {
        bad.push("vest_bounds");
    }
    let held = r.n_alloc.saturating_sub(r.claimed).saturating_add(r.tokens_unsent);
    if r.created && (r.token_expected < held || r.token_balance < r.token_expected) {
        bad.push("custody_token");
    }
    let usdc_floor = r.seed_due.saturating_add(r.fee_held).saturating_add(r.platform_unpaid).saturating_add(r.owed_usdc);
    if r.usdc_expected < usdc_floor || r.usdc_balance < r.usdc_expected {
        bad.push("custody_usdc");
    }
    bad
}

/// One unit flipped in one recorded input. The result must fail `check`.
fn mutate(r: &Rec, field: &str) -> Rec {
    let mut t = r.clone();
    match field {
        "total_supply" => t.total_supply += 1,
        "n_alloc" => t.n_alloc += 1,
        "n_pool" => t.n_pool += 1,
        "alloc_claimed" => t.claimed += 1,
        "tokens_sent" => t.tokens_sent += 1,
        "tokens_inflight" => t.tokens_inflight += 1,
        "tokens_unsent" => t.tokens_unsent += 1,
        "token_expected" => t.token_expected += 1,
        "usdc_expected" => t.usdc_expected += 1,
        other => unreachable!("tamper field '{other}' is validated before use"),
    }
    t
}

fn read(rpcs: &[String], launcher: &str, launch: &str) -> Rec {
    let id = json!({ "launch_id": launch });
    let i = view(rpcs, launcher, "get_instant", &id);
    if i.is_null() {
        infra(&format!("{launcher} has no instant launch {launch}"));
    }
    let g = |k: &str| dec(&i, k, "get_instant");
    let (token, status) = (i["token"].as_str().unwrap_or("").to_string(), i["status"].as_str().unwrap_or("").to_string());
    let created = !matches!(status.as_str(), "Creating" | "CreationFailed");
    let (inv, cfg, vest) = (
        view(rpcs, launcher, "get_invariants", &id),
        view(rpcs, launcher, "get_config", &json!({})),
        view(rpcs, launcher, "get_vesting", &id),
    );
    let usdc = cfg["usdc"].as_str().unwrap_or_else(|| infra("get_config has no usdc")).to_string();
    println!("instant launch {launch} on {launcher}: status={status} token={token}");
    Rec {
        created,
        total_supply: g("total_supply"),
        alloc_bps: dec(&i, "creator_alloc_bps", "get_instant"),
        n_alloc: g("n_alloc"),
        n_pool: g("n_pool"),
        claimed: g("alloc_claimed"),
        vest_claimed: dec(&vest, "claimed", "get_vesting"),
        vest_unlocked: dec(&vest, "unlocked", "get_vesting"),
        vest_total: dec(&vest, "total", "get_vesting"),
        tokens_sent: g("tokens_sent"),
        tokens_inflight: g("tokens_inflight"),
        tokens_unsent: g("tokens_unsent"),
        seed_due: g("seed_due"),
        fee_held: g("fee_held"),
        platform_unpaid: dec(&cfg, "platform_unpaid", "get_config"),
        owed_usdc: dec(&inv, "owed_usdc", "get_invariants"),
        token_expected: if created { dec(&inv, "token_custody", "get_invariants") } else { 0 },
        usdc_expected: dec(&inv, "usdc_expected", "get_invariants"),
        token_balance: if created { ft_balance(rpcs, &token, launcher) } else { 0 },
        usdc_balance: ft_balance(rpcs, &usdc, launcher),
    }
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let (rpcs, launcher, launch) = (rpcs_of(&f), required(&f, "launcher"), required(&f, "launch"));
    let (one, all) = tamper_request(&f, &TAMPER_FIELDS);
    let r = read(&rpcs, &launcher, &launch);
    println!(
        "IL-1 total_supply={} n_alloc={} n_pool={}; recomputed n_alloc={} (floor({} * {} / 10000))",
        r.total_supply,
        r.n_alloc,
        r.n_pool,
        mul_div_floor(r.total_supply, r.alloc_bps, BPS).map_or("overflow".into(), |v| v.to_string()),
        r.total_supply,
        r.alloc_bps
    );
    println!(
        "buckets sent={} inflight={} unsent={} claimed={} unlocked={}; token custody expected={} balance={}; usdc expected={} balance={}",
        r.tokens_sent,
        r.tokens_inflight,
        r.tokens_unsent,
        r.claimed,
        r.vest_unlocked,
        r.token_expected,
        r.token_balance,
        r.usdc_expected,
        r.usdc_balance
    );
    let applicable: Vec<&'static str> = APPLICABLE.to_vec();
    conclude(&format!("instant {launch}"), &r, &applicable, check, (TAMPER_FIELDS.to_vec(), one, all), mutate)
}
