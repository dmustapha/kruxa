//! `verify-instant`, `verify-ledger` (C33) and `verify-market` (C34) against a localhost JSON-RPC stub (no network).
//! Same exit-code contract as `exit_codes.rs`: 0 MATCH, 2 only a MISMATCH, 3 pending, 4 infrastructure, 64 usage, 1 undetected tamper.
use kruxa_logic::{hex, inputs_hash, VerdictInputs};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::thread;

type Views = HashMap<String, Value>;

fn read_request(s: &mut std::net::TcpStream) -> Option<Value> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = s.read(&mut chunk).ok()?;
        buf.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&buf).to_string();
        if let Some(split) = text.find("\r\n\r\n") {
            let len =
                text[..split].to_lowercase().split("content-length:").nth(1)?.trim().split("\r\n").next()?.trim().parse::<usize>().ok()?;
            if buf.len() >= split + 4 + len {
                return serde_json::from_slice(&buf[split + 4..split + 4 + len]).ok();
            }
        }
        if n == 0 {
            return None;
        }
    }
}

/// Answers `<account>.<method>` from the map, or `<account>.<method>.<launch_id>` when that key exists; anything else is a view panic.
fn stub(views: Views) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    thread::spawn(move || {
        for mut s in l.incoming().flatten() {
            let body = read_request(&mut s).map_or(String::new(), |req| answer(&views, &req));
            let _ = write!(
                s,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    url
}

fn answer(views: &Views, req: &Value) -> String {
    use base64::Engine;
    let p = &req["params"];
    let (acct, method) = (p["account_id"].as_str().unwrap_or(""), p["method_name"].as_str().unwrap_or(""));
    let args: Value = base64::engine::general_purpose::STANDARD
        .decode(p["args_base64"].as_str().unwrap_or(""))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let id = args["launch_id"].as_str().unwrap_or("");
    let token = args["token_id"].as_str().unwrap_or(args["account_id"].as_str().unwrap_or(""));
    let keys = [format!("{acct}.{method}.{id}"), format!("{acct}.{method}.{token}"), format!("{acct}.{method}")];
    match keys.iter().find_map(|k| views.get(k)) {
        Some(v) => {
            json!({ "jsonrpc": "2.0", "id": "kruxa", "result": { "result": v.to_string().bytes().collect::<Vec<u8>>(), "logs": [] } })
                .to_string()
        }
        None => json!({ "jsonrpc": "2.0", "id": "kruxa", "result": { "error": "wasm execution failed", "logs": [] } }).to_string(),
    }
}

fn sim(args: &[&str]) -> (i32, String) {
    let o = Command::new(env!("CARGO_BIN_EXE_kruxa-sim")).args(args).output().unwrap();
    (o.status.code().unwrap(), String::from_utf8_lossy(&o.stdout).to_string())
}

fn dead_rpc() -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    drop(l);
    url
}

fn put(v: &mut Views, key: &str, val: Value) {
    v.insert(key.to_string(), val);
}

// ---------- instant ----------

fn instant_views() -> Views {
    let mut v = Views::new();
    put(
        &mut v,
        "l.get_instant",
        json!({ "token": "t", "status": "Open", "total_supply": "1000", "creator_alloc_bps": 500, "n_alloc": "50", "n_pool": "950",
        "alloc_claimed": "10", "tokens_sent": "950", "tokens_inflight": "0", "tokens_unsent": "0", "seed_due": "0", "fee_held": "0" }),
    );
    put(&mut v, "l.get_invariants", json!({ "owed_usdc": "0", "token_custody": "40", "usdc_expected": "7" }));
    put(&mut v, "l.get_config", json!({ "usdc": "u", "platform_unpaid": "0" }));
    put(&mut v, "l.get_vesting", json!({ "claimed": "10", "unlocked": "20", "total": "50" }));
    put(&mut v, "t.ft_balance_of", json!("40"));
    put(&mut v, "u.ft_balance_of", json!("7"));
    v
}

fn instant(views: Views, extra: &[&str]) -> (i32, String) {
    let url = stub(views);
    let mut a = vec!["verify-instant", "--rpc", &url, "--launcher", "l", "--launch", "1"];
    a.extend_from_slice(extra);
    sim(&a)
}

#[test]
fn instant_consistent_launch_matches() {
    let (code, out) = instant(instant_views(), &[]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("MATCH instant 1") && !out.contains("MISMATCH"));
}

#[test]
fn instant_supply_leak_is_a_named_mismatch() {
    let mut v = instant_views();
    v.get_mut("l.get_instant").unwrap()["n_pool"] = json!("951");
    let (code, out) = instant(v, &[]);
    assert_eq!(code, 2);
    assert!(out.contains("MISMATCH IL1_supply"), "{out}");
}

#[test]
fn instant_custody_below_expected_is_a_mismatch() {
    let mut v = instant_views();
    put(&mut v, "t.ft_balance_of", json!("39"));
    let (code, out) = instant(v, &[]);
    assert_eq!((code, out.contains("MISMATCH custody_token")), (2, true), "{out}");
}

#[test]
fn instant_tamper_all_exits_2_with_a_line_per_field() {
    let (code, out) = instant(instant_views(), &["--tamper-all"]);
    assert_eq!(code, 2, "{out}");
    for f in [
        "total_supply",
        "n_alloc",
        "n_pool",
        "alloc_claimed",
        "tokens_sent",
        "tokens_inflight",
        "tokens_unsent",
        "token_expected",
        "usdc_expected",
    ] {
        assert!(out.contains(&format!("MISMATCH {f}")), "{f}: {out}");
    }
    assert!(!out.contains("TAMPER NOT DETECTED"));
}

#[test]
fn instant_dead_rpc_exits_4_and_never_prints_mismatch() {
    let (code, out) = sim(&["verify-instant", "--rpc", &dead_rpc(), "--launcher", "l", "--launch", "1", "--tamper-all"]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false));
}

// ---------- C33 ledger ----------

fn core_views() -> Views {
    let mut v = Views::new();
    put(&mut v, "c.get_state", json!({ "status": "Passed", "holder_count": 2 }));
    put(
        &mut v,
        "c.get_ledger",
        json!({ "credited": "300", "open_native": "0", "open_intents": "0", "due_native": "50", "due_intents": "0",
        "inflight_native": "0", "inflight_intents": "0", "refunded": "0", "spent_native": "250", "spent_intents": "0", "consolidated": "0",
        "excess_pool": "50", "launch_fee_due": "10", "launch_fee_paid": "0", "lp_seed_due": "100", "lp_seed_inflight": "0", "lp_seed_sent": "0",
        "stream_total": "90", "stream_drawn": "0", "relay_fee_total": "0" }),
    );
    let pos = |d: &str, s: &str| {
        json!({ "contributed": "150", "open_native": "0", "open_intents": "0", "due_native": d, "due_intents": "0",
        "inflight": "0", "refunded": "0", "spent": s, "tokens_entitled": "5", "bonus_entitled": "0", "claimed": "0" })
    };
    put(&mut v, "c.list_positions", json!([pos("25", "125"), pos("25", "125")]));
    put(
        &mut v,
        "c.solvency_report",
        json!({ "held_native": "9", "held_intents": "4", "recomputed_native": "9", "recomputed_intents": "4" }),
    );
    let i = VerdictInputs {
        launch_id: 1,
        charter_hash: [0; 32],
        total_active: 300,
        active_funders: 2,
        soft_cap: 100,
        min_funders: 1,
        cancelled: false,
    };
    put(&mut v, "c.get_verdict_inputs", json!({ "inputs": serde_json::to_value(i).unwrap() }));
    put(
        &mut v,
        "c.get_settlement",
        json!({ "total_active": "300", "accepted": "200", "launch_fee": "10", "lp_quote": "100", "stream": "90",
        "excess_pool": "100", "inputs_hash": hex(&inputs_hash(&i)) }),
    );
    v
}

fn ledger(views: Views, extra: &[&str]) -> (i32, String) {
    let url = stub(views);
    let mut a = vec!["verify-ledger", "--rpc", &url, "--contract", "c", "--launch", "1"];
    a.extend_from_slice(extra);
    sim(&a)
}

#[test]
fn ledger_consistent_launch_matches_and_tamper_all_is_detected() {
    let (code, out) = ledger(core_views(), &[]);
    assert_eq!(code, 0, "{out}");
    let (code, out) = ledger(core_views(), &["--tamper-all"]);
    assert_eq!(code, 2, "{out}");
    assert!(!out.contains("TAMPER NOT DETECTED") && out.contains("MISMATCH lp_seed_sent"), "{out}");
}

#[test]
fn ledger_flow_break_is_a_named_mismatch() {
    let mut v = core_views();
    v.get_mut("c.get_ledger").unwrap()["credited"] = json!("301");
    let (code, out) = ledger(v, &[]);
    assert_eq!(code, 2);
    assert!(out.contains("MISMATCH L1_flow"), "{out}");
}

#[test]
fn ledger_counters_that_disagree_are_a_mismatch() {
    let mut v = core_views();
    v.get_mut("c.solvency_report").unwrap()["held_native"] = json!("10");
    let (code, out) = ledger(v, &[]);
    assert_eq!((code, out.contains("MISMATCH L6_counters")), (2, true), "{out}");
}

#[test]
fn ledger_a_view_without_its_fields_is_infrastructure() {
    let mut v = core_views();
    v.remove("c.get_ledger");
    let (code, out) = ledger(v, &[]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false));
}

