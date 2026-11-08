//! CO-6 E-4: the exit-code contract of `kruxa-sim verify`, against a throwaway localhost JSON-RPC stub (no real network).
//! 0 MATCH, 2 only MISMATCH, 3 pending, 4 infrastructure, 64 usage, 1 tamper self-test failure.
use kruxa_logic::{hex, inputs_hash, VerdictInputs};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Output};
use std::thread;

fn inputs() -> VerdictInputs {
    VerdictInputs {
        launch_id: 1,
        charter_hash: [7; 32],
        total_active: 400_000_000,
        active_funders: 12,
        soft_cap: 350_000_000,
        min_funders: 10,
        cancelled: false,
    }
}

/// What the stub answers for each view: the JSON the contract would return, or a raw override of the whole HTTP body.
#[derive(Clone)]
enum Reply {
    Views { verdict_inputs: Value, settlement: Value },
    Raw(String),
}

fn settled(pass: bool, hash: &str) -> Value {
    json!({ "pass": pass, "inputs_hash": hash })
}

fn good() -> Reply {
    let i = inputs();
    Reply::Views {
        verdict_inputs: json!({ "inputs": serde_json::to_value(i).unwrap(), "inputs_hash": hex(&inputs_hash(&i)) }),
        settlement: settled(true, &hex(&inputs_hash(&i))),
    }
}

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

fn rpc_result(v: &Value) -> String {
    json!({ "jsonrpc": "2.0", "id": "kruxa", "result": { "result": v.to_string().bytes().collect::<Vec<u8>>(), "logs": [] } }).to_string()
}

/// Serves requests until the test process ends (the thread is detached; the OS reclaims it).
fn stub(reply: Reply) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    thread::spawn(move || {
        for mut s in l.incoming().flatten() {
            let body = match (&reply, read_request(&mut s)) {
                (Reply::Raw(r), _) => r.clone(),
                (Reply::Views { verdict_inputs, settlement }, Some(req)) => {
                    let m = req["params"]["method_name"].as_str().unwrap_or("");
                    rpc_result(if m == "get_verdict_inputs" { verdict_inputs } else { settlement })
                }
                _ => String::new(),
            };
            let _ = write!(
                s,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    url
}

/// A localhost port with nothing listening: connection refused.
fn dead_rpc() -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    drop(l);
    url
}

fn sim(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kruxa-sim")).args(args).output().unwrap()
}

fn verify(rpc: &str, extra: &[&str]) -> (i32, String) {
    let mut a = vec!["verify", "--rpc", rpc, "--contract", "core.test", "--launch", "1"];
    a.extend_from_slice(extra);
    let o = sim(&a);
    (o.status.code().unwrap(), String::from_utf8_lossy(&o.stdout).to_string())
}

#[test]
fn dead_rpc_with_tamper_all_exits_4_and_prints_no_mismatch() {
    let (code, out) = verify(&dead_rpc(), &["--tamper-all"]);
    assert_eq!(code, 4);
    assert!(!out.contains("MISMATCH"), "stdout: {out}");
}

#[test]
fn garbage_json_on_a_200_exits_4() {
    let (code, out) = verify(&stub(Reply::Raw("<html>not json</html>".into())), &["--tamper-all"]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false));
}

#[test]
fn contract_panic_in_a_view_exits_4_never_null() {
    let panic = json!({ "jsonrpc": "2.0", "id": "kruxa", "result": { "error": "wasm execution failed", "logs": [] } }).to_string();
    let (code, out) = verify(&stub(Reply::Raw(panic)), &[]);
    assert_eq!((code, out.contains("MISMATCH")), (4, false));
}

#[test]
fn view_bytes_that_are_not_json_exit_4() {
    let bad = json!({ "result": { "result": [60, 104, 62], "logs": [] } }).to_string();
    assert_eq!(verify(&stub(Reply::Raw(bad)), &[]).0, 4);
}

#[test]
fn missing_launch_exits_4() {
    let r = Reply::Views { verdict_inputs: Value::Null, settlement: Value::Null };
    assert_eq!(verify(&stub(r), &[]).0, 4);
}

#[test]
fn two_rpcs_that_disagree_exit_4() {
    let other = Reply::Views { verdict_inputs: Value::Null, settlement: Value::Null };
    let (a, b) = (stub(good()), stub(other));
    assert_eq!(verify(&a, &["--rpc2", &b]).0, 4);
}

#[test]
fn bad_usage_exits_64_not_2() {
    for args in [
        vec![],
        vec!["bogus"],
        vec!["verify"],
        vec!["verify", "--rpc", "http://x", "--contract", "c", "--launch", "1", "--nonsense"],
        vec!["verify", "--rpc", "http://x", "--contract", "c", "--launch", "1", "--tamper", "no_such_field"],
        vec!["verify", "--rpc", "http://x", "--contract", "c", "--launch", "1", "--tamper", "soft_cap", "--tamper-all"],
        vec!["verdict", "--launch-id", "x"],
        vec!["settle", "--total-active", "1", "--hard-cap", "1", "--commit", "1", "stray"],
    ] {
        assert_eq!(sim(&args).status.code(), Some(64), "{args:?}");
    }
}

#[test]
fn matching_launch_exits_0_with_match_line() {
    let (code, out) = verify(&stub(good()), &[]);
    assert_eq!(code, 0);
    assert!(out.contains("MATCH") && !out.contains("MISMATCH"), "{out}");
}

#[test]
fn unsettled_launch_exits_3() {
    let Reply::Views { verdict_inputs, .. } = good() else { unreachable!() };
    let (code, out) = verify(&stub(Reply::Views { verdict_inputs, settlement: Value::Null }), &[]);
    assert_eq!((code, out.contains("PENDING")), (3, true));
}

#[test]
fn real_mismatch_exits_2_and_names_the_field() {
    let Reply::Views { verdict_inputs, .. } = good() else { unreachable!() };
    let r = Reply::Views { verdict_inputs, settlement: settled(true, &"0".repeat(64)) };
    let (code, out) = verify(&stub(r), &[]);
    assert_eq!(code, 2);
    assert!(out.contains("MISMATCH inputs_hash"), "{out}");
}

#[test]
fn flipped_stored_verdict_is_a_mismatch_on_pass() {
    let Reply::Views { verdict_inputs, .. } = good() else { unreachable!() };
    let r = Reply::Views { verdict_inputs, settlement: settled(false, &hex(&inputs_hash(&inputs()))) };
    let (code, out) = verify(&stub(r), &[]);
    assert_eq!((code, out.contains("MISMATCH pass")), (2, true));
}

#[test]
fn single_tamper_exits_2_and_names_the_tampered_field() {
    let (code, out) = verify(&stub(good()), &["--tamper", "soft_cap"]);
    assert_eq!(code, 2);
    assert!(out.contains("MISMATCH soft_cap"), "{out}");
}

#[test]
fn bare_tamper_flag_keeps_the_old_meaning() {
    let (code, out) = verify(&stub(good()), &["--tamper"]);
    assert_eq!((code, out.contains("MISMATCH total_active")), (2, true));
}

#[test]
fn tamper_all_exits_2_with_one_mismatch_line_per_field() {
    let (code, out) = verify(&stub(good()), &["--tamper-all"]);
    assert_eq!(code, 2);
    for f in ["launch_id", "charter_hash", "total_active", "active_funders", "soft_cap", "min_funders", "cancelled"] {
        assert!(out.contains(&format!("MISMATCH {f}")), "{f} missing: {out}");
    }
    assert!(!out.contains("TAMPER NOT DETECTED"));
}
