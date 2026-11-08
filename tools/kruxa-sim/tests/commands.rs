//! `kruxa-sim verdict | settle | validate | fuzz | fold` against the committed fixtures (W1-DC-10).
use kruxa_logic::{fold_book, hex, BookEvent};
use std::process::Command;

fn fixture(name: &str) -> String {
    format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn sim(args: &[&str]) -> (i32, String) {
    let o = Command::new(env!("CARGO_BIN_EXE_kruxa-sim")).args(args).output().unwrap();
    (o.status.code().unwrap(), String::from_utf8_lossy(&o.stdout).to_string())
}

#[test]
fn verdict_from_a_fixture_prints_pass_and_the_pinned_hash() {
    let (code, out) = sim(&["verdict", "--inputs", &fixture("pass.json")]);
    assert_eq!(code, 0);
    assert!(
        out.contains("outcome=PASS") && out.contains("inputs_hash=c2bd1b3b11872b7f56eda70d71c367d068038a24688f5fe18a5ef2c86d600d29"),
        "{out}"
    );
}

#[test]
fn verdict_one_micro_below_fails_with_the_named_reason() {
    let (_, out) = sim(&[
        "verdict",
        "--launch-id",
        "1",
        "--total-active",
        "349999999",
        "--funders",
        "10",
        "--soft-cap",
        "350000000",
        "--min-funders",
        "10",
    ]);
    assert!(out.contains("outcome=FAIL(reasons=1)") && out.contains("reasons=BELOW_SOFT_CAP"), "{out}");
}

#[test]
fn settle_reproduces_golden_example_one_for_buyer_seven() {
    let (code, out) = sim(&["settle", "--inputs", &fixture("oversub.json"), "--buyer", "7"]);
    assert_eq!(code, 0);
    assert!(out.contains("buyer 7: spend 40.000000 refund 60.000000 tokens 4800000.000000"), "{out}");
    assert!(out.contains("launch_fee=75000000 lp_quote=2083333333 stream=2841666667"), "{out}");
}

#[test]
fn settle_rejects_a_buyer_outside_the_book() {
    assert_eq!(sim(&["settle", "--inputs", &fixture("oversub.json"), "--buyer", "0"]).0, 64);
    assert_eq!(sim(&["settle", "--inputs", &fixture("oversub.json"), "--buyer", "126"]).0, 64);
}

#[test]
fn validate_lists_every_rule_the_hostile_preset_breaks() {
    let (code, out) = sim(&["validate", "--params", &fixture("hostile.json")]);
    assert_eq!(code, 65);
    assert!(out.contains("R_ALLOC: ") && out.contains("R_WINDOW: "), "{out}");
}

#[test]
fn validate_accepts_the_standard_preset_and_prints_no_rule_code() {
    let (code, out) = sim(&["validate", "--params", &fixture("standard.json")]);
    assert_eq!(code, 0);
    assert!(!out.contains("R_"), "{out}");
}

#[test]
fn validate_applies_the_global_headroom() {
    let (code, out) = sim(&["validate", "--params", &fixture("standard.json"), "--headroom", "999000000"]);
    assert_eq!((code, out.contains("R_CAP_GLOBAL")), (65, true));
}

#[test]
fn fuzz_checks_conservation_order_independence_and_no_overpay() {
    let (code, out) = sim(&["fuzz", "--n", "300", "--seed", "7"]);
    assert_eq!(code, 0);
    assert_eq!(out.lines().last(), Some("conservation 300/300 ok"), "{out}");
    assert!(out.contains("order-independence 300/300 ok") && out.contains("no-overpay 300/300 ok"), "{out}");
}

/// A log shaped like the contract's: built here with the pure fold so the test does not depend on the recorded fixture.
fn synthetic_log(dir: &std::path::Path) -> (String, String) {
    let evs = vec![
        BookEvent::Contributed { holder: "near:a.test".into(), net: 40_000_000 },
        BookEvent::Contributed { holder: "near:b.test".into(), net: 55_000_000 },
        BookEvent::Walked { holder: "near:a.test".into(), amount: 40_000_000 },
    ];
    let folded = fold_book(&evs).unwrap();
    let lines: Vec<String> = evs
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let (name, holder, amt) = match e {
                BookEvent::Contributed { holder, net } => ("contributed", holder, ("net", net)),
                BookEvent::Walked { holder, amount } => ("walked", holder, ("amount", amount)),
            };
            let (t, f, h) = fold_book(&evs[..=i]).unwrap().steps[i];
            format!(
                r#"EVENT_JSON:{{"standard":"kruxa","version":"1.0.0","event":"{name}","data":[{{"launch_id":"1","holder":"{holder}","{}":"{}","total_active":"{t}","funders":{f},"book_hash":"{}"}}]}}"#,
                amt.0,
                amt.1,
                hex(&h)
            )
        })
        .collect();
    let path = dir.join("events.jsonl");
    std::fs::write(&path, lines.join("\n") + "\n").unwrap();
    (path.to_string_lossy().to_string(), hex(&folded.book_hash))
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("kruxa-sim-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn fold_reproduces_the_stored_book_hash_and_tamper_prints_mismatch() {
    let dir = temp_dir("fold");
    let (path, hash) = synthetic_log(&dir);
    let (code, out) = sim(&["fold", "--events", &path]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains(&format!("book_hash={hash}")) && out.contains("MATCH") && !out.contains("MISMATCH"), "{out}");
    assert_eq!(sim(&["fold", "--events", &path, "--book-hash", &hash]).0, 0);
    let (code, out) = sim(&["fold", "--events", &path, "--tamper"]);
    assert_eq!(code, 2, "{out}");
    assert!(out.contains("MISMATCH"), "{out}");
    let (code, out) = sim(&["fold", "--events", &path, "--book-hash", &"0".repeat(64)]);
    assert_eq!((code, out.contains("MISMATCH book_hash")), (2, true));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn fold_flags_a_log_that_cannot_be_a_real_book_and_bad_input_is_usage() {
    let dir = temp_dir("fold-bad");
    let bad = dir.join("bad.jsonl");
    std::fs::write(&bad, r#"{"standard":"kruxa","version":"1.0.0","event":"walked","data":[{"launch_id":"1","holder":"near:x.test","amount":"5","total_active":"0","funders":0,"book_hash":"00"}]}"#).unwrap();
    let (code, out) = sim(&["fold", "--events", bad.to_str().unwrap()]);
    assert_eq!((code, out.contains("MISMATCH log")), (2, true), "{out}");
    assert_eq!(sim(&["fold", "--events", "/no/such/file.jsonl"]).0, 64);
    assert_eq!(sim(&["fold"]).0, 64);
    std::fs::remove_dir_all(dir).unwrap();
}

/// The log recorded from the real contract by the sandbox test `w_lifecycle_pass_30_buyers_3_walks_...` (KRUXA_RECORD_FIXTURES=1).
#[test]
fn fold_reproduces_the_book_hash_of_the_recorded_sandbox_lifecycle() {
    let events = fixture("events/lifecycle.jsonl");
    let stored = std::fs::read_to_string(fixture("events/lifecycle.book_hash")).unwrap();
    let (code, out) = sim(&["fold", "--events", &events, "--book-hash", stored.trim()]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("events=33") && out.contains("total_active=1080000000 funders=27"), "30 contributions + 3 walks: {out}");
    assert_eq!(sim(&["fold", "--events", &events, "--book-hash", stored.trim(), "--tamper"]).0, 2);
}