/// A Dissolved FAIL launch: every refund paid, every position record deleted (dissolve requires it), no settlement.
fn dissolved_views() -> Views {
    let mut v = core_views();
    put(&mut v, "c.get_state", json!({ "status": "Dissolved", "holder_count": 2 }));
    put(
        &mut v,
        "c.get_ledger",
        json!({ "credited": "300", "open_native": "0", "open_intents": "0", "due_native": "0", "due_intents": "0",
        "inflight_native": "0", "inflight_intents": "0", "refunded": "300", "spent_native": "0", "spent_intents": "0", "consolidated": "0",
        "excess_pool": "0", "launch_fee_due": "0", "launch_fee_paid": "0", "lp_seed_due": "0", "lp_seed_inflight": "0", "lp_seed_sent": "0",
        "stream_total": "0", "stream_drawn": "0", "relay_fee_total": "0" }),
    );
    put(&mut v, "c.list_positions", json!([]));
    put(&mut v, "c.get_settlement", json!(null));
    v
}

#[test]
fn ledger_dissolved_launch_with_no_positions_matches_and_skips_the_position_checks() {
    let (code, out) = ledger(dissolved_views(), &[]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("SKIP L3_positions, I2_book_sums") && !out.contains("infrastructure"), "{out}");
    let (code, out) = ledger(dissolved_views(), &["--tamper-all"]);
    assert_eq!(code, 2, "{out}");
    assert!(!out.contains("TAMPER NOT DETECTED") && out.contains("MISMATCH refunded"), "{out}");
}

