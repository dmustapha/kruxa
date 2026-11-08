//! `kruxa-sim fold`: replay the `contributed` / `walked` events of one launch from scratch and reproduce the contract's rolling
//! `book_hash`, `total_active` and `active_funders`. Input is the NEP-297 log as emitted (one JSON object per line; a leading
//! `EVENT_JSON:` is accepted). `--tamper` adds one micro-USDC to the first contribution and MUST end in MISMATCH.
use crate::cli::*;
use kruxa_logic::{fold_book, hex, BookEvent, FoldError};
use serde_json::Value;

pub const SPEC: Spec = Spec { values: &["events", "book-hash", "launch"], optional_values: &[], switches: &["tamper"] };

/// One parsed event plus the numbers the contract claimed in it.
struct Logged {
    event: BookEvent,
    total_active: u128,
    funders: u64,
    book_hash: String,
}

fn field<'a>(d: &'a Value, k: &str) -> &'a str {
    d[k].as_str().unwrap_or_else(|| usage(&format!("event is missing string field '{k}': {d}")))
}

fn amount(d: &Value, k: &str) -> u128 {
    field(d, k).parse().unwrap_or_else(|_| usage(&format!("event field '{k}' is not a decimal integer: {d}")))
}

fn parse_line(line: &str, launch: &Option<String>) -> Option<Logged> {
    let json = line.trim().strip_prefix("EVENT_JSON:").unwrap_or(line.trim());
    let v: Value = serde_json::from_str(json).unwrap_or_else(|e| usage(&format!("not a JSON event line ({e}): {line}")));
    if v["standard"] != "kruxa" {
        return None;
    }
    let d = if v["data"].is_array() { &v["data"][0] } else { &v["data"] };
    if launch.as_ref().is_some_and(|l| d["launch_id"].as_str() != Some(l)) {
        return None;
    }
    let event = match v["event"].as_str() {
        Some("contributed") => BookEvent::Contributed { holder: field(d, "holder").into(), net: amount(d, "net") },
        Some("walked") => BookEvent::Walked { holder: field(d, "holder").into(), amount: amount(d, "amount") },
        _ => return None,
    };
    Some(Logged {
        event,
        total_active: amount(d, "total_active"),
        funders: d["funders"].as_u64().unwrap_or(u64::MAX),
        book_hash: field(d, "book_hash").into(),
    })
}

fn load(path: &str, launch: &Option<String>) -> Vec<Logged> {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| usage(&format!("cannot read --events {path}: {e}")));
    let logged: Vec<Logged> = text.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| parse_line(l, launch)).collect();
    if logged.is_empty() {
        usage("no contributed/walked events found (check --events and --launch)");
    }
    logged
}

fn mismatch(field: &str, detail: &str) -> ! {
    println!("MISMATCH {field} ({detail})");
    std::process::exit(EXIT_MISMATCH)
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let logged = load(&required(&f, "events"), &f.get("launch").cloned());
    let mut events: Vec<BookEvent> = logged.iter().map(|l| l.event.clone()).collect();
    let tamper = f.contains_key("tamper");
    if tamper {
        if let Some(BookEvent::Contributed { net, .. }) = events.iter_mut().find(|e| matches!(e, BookEvent::Contributed { .. })) {
            *net += 1;
        }
    }
    let folded = fold_book(&events).unwrap_or_else(|e| match e {
        FoldError::WalkWithoutPosition { index } => mismatch("log", &format!("event {index}: walk by a holder with nothing active")),
        FoldError::WalkAmountMismatch { index, open, amount } => {
            mismatch("log", &format!("event {index}: walk of {amount}, holder had {open}"))
        }
        FoldError::Overflow { index } => mismatch("log", &format!("event {index}: amount overflow")),
    });
    let got = hex(&folded.book_hash);
    println!("events={} total_active={} funders={} book_hash={got}", events.len(), folded.total_active, folded.active_funders);
    let want =
        f.get("book-hash").map(|h| h.trim_start_matches("0x").to_string()).unwrap_or_else(|| logged[logged.len() - 1].book_hash.clone());
    for (i, (l, step)) in logged.iter().zip(&folded.steps).enumerate() {
        if (l.total_active, l.funders) != (step.0, u64::from(step.1)) {
            mismatch(
                "total_active",
                &format!("event {i}: log says {} / {}, replay says {} / {}", l.total_active, l.funders, step.0, step.1),
            );
        }
    }
    if got != want {
        mismatch("book_hash", &format!("replay {got}, expected {want}"));
    }
    if tamper {
        println!("TAMPER NOT DETECTED book_hash");
        std::process::exit(EXIT_SELF_TEST);
    }
    println!("MATCH");
    std::process::exit(EXIT_MATCH)
}
