//! `kruxa-sim validate --params FILE`: run the launch rules (the contract's own `validate_all`) and print EVERY stage a preset breaks.
use crate::cli::*;
use kruxa_logic::{validate_all, Rules, TrialParams};

pub const SPEC: Spec = Spec { values: &["params", "profile", "headroom"], optional_values: &[], switches: &["brand"] };

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let path = required(&f, "params");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| usage(&format!("cannot read --params {path}: {e}")));
    let params: TrialParams = serde_json::from_str(&text).unwrap_or_else(|e| usage(&format!("{path} is not a TrialParams JSON: {e}")));
    let rules = match f.get("profile").map(String::as_str) {
        None | Some("ladder") => Rules::ladder(),
        Some("demo") => Rules::demo_clock(),
        Some(other) => usage(&format!("--profile must be ladder or demo, got '{other}'")),
    };
    let headroom: u128 = if f.contains_key("headroom") { num(&f, "headroom") } else { 3_000_000_000 };
    let violations = validate_all(&params, &rules, headroom, f.contains_key("brand"));
    if violations.is_empty() {
        println!("OK: no rule violated");
        std::process::exit(EXIT_MATCH);
    }
    for v in &violations {
        println!("{}", v.message());
    }
    std::process::exit(EXIT_RULE_VIOLATION)
}