#[test]
fn ledger_missing_positions_are_infrastructure_unless_the_launch_is_dissolved_and_empty() {
    let mut v = core_views();
    put(&mut v, "c.list_positions", json!([]));
    let (code, out) = ledger(v, &[]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false), "{out}");
    let mut v = dissolved_views();
    let one = json!({ "contributed": "150", "open_native": "0", "open_intents": "0", "due_native": "0", "due_intents": "0",
        "inflight": "0", "refunded": "150", "spent": "0", "tokens_entitled": "0", "bonus_entitled": "0", "claimed": "0" });
    put(&mut v, "c.list_positions", json!([one]));
    let (code, out) = ledger(v, &[]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false), "{out}");
}

#[test]
fn ledger_unknown_tamper_field_is_usage() {
    assert_eq!(ledger(core_views(), &["--tamper", "nope"]).0, 64);
}

// ---------- C34 market ----------

fn market_views() -> Views {
    let mut v = Views::new();
    put(&mut v, "m.get_config", json!({ "usdc": "u", "global_q": "300" }));
    put(&mut v, "m.get_pool.1", json!({ "token": "t", "q": "200", "t": "700" }));
    put(&mut v, "m.get_pool.2", json!({ "token": "t", "q": "100", "t": "300" }));
    put(&mut v, "m.ledger_report", json!({ "acc_creator": "30", "paid_creator": "10", "platform_unpaid_global": "15" }));
    put(&mut v, "m.get_invariants", json!({ "usdc_expected": "395" }));
    put(&mut v, "m.solvency_report.u", json!({ "expected_custody": "395", "owed_total": "5" }));
    put(&mut v, "m.solvency_report.t", json!({ "expected_custody": "1000", "owed_total": "0" }));
    put(&mut v, "u.ft_balance_of", json!("395"));
    put(&mut v, "t.ft_balance_of", json!("1000"));
    v
}

fn market(views: Views, extra: &[&str]) -> (i32, String) {
    let url = stub(views);
    let mut a = vec!["verify-market", "--rpc", &url, "--market", "m", "--pools", "1,2"];
    a.extend_from_slice(extra);
    sim(&a)
}

#[test]
fn market_identity_holds_when_the_numbers_add_up() {
    // sum q 300 + creator unpaid 40 (the stub gives both pools the same ledger row, 30 - 10 each) + platform 15 + owed 5 = 360.
    let mut v = market_views();
    put(&mut v, "m.get_invariants", json!({ "usdc_expected": "360" }));
    put(&mut v, "m.solvency_report.u", json!({ "expected_custody": "360", "owed_total": "5" }));
    put(&mut v, "u.ft_balance_of", json!("360"));
    let (code, out) = market(v, &[]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("MATCH C34 m"));
}

#[test]
fn market_custody_below_expected_is_a_mismatch() {
    let mut v = market_views();
    put(&mut v, "m.get_invariants", json!({ "usdc_expected": "360" }));
    put(&mut v, "m.solvency_report.u", json!({ "expected_custody": "360", "owed_total": "5" }));
    put(&mut v, "u.ft_balance_of", json!("359"));
    let (code, out) = market(v, &[]);
    assert_eq!((code, out.contains("MISMATCH usdc_custody")), (2, true), "{out}");
}

#[test]
fn market_pool_view_failure_is_infrastructure() {
    let url = stub(market_views());
    let (code, out) = sim(&["verify-market", "--rpc", &url, "--market", "m", "--pools", "9"]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false), "{out}");
}

#[test]
fn market_tamper_all_exits_2_with_a_line_per_field() {
    let mut v = market_views();
    put(&mut v, "m.get_invariants", json!({ "usdc_expected": "360" }));
    put(&mut v, "m.solvency_report.u", json!({ "expected_custody": "360", "owed_total": "5" }));
    put(&mut v, "u.ft_balance_of", json!("360"));
    let (code, out) = market(v, &["--tamper-all"]);
    assert_eq!(code, 2, "{out}");
    for f in ["pool_q", "pool_t", "global_q", "platform_unpaid", "usdc_expected", "token_expected"] {
        assert!(out.contains(&format!("MISMATCH {f}")), "{f}: {out}");
    }
}
