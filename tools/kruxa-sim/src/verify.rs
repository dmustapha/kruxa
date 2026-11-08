//! `kruxa-sim verify`: recompute a settled launch's verdict from its public views and compare it with what the contract stored.
//! Exit codes are the CO-6 E-4 contract in `cli.rs`. A failed view is an error (exit 4), never a Null.
use crate::cli::*;
use kruxa_logic::{hex, inputs_hash, verdict, Outcome, VerdictInputs};
use serde_json::{json, Value};

/// Recorded fields a judge can tamper with. Every one is covered by `inputs_hash`, so every one must be detected.
pub const TAMPER_FIELDS: [&str; 7] =
    ["launch_id", "charter_hash", "total_active", "active_funders", "soft_cap", "min_funders", "cancelled"];

pub const SPEC: Spec = Spec { values: &["rpc", "rpc2", "contract", "launch"], optional_values: &["tamper"], switches: &["tamper-all"] };

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}

/// One view call. Err for transport failure, non-200, a JSON-RPC error, a contract panic, or bytes that are not JSON.
fn rpc_view(rpc: &str, contract: &str, method: &str, args: &Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": "kruxa", "method": "query", "params": { "request_type": "call_function", "finality": "final",
        "account_id": contract, "method_name": method, "args_base64": base64_encode(args.to_string().as_bytes()) } });
    let resp: Value = ureq::post(rpc)
        .send_json(body)
        .map_err(|e| format!("rpc {rpc}: {e}"))?
        .into_json()
        .map_err(|e| format!("rpc {rpc}: response is not JSON: {e}"))?;
    let bytes = resp["result"]["result"].as_array().ok_or_else(|| format!("view {method} failed on {rpc}: {resp}"))?;
    let raw: Vec<u8> = bytes
        .iter()
        .map(|b| b.as_u64().and_then(|n| u8::try_from(n).ok()).ok_or_else(|| format!("view {method}: result byte out of range")))
        .collect::<Result<_, _>>()?;
    serde_json::from_slice(&raw).map_err(|e| format!("view {method}: result is not JSON: {e}"))
}

/// Reads from the primary RPC and, if given, a second one. Disagreement is infrastructure, not a mismatch.
fn view(rpcs: &[String], contract: &str, method: &str, args: &Value) -> Value {
    let answers: Vec<Value> = rpcs.iter().map(|r| rpc_view(r, contract, method, args).unwrap_or_else(|e| infra(&e))).collect();
    if answers.windows(2).any(|w| w[0] != w[1]) {
        infra(&format!("the RPCs disagree on {method}"));
    }
    answers.into_iter().next().unwrap_or_else(|| infra("no rpc"))
}

fn describe(i: &VerdictInputs) -> (String, String) {
    let out = match verdict(i) {
        Outcome::Pass => "PASS".to_string(),
        Outcome::Fail(r) => format!("FAIL(reasons={r})"),
    };
    (out, hex(&inputs_hash(i)))
}

fn tampered(i: &VerdictInputs, field: &str) -> VerdictInputs {
    let mut t = *i;
    match field {
        "launch_id" => t.launch_id += 1,
        "charter_hash" => t.charter_hash[0] ^= 1,
        "total_active" => t.total_active += 1,
        "active_funders" => t.active_funders += 1,
        "soft_cap" => t.soft_cap += 1,
        "min_funders" => t.min_funders += 1,
        "cancelled" => t.cancelled = !t.cancelled,
        other => unreachable!("tamper field '{other}' is validated before use"),
    }
    t
}

struct Stored {
    pass: bool,
    inputs_hash: String,
}

/// Names of the recorded values that differ from the recomputation. Empty means MATCH.
fn mismatched(i: &VerdictInputs, stored: &Stored) -> Vec<&'static str> {
    let (out, h) = describe(i);
    let mut bad = vec![];
    if stored.pass != (out == "PASS") {
        bad.push("pass");
    }
    if stored.inputs_hash != h {
        bad.push("inputs_hash");
    }
    bad
}

fn parse_stored(st: &Value) -> Stored {
    match (st["pass"].as_bool(), st["inputs_hash"].as_str()) {
        (Some(pass), Some(h)) => Stored { pass, inputs_hash: h.to_string() },
        _ => infra(&format!("get_settlement has no pass or inputs_hash: {st}")),
    }
}

fn report_mismatch(fields: &[&str]) -> ! {
    for f in fields {
        println!("MISMATCH {f}");
    }
    std::process::exit(EXIT_MISMATCH)
}

/// Runs one tamper per name. Returns true only if every run is detected; prints one MISMATCH line per detected field.
fn tamper_runs(i: &VerdictInputs, stored: &Stored, names: &[&str]) -> bool {
    let mut all = true;
    for name in names {
        if mismatched(&tampered(i, name), stored).is_empty() {
            println!("TAMPER NOT DETECTED {name}");
            all = false;
        } else {
            println!("MISMATCH {name}");
        }
    }
    all
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let rpcs: Vec<String> = [Some(required(&f, "rpc")), f.get("rpc2").cloned()].into_iter().flatten().collect();
    let (contract, launch) = (required(&f, "contract"), required(&f, "launch"));
    let tamper_one = f.get("tamper").map(|t| if t == "true" { "total_active".to_string() } else { t.clone() });
    if let Some(t) = tamper_one.as_deref().filter(|t| !TAMPER_FIELDS.contains(t)) {
        usage(&format!("unknown tamper field '{t}' (one of {})", TAMPER_FIELDS.join(", ")));
    }
    if tamper_one.is_some() && f.contains_key("tamper-all") {
        usage("--tamper and --tamper-all are exclusive");
    }
    let args_json = json!({ "launch_id": launch });
    let vi = view(&rpcs, &contract, "get_verdict_inputs", &args_json);
    if vi.is_null() {
        infra(&format!("{contract} has no launch {launch}"));
    }
    let i: VerdictInputs =
        serde_json::from_value(vi["inputs"].clone()).unwrap_or_else(|e| infra(&format!("get_verdict_inputs inputs: {e}")));
    let st = view(&rpcs, &contract, "get_settlement", &args_json);
    if st.is_null() {
        println!("PENDING launch {launch} is not settled yet");
        std::process::exit(EXIT_PENDING);
    }
    let stored = parse_stored(&st);
    let (out, h) = describe(&i);
    println!("recomputed outcome={out} inputs_hash={h}\nstored     pass={} inputs_hash={}", stored.pass, stored.inputs_hash);
    let bad = mismatched(&i, &stored);
    if !bad.is_empty() {
        report_mismatch(&bad);
    }
    println!("MATCH");
    finish_tamper(&i, &stored, tamper_one, f.contains_key("tamper-all"))
}

/// After a clean MATCH, optional self-test: tampered copies of the recorded inputs must NOT match. Exit 2 if all are detected.
fn finish_tamper(i: &VerdictInputs, stored: &Stored, one: Option<String>, all: bool) -> ! {
    let names: Vec<&str> = match (&one, all) {
        (Some(n), _) => vec![n.as_str()],
        (None, true) => TAMPER_FIELDS.to_vec(),
        (None, false) => std::process::exit(EXIT_MATCH),
    };
    let detected = tamper_runs(i, stored, &names);
    std::process::exit(if detected { EXIT_MISMATCH } else { EXIT_SELF_TEST })
}
