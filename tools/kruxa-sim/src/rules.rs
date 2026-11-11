//! `kruxa-sim rules [--profile ladder|demo] [--rpc URL --contract ACCOUNT]` (claim C-04).
//! Without `--rpc` it prints the `Rules` the code defaults to. With `--rpc` it compares them, key by key, with the live `get_rule_set`
//! of a core and prints `MISMATCH <key>` (exit 2) for each differing one. A failed view is exit 4.
use crate::cli::*;
use crate::verify::view;
use kruxa_logic::Rules;
use serde_json::{json, Value};

pub const SPEC: Spec = Spec { values: &["profile", "rpc", "contract"], optional_values: &[], switches: &[] };

fn differing_keys(want: &Value, live: &Value) -> Vec<String> {
    let (Some(w), Some(l)) = (want.as_object(), live.as_object()) else { return vec!["rule_set_shape".into()] };
    let mut keys: Vec<&String> = w.keys().chain(l.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| w.get(*k) != l.get(*k)).cloned().collect()
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let (profile, rules) = match f.get("profile").map(String::as_str) {
        None | Some("ladder") => ("ladder", Rules::ladder()),
        Some("demo") => ("demo", Rules::demo_clock()),
        Some(other) => usage(&format!("--profile must be ladder or demo, got '{other}'")),
    };
    let want = serde_json::to_value(&rules).unwrap_or_else(|e| infra(&format!("rules do not serialize: {e}")));
    let Some(rpc) = f.get("rpc") else {
        println!("{want}");
        std::process::exit(EXIT_MATCH)
    };
    let contract = required(&f, "contract");
    let live = view(std::slice::from_ref(rpc), &contract, "get_rule_set", &json!({}));
    let bad = differing_keys(&want, &live);
    for k in &bad {
        println!("MISMATCH {k}");
    }
    if !bad.is_empty() {
        std::process::exit(EXIT_MISMATCH)
    }
    println!("RULES MATCH {} keys: {contract} get_rule_set == Rules::{profile} in the code", want.as_object().map_or(0, |o| o.len()));
    std::process::exit(EXIT_MATCH)
}
