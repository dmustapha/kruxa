//! A tiny JSON writer for events, views and cross-contract messages. Building the text directly keeps `serde_json::Value`
//! (and its map and number machinery) out of the wasm. Every value is escaped; u128 and u64 are written as decimal strings.
use core::fmt::{Display, Write};
use kruxa_logic::{EVENT_STANDARD, EVENT_VERSION};
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, value::RawValue};
use near_sdk::{env, AccountId};

pub struct Obj {
    buf: String,
}

fn quote(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

impl Obj {
    pub fn new() -> Self {
        Obj { buf: String::from("{") }
    }

    fn key(&mut self, k: &str) {
        if self.buf.len() > 1 {
            self.buf.push(',');
        }
        self.buf.push('"');
        self.buf.push_str(k);
        self.buf.push_str("\":");
    }

    /// A quoted string: text, accounts, and u128/u64 amounts (decimal strings by convention).
    pub fn s(mut self, k: &str, v: impl Display) -> Self {
        self.key(k);
        quote(&mut self.buf, &v.to_string());
        self
    }

    /// An unquoted number or bool.
    pub fn n(mut self, k: &str, v: impl Display) -> Self {
        self.key(k);
        let _ = write!(self.buf, "{v}");
        self
    }

    pub fn opt(self, k: &str, v: Option<&AccountId>) -> Self {
        match v {
            Some(a) => self.s(k, a),
            None => self.r(k, "null"),
        }
    }

    /// An already-built JSON fragment.
    pub fn r(mut self, k: &str, raw: &str) -> Self {
        self.key(k);
        self.buf.push_str(raw);
        self
    }

    pub fn o(self, k: &str, v: Obj) -> Self {
        let raw = v.finish();
        self.r(k, &raw)
    }

    /// Any serde type (fee terms) as nested JSON.
    pub fn j<T: Serialize>(self, k: &str, v: &T) -> Self {
        let raw = serde_json::to_string(v).unwrap_or_else(|_| String::from("null"));
        self.r(k, &raw)
    }

    pub fn finish(mut self) -> String {
        self.buf.push('}');
        self.buf
    }

    /// For a view's return value.
    pub fn raw(self) -> Box<RawValue> {
        RawValue::from_string(self.finish()).unwrap_or_else(|_| env::panic_str("R_MATH: view json"))
    }
}

/// `[a,b,c]` from finished fragments.
pub fn array(items: Vec<String>) -> String {
    format!("[{}]", items.join(","))
}

/// NEP-297 event. `data` is always a single object; no unbounded arrays.
pub fn emit(event: &str, data: Obj) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"{EVENT_STANDARD}\",\"version\":\"{EVENT_VERSION}\",\"event\":\"{event}\",\"data\":[{}]}}",
        data.finish()
    ));
}
