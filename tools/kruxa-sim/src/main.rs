//! kruxa-sim: recompute Kruxa results with the SAME pure code the contract runs.
//!   kruxa-sim verdict --launch-id 1 --total-active 360000000 --funders 12 --soft-cap 350000000 --min-funders 10 [--cancelled] [--charter-hash <64 hex>]
//!   kruxa-sim verify --rpc https://rpc.testnet.near.org --contract core.kruxa.testnet --launch 1 [--tamper]
//!   kruxa-sim settle --total-active 1400000000 --hard-cap 1000000000 --commit 100000000
use kruxa_logic::{allocate, hex, inputs_hash, settle_position, verdict, Outcome, Rules, VerdictInputs};
use serde_json::{json, Value};
use std::collections::HashMap;

fn flags(args: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(k) = args[i].strip_prefix("--") {
            let takes_value = args.get(i + 1).is_some_and(|v| !v.starts_with("--"));
            m.insert(k.to_string(), if takes_value { args[i + 1].clone() } else { "true".into() });
            i += if takes_value { 2 } else { 1 };
        } else {
            i += 1;
        }
    }
    m
}

fn num<T: std::str::FromStr>(f: &HashMap<String, String>, k: &str) -> T {
    f.get(k).and_then(|v| v.parse().ok()).unwrap_or_else(|| die(&format!("--{k} is required and must be a number")))
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(2)
}

fn parse_hash(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    if s.len() != 64 || (0..32).any(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map(|b| out[i] = b).is_err()) {
        die("charter hash must be 64 hex chars");
    }
    out
}

fn describe(i: &VerdictInputs) -> (String, String) {
    let out = match verdict(i) {
        Outcome::Pass => "PASS".to_string(),
        Outcome::Fail(r) => format!("FAIL(reasons={r})"),
    };
    (out, hex(&inputs_hash(i)))
}

fn view(rpc: &str, contract: &str, method: &str, args: Value) -> Value {
    let body = json!({ "jsonrpc": "2.0", "id": "kruxa", "method": "query", "params": { "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method, "args_base64": base64_encode(args.to_string().as_bytes()) } });
    let resp: Value = ureq::post(rpc)
        .send_json(body)
        .unwrap_or_else(|e| die(&format!("rpc: {e}")))
        .into_json()
        .unwrap_or_else(|e| die(&format!("rpc json: {e}")));
    let bytes: Vec<u8> = resp["result"]["result"]
        .as_array()
        .unwrap_or_else(|| die(&format!("view {method} failed: {resp}")))
        .iter()
        .map(|b| b.as_u64().unwrap_or(0) as u8)
        .collect();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let f = flags(&args);
    match args.first().map(String::as_str) {
        Some("verdict") => {
            let i = VerdictInputs {
                launch_id: num(&f, "launch-id"),
                charter_hash: f.get("charter-hash").map_or([0; 32], |h| parse_hash(h)),
                total_active: num(&f, "total-active"),
                active_funders: num(&f, "funders"),
                soft_cap: num(&f, "soft-cap"),
                min_funders: num(&f, "min-funders"),
                cancelled: f.contains_key("cancelled"),
            };
            let (out, h) = describe(&i);
            println!("outcome={out}\ninputs_hash={h}");
        }
        Some("settle") => {
            let (total, hard, commit): (u128, u128, u128) = (num(&f, "total-active"), num(&f, "hard-cap"), num(&f, "commit"));
            let r = Rules { max_hard_cap: hard.max(Rules::ladder().max_hard_cap), ..Rules::ladder() };
            let a = allocate(total, hard, 6_000, 2_500, &r).unwrap_or_else(|e| die(&format!("{e:?}")));
            let p = settle_position(commit, total, a.accepted, 600_000_000_000_000, 50_000_000_000_000)
                .unwrap_or_else(|e| die(&format!("{e:?}")));
            println!(
                "accepted={} launch_fee={} lp_quote={} stream={} excess_pool={}\nspend={} refund={} tokens={} bonus={}",
                a.accepted, a.launch_fee, a.lp_quote, a.stream, a.excess_pool, p.spend, p.refund, p.tokens, p.bonus
            );
        }
        Some("verify") => {
            let (rpc, contract, launch) = (
                f.get("rpc").cloned().unwrap_or_else(|| die("--rpc")),
                f.get("contract").cloned().unwrap_or_else(|| die("--contract")),
                f.get("launch").cloned().unwrap_or_else(|| die("--launch")),
            );
            let vi = view(&rpc, &contract, "get_verdict_inputs", json!({ "launch_id": launch }));
            let st = view(&rpc, &contract, "get_settlement", json!({ "launch_id": launch }));
            let mut i: VerdictInputs = serde_json::from_value(vi["inputs"].clone()).unwrap_or_else(|e| die(&format!("inputs: {e}")));
            if f.contains_key("tamper") {
                i.total_active += 1;
            }
            let (out, h) = describe(&i);
            let stored_pass = st["pass"].as_bool();
            let stored_hash = st["inputs_hash"].as_str().unwrap_or("");
            let ok = stored_pass == Some(out == "PASS") && stored_hash == h;
            println!(
                "recomputed outcome={out} inputs_hash={h}\nstored     pass={stored_pass:?} inputs_hash={stored_hash}\n{}",
                if ok { "MATCH" } else { "MISMATCH" }
            );
            std::process::exit(if ok { 0 } else { 1 });
        }
        _ => die("usage: kruxa-sim verdict|settle|verify (see the file header)"),
    }
}
