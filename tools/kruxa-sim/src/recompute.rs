//! Plumbing shared by the recompute subcommands `verify-ledger` (C33), `verify-market` (C34) and `verify-instant` (IL checks).
//! Each one reads RAW numbers from public views, recomputes the identity here, and compares. A view's own boolean is never trusted.
//! Exit codes are the CO-6 E-4 contract in `cli.rs`; the tamper self-test follows `verify.rs`.
use crate::cli::*;
use crate::verify::view;
use serde_json::{json, Value};

pub fn rpcs_of(f: &Flags) -> Vec<String> {
    [Some(required(f, "rpc")), f.get("rpc2").cloned()].into_iter().flatten().collect()
}

/// A decimal-string (or small number) field of a view result. A missing or malformed field is infrastructure, never a mismatch.
pub fn dec(v: &Value, key: &str, from: &str) -> u128 {
    match &v[key] {
        Value::String(s) => s.parse().unwrap_or_else(|_| infra(&format!("{from}: field {key} is not a decimal integer: {s}"))),
        Value::Number(n) => n.as_u64().map_or_else(|| infra(&format!("{from}: field {key} is not an unsigned integer")), u128::from),
        _ => infra(&format!("{from}: field {key} is missing in {v}")),
    }
}

/// `ft_balance_of(account)` on a token contract: the real custody, read from the token and not from the custodian's own books.
pub fn ft_balance(rpcs: &[String], token: &str, account: &str) -> u128 {
    match view(rpcs, token, "ft_balance_of", &json!({ "account_id": account })) {
        Value::String(s) => s.parse().unwrap_or_else(|_| infra(&format!("{token} ft_balance_of is not a decimal: {s}"))),
        other => infra(&format!("{token} ft_balance_of returned {other}")),
    }
}

/// `--tamper [FIELD]` and `--tamper-all` after the shared flag parse. Unknown field or both flags is a usage error (exit 64).
pub fn tamper_request(f: &Flags, known: &[&str]) -> (Option<String>, bool) {
    let one = f.get("tamper").map(|t| if t == "true" { known[0].to_string() } else { t.clone() });
    if let Some(t) = one.as_deref().filter(|t| !known.contains(t)) {
        usage(&format!("unknown tamper field '{t}' (one of {})", known.join(", ")));
    }
    if one.is_some() && f.contains_key("tamper-all") {
        usage("--tamper and --tamper-all are exclusive");
    }
    (one, f.contains_key("tamper-all"))
}

/// Prints one PASS line per applicable check that held, then exits: 2 with a `MISMATCH <check>` line each for the failed ones.
pub fn conclude<T>(
    title: &str,
    rec: &T,
    applicable: &[&'static str],
    check: fn(&T) -> Vec<&'static str>,
    tamper: (Vec<&str>, Option<String>, bool),
    mutate: fn(&T, &str) -> T,
) -> ! {
    let bad = check(rec);
    for name in applicable.iter().filter(|n| !bad.contains(n)) {
        println!("PASS {name}");
    }
    if !bad.is_empty() {
        for b in &bad {
            println!("MISMATCH {b}");
        }
        std::process::exit(EXIT_MISMATCH)
    }
    println!("MATCH {title}");
    let (names, one, all) = tamper;
    let run: Vec<String> = match (one, all) {
        (Some(n), _) => vec![n],
        (None, true) => names.iter().map(|n| n.to_string()).collect(),
        (None, false) => std::process::exit(EXIT_MATCH),
    };
    let mut detected = true;
    for name in &run {
        if check(&mutate(rec, name)).is_empty() {
            println!("TAMPER NOT DETECTED {name}");
            detected = false;
        } else {
            println!("MISMATCH {name}");
        }
    }
    std::process::exit(if detected { EXIT_MISMATCH } else { EXIT_SELF_TEST })
}
