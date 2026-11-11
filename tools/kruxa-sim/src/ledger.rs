//! `kruxa-sim verify-ledger`: check C33, the core ledger identities of one launch, recomputed from raw state (FG-04).
//! Reads `get_ledger`, `list_positions`, `get_settlement`, `get_verdict_inputs` and the solvency counters, then recomputes here:
//! L1 flow, L3 per position, I2 positions sum to the ledger, L4 settlement buckets, I3 inputs frozen, I5 no overpay, L6 counters.
//! `get_invariants` and its `*_ok` booleans are NOT read. Not recomputable from public views (so not claimed): L7 lock mirror,
//! I4 status monotone, and the I5 terms for LP tokens, relay fees and token claims (the ledger view omits them).
use crate::cli::*;
use crate::recompute::*;
use crate::verify::view;
use kruxa_logic::{hex, inputs_hash, VerdictInputs};
use serde_json::{json, Value};

pub const TAMPER_FIELDS: [&str; 13] = [
    "credited",
    "open_native",
    "due_native",
    "spent_native",
    "refunded",
    "position_contributed",
    "held_native",
    "held_intents",
    "launch_fee_due",
    "stream_total",
    "excess_pool",
    "lp_seed_sent",
    "inputs_total_active",
];
pub const SPEC: Spec = Spec { values: &["rpc", "rpc2", "contract", "launch"], optional_values: &["tamper"], switches: &["tamper-all"] };
const PAGE: u32 = 50;

#[derive(Clone, Default)]
struct Led {
    credited: u128,
    open: [u128; 2],
    due: [u128; 2],
    inflight: [u128; 2],
    refunded: u128,
    spent: [u128; 2],
    excess_pool: u128,
    launch_fee_due: u128,
    launch_fee_paid: u128,
    lp_due: u128,
    lp_inflight: u128,
    lp_sent: u128,
    stream_total: u128,
    stream_drawn: u128,
}

#[derive(Clone, Default)]
struct Pos {
    contributed: u128,
    open: u128,
    due: u128,
    inflight: u128,
    refunded: u128,
    spent: u128,
    claimed: u128,
    entitled: u128,
}

#[derive(Clone)]
struct Settle {
    total_active: u128,
    accepted: u128,
    inputs_hash: String,
    launch_fee: u128,
    lp_quote: u128,
    stream: u128,
    excess_pool: u128,
}

#[derive(Clone)]
struct Rec {
    passed: bool,
    /// A Dissolved launch has deleted every position record (that is what dissolve requires), so the per-position checks do not apply.
    dissolved: bool,
    led: Led,
    positions: Vec<Pos>,
    settle: Option<Settle>,
    inputs_total_active: u128,
    inputs_hash: String,
    held: [u128; 2],
    recomputed: [u128; 2],
}

fn sum(r: &Rec, f: fn(&Pos) -> u128) -> u128 {
    r.positions.iter().map(f).sum()
}

fn check(r: &Rec) -> Vec<&'static str> {
    let (l, mut bad) = (&r.led, vec![]);
    let (open, due, inflight, spent) = (l.open[0] + l.open[1], l.due[0] + l.due[1], l.inflight[0] + l.inflight[1], l.spent[0] + l.spent[1]);
    if l.credited != open + due + inflight + l.refunded + spent {
        bad.push("L1_flow");
    }
    if r.positions.iter().any(|p| p.contributed != p.open + p.due + p.inflight + p.refunded + p.spent) {
        bad.push("L3_positions");
    }
    if !r.dissolved
        && (sum(r, |p| p.open) != open
            || sum(r, |p| p.contributed) != l.credited
            || sum(r, |p| p.refunded) != l.refunded
            || sum(r, |p| p.spent) != spent)
    {
        bad.push("I2_book_sums");
    }
    let lp = l.lp_due + l.lp_inflight + l.lp_sent;
    if r.passed && (l.launch_fee_due + lp + l.stream_total + l.excess_pool != open + spent) {
        bad.push("L4_buckets");
    }
    if let Some(s) = &r.settle {
        // The settlement is frozen; the ledger's excess_pool is drawn down by each refund, so it may only be at or below it.
        let frozen_split = s.launch_fee + s.lp_quote + s.stream == s.accepted && s.accepted + s.excess_pool == s.total_active;
        // sweep_residue moves what is left of the excess pool to the LP bucket, so the ledger LP bucket may exceed the frozen lp_quote by at most
        // the amount the excess pool has been drawn down by (refunds plus that sweep).
        let lp_swept = lp.checked_sub(s.lp_quote).filter(|d| l.excess_pool <= s.excess_pool && *d <= s.excess_pool - l.excess_pool);
        let ledger_agrees = (s.launch_fee, s.stream) == (l.launch_fee_due, l.stream_total) && lp_swept.is_some();
        if r.passed && !(frozen_split && ledger_agrees) {
            bad.push("L4_settlement");
        }
        if s.total_active != r.inputs_total_active || s.inputs_hash != r.inputs_hash {
            bad.push("I3_inputs_frozen");
        }
    }
    let position_overpay = r.positions.iter().any(|p| p.refunded + p.inflight + p.due > p.contributed || p.claimed > p.entitled);
    if l.launch_fee_paid > l.launch_fee_due || l.stream_drawn > l.stream_total || position_overpay {
        bad.push("I5_no_overpay");
    }
    if r.held != r.recomputed {
        bad.push("L6_counters");
    }
    bad
}

