//! Argument parsing and the exit-code contract shared by `kruxa-sim` and `scripts/verify.sh` (CO-6 E-4).
//!
//! | code | meaning |
//! |---|---|
//! | 0 | MATCH |
//! | 2 | MISMATCH, and only a mismatch (always with a `MISMATCH <field>` line) |
//! | 3 | pending: launch not settled yet |
//! | 4 | infrastructure: RPC unreachable, non-200, RPCs disagree, unparsable or missing view |
//! | 64 | usage: bad or missing arguments |
//! | 1 | self-test failure: a tamper run was NOT detected, or `fuzz` found a broken identity |
//! | 65 | `validate` ran and the params break at least one rule (a report, not an error) |
use std::collections::HashMap;

pub const EXIT_MATCH: i32 = 0;
pub const EXIT_SELF_TEST: i32 = 1;
pub const EXIT_MISMATCH: i32 = 2;
pub const EXIT_PENDING: i32 = 3;
pub const EXIT_INFRA: i32 = 4;
pub const EXIT_USAGE: i32 = 64;
pub const EXIT_RULE_VIOLATION: i32 = 65;

pub type Flags = HashMap<String, String>;

/// Bad or missing arguments. Never exits 2.
pub fn usage(msg: &str) -> ! {
    eprintln!("usage error: {msg}");
    std::process::exit(EXIT_USAGE)
}

/// The network or a view failed. Never exits 2 and never prints a MISMATCH line.
pub fn infra(msg: &str) -> ! {
    eprintln!("infrastructure error: {msg}");
    std::process::exit(EXIT_INFRA)
}

/// Which flags a subcommand accepts. Anything else is a usage error (exit 64).
pub struct Spec {
    /// `--name VALUE`
    pub values: &'static [&'static str],
    /// `--name` or `--name VALUE`
    pub optional_values: &'static [&'static str],
    /// `--name`
    pub switches: &'static [&'static str],
}

pub fn parse_flags(args: &[String], spec: &Spec) -> Flags {
    let mut m = Flags::new();
    let mut i = 0;
    while i < args.len() {
        let Some(k) = args[i].strip_prefix("--") else { usage(&format!("unexpected argument '{}'", args[i])) };
        let next = args.get(i + 1).filter(|v| !v.starts_with("--"));
        if spec.switches.contains(&k) {
            m.insert(k.to_string(), "true".into());
            i += 1;
        } else if spec.values.contains(&k) {
            let v = next.unwrap_or_else(|| usage(&format!("--{k} needs a value")));
            m.insert(k.to_string(), v.clone());
            i += 2;
        } else if spec.optional_values.contains(&k) {
            m.insert(k.to_string(), next.cloned().unwrap_or_else(|| "true".into()));
            i += if next.is_some() { 2 } else { 1 };
        } else {
            usage(&format!("unknown flag --{k}"));
        }
    }
    m
}

pub fn num<T: std::str::FromStr>(f: &Flags, k: &str) -> T {
    f.get(k).and_then(|v| v.parse().ok()).unwrap_or_else(|| usage(&format!("--{k} is required and must be a number")))
}

pub fn required(f: &Flags, k: &str) -> String {
    f.get(k).cloned().unwrap_or_else(|| usage(&format!("--{k} is required")))
}