fn mutate(r: &Rec, field: &str) -> Rec {
    let mut t = r.clone();
    match field {
        "credited" => t.led.credited += 1,
        "open_native" => t.led.open[0] += 1,
        "due_native" => t.led.due[0] += 1,
        "spent_native" => t.led.spent[0] += 1,
        "refunded" => t.led.refunded += 1,
        "position_contributed" => t.positions.iter_mut().take(1).for_each(|p| p.contributed += 1),
        "held_native" => t.held[0] += 1,
        "held_intents" => t.held[1] += 1,
        "launch_fee_due" => t.led.launch_fee_due += 1,
        "stream_total" => t.led.stream_total += 1,
        "excess_pool" => t.settle.iter_mut().for_each(|s| s.excess_pool += 1),
        "lp_seed_sent" => t.led.lp_sent += 1,
        "inputs_total_active" => t.inputs_total_active += 1,
        other => unreachable!("tamper field '{other}' is validated before use"),
    }
    t
}

fn read_ledger(v: &Value) -> Led {
    let g = |k: &str| dec(v, k, "get_ledger");
    Led {
        credited: g("credited"),
        open: [g("open_native"), g("open_intents")],
        due: [g("due_native"), g("due_intents")],
        inflight: [g("inflight_native"), g("inflight_intents")],
        refunded: g("refunded"),
        spent: [g("spent_native"), g("spent_intents")],
        excess_pool: g("excess_pool"),
        launch_fee_due: g("launch_fee_due"),
        launch_fee_paid: g("launch_fee_paid"),
        lp_due: g("lp_seed_due"),
        lp_inflight: g("lp_seed_inflight"),
        lp_sent: g("lp_seed_sent"),
        stream_total: g("stream_total"),
        stream_drawn: g("stream_drawn"),
    }
}

fn read_position(v: &Value) -> Pos {
    let g = |k: &str| dec(v, k, "list_positions");
    Pos {
        contributed: g("contributed"),
        open: g("open_native") + g("open_intents"),
        due: g("due_native") + g("due_intents"),
        inflight: g("inflight"),
        refunded: g("refunded"),
        spent: g("spent"),
        claimed: g("claimed"),
        entitled: g("tokens_entitled") + g("bonus_entitled"),
    }
}

fn read_positions(rpcs: &[String], contract: &str, launch: &str, count: u32, dissolved: bool) -> Vec<Pos> {
    let mut out = vec![];
    for from in (0..count).step_by(PAGE as usize) {
        let page = view(rpcs, contract, "list_positions", &json!({ "launch_id": launch, "from_seq": from, "limit": PAGE }));
        let rows = page.as_array().unwrap_or_else(|| infra(&format!("list_positions is not an array: {page}")));
        out.extend(rows.iter().map(read_position));
    }
    if dissolved && out.is_empty() {
        return out;
    }
    if out.len() != count as usize {
        infra(&format!("list_positions returned {} of {count} positions", out.len()));
    }
    out
}

fn read_settle(v: &Value) -> Option<Settle> {
    (!v.is_null()).then(|| {
        let g = |k: &str| dec(v, k, "get_settlement");
        let h = v["inputs_hash"].as_str().unwrap_or_else(|| infra("get_settlement has no inputs_hash")).to_string();
        Settle {
            total_active: g("total_active"),
            accepted: g("accepted"),
            inputs_hash: h,
            launch_fee: g("launch_fee"),
            lp_quote: g("lp_quote"),
            stream: g("stream"),
            excess_pool: g("excess_pool"),
        }
    })
}

fn read(rpcs: &[String], contract: &str, launch: &str) -> Rec {
    let id = json!({ "launch_id": launch });
    let state = view(rpcs, contract, "get_state", &id);
    if state.is_null() {
        infra(&format!("{contract} has no launch {launch}"));
    }
    let count = u32::try_from(dec(&state, "holder_count", "get_state")).unwrap_or_else(|_| infra("holder_count out of range"));
    let led = read_ledger(&view(rpcs, contract, "get_ledger", &id));
    let vi = view(rpcs, contract, "get_verdict_inputs", &id);
    let i: VerdictInputs =
        serde_json::from_value(vi["inputs"].clone()).unwrap_or_else(|e| infra(&format!("get_verdict_inputs inputs: {e}")));
    let sr = view(rpcs, contract, "solvency_report", &json!({}));
    let dissolved = state["status"].as_str() == Some("Dissolved");
    Rec {
        passed: state["status"].as_str() == Some("Passed"),
        dissolved,
        positions: read_positions(rpcs, contract, launch, count, dissolved),
        settle: read_settle(&view(rpcs, contract, "get_settlement", &id)),
        inputs_total_active: i.total_active,
        inputs_hash: hex(&inputs_hash(&i)),
        held: [dec(&sr, "held_native", "solvency_report"), dec(&sr, "held_intents", "solvency_report")],
        recomputed: [dec(&sr, "recomputed_native", "solvency_report"), dec(&sr, "recomputed_intents", "solvency_report")],
        led,
    }
}

/// The checks that apply to this launch; the L4 and I3 identities only exist once there is a settlement.
fn applicable(r: &Rec) -> Vec<&'static str> {
    let mut a = vec!["L1_flow", "L3_positions", "I2_book_sums", "I5_no_overpay", "L6_counters"];
    if r.dissolved {
        a.retain(|c| *c != "L3_positions" && *c != "I2_book_sums");
    }
    if r.passed {
        a.extend(["L4_buckets", "L4_settlement"]);
    }
    if r.settle.is_some() {
        a.push("I3_inputs_frozen");
    }
    a
}

/// Tamper fields whose identity does not apply to this launch (a FAIL launch has no L4) are skipped, not counted as undetected.
fn tamperable(r: &Rec) -> Vec<&'static str> {
    TAMPER_FIELDS
        .iter()
        .copied()
        .filter(|f| match *f {
            "launch_fee_due" | "stream_total" | "excess_pool" | "lp_seed_sent" => r.passed,
            "inputs_total_active" => r.settle.is_some(),
            "position_contributed" => !r.positions.is_empty(),
            _ => true,
        })
        .collect()
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let (rpcs, contract, launch) = (rpcs_of(&f), required(&f, "contract"), required(&f, "launch"));
    let (one, all) = tamper_request(&f, &TAMPER_FIELDS);
    let r = read(&rpcs, &contract, &launch);
    let l = &r.led;
    println!(
        "C33 launch {launch} on {contract}: credited={} open={} due={} inflight={} refunded={} spent={} positions={} held_native={} held_intents={}",
        l.credited,
        l.open[0] + l.open[1],
        l.due[0] + l.due[1],
        l.inflight[0] + l.inflight[1],
        l.refunded,
        l.spent[0] + l.spent[1],
        r.positions.len(),
        r.held[0],
        r.held[1]
    );
    if r.dissolved {
        println!("SKIP L3_positions, I2_book_sums: launch {launch} is Dissolved, so its position records are deleted by design (the ledger identities still run)");
    }
    conclude(&format!("C33 launch {launch}"), &r, &applicable(&r), check, (tamperable(&r), one, all), mutate)
}
