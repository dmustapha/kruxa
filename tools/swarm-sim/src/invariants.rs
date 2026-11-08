//! The invariant checker. Pure functions over data, so tests can feed it deliberately broken data and see it fire.
use crate::book::Book;
use crate::settle::Settlement;
use kruxa_logic::Outcome;
use kruxa_math::{linear_unlocked, mul_div_ceil, mul_div_floor};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Violation {
    pub round: u32,
    pub id: &'static str,
    pub detail: String,
}

fn v(round: u32, id: &'static str, detail: String) -> Violation {
    Violation { round, id, detail }
}

/// Book-level invariants: C1 (pre-settlement), C2, K1, K2, V1 ledger side.
pub fn check_book(b: &Book, round: u32) -> Vec<Violation> {
    let mut out = vec![];
    let held: u128 = b.accts.iter().map(|a| a.wallet + a.open).sum();
    if held != b.initial_funds {
        out.push(v(round, "C1", format!("wallets+open {held} != initial {}", b.initial_funds)));
    }
    let re = b.inputs_recomputed();
    if re.total_active != b.ledger_total || re.active_funders != b.ledger_funders {
        out.push(v(
            round,
            "C2",
            format!("ledger ({}, {}) != positions ({}, {})", b.ledger_total, b.ledger_funders, re.total_active, re.active_funders),
        ));
    }
    for (i, a) in b.accts.iter().enumerate() {
        if a.open > b.derived.wallet_cap {
            out.push(v(round, "K1", format!("agent {i} open {} > wallet cap {}", a.open, b.derived.wallet_cap)));
        }
        if a.open > 0 && a.open < b.params.min_buy {
            out.push(v(round, "K2", format!("agent {i} open {} < min buy {}", a.open, b.params.min_buy)));
        }
    }
    if b.ledger_total > b.derived.max_total_held {
        out.push(v(round, "K2", format!("total {} > ceiling {}", b.ledger_total, b.derived.max_total_held)));
    }
    if b.holders() > b.derived.max_holders {
        out.push(v(round, "K2", format!("holders {} > cap {}", b.holders(), b.derived.max_holders)));
    }
    if kruxa_logic::verdict(&b.inputs()) != kruxa_logic::verdict(&re) {
        out.push(v(round, "V1", "verdict from ledger != verdict from positions".to_string()));
    }
    out
}

/// Settlement invariants A1 to A4 and post-settlement conservation (C1).
pub fn check_settlement(b: &Book, s: &Settlement, round: u32) -> Vec<Violation> {
    let mut out = vec![];
    let sigma = s.inputs.total_active;
    let (sum_spend, sum_refund): (u128, u128) = s.positions.iter().fold((0, 0), |(a, r), p| (a + p.spend, r + p.refund));
    let wallets: u128 = b.accts.iter().map(|a| a.wallet).sum();
    if wallets + sum_spend + sum_refund != b.initial_funds {
        out.push(v(round, "C1", format!("post-settle wallets {wallets} + spend {sum_spend} + refund {sum_refund} != {}", b.initial_funds)));
    }
    for p in &s.positions {
        if p.spend + p.refund != p.commit {
            out.push(v(round, "A2", format!("agent {} spend {} + refund {} != commit {}", p.idx, p.spend, p.refund, p.commit)));
        }
    }
    match (&s.outcome, &s.alloc) {
        (Outcome::Pass, Some(a)) => check_pass(b, s, a, sigma, sum_spend, round, &mut out),
        (Outcome::Pass, None) => out.push(v(round, "A3", "PASS without an allocation".to_string())),
        (Outcome::Fail(_), _) => {
            for p in &s.positions {
                if p.spend != 0 || p.refund != p.commit || p.tokens != 0 {
                    out.push(v(round, "A4", format!("FAIL but agent {} spend {} tokens {}", p.idx, p.spend, p.tokens)));
                }
            }
        }
    }
    out
}

fn check_pass(b: &Book, s: &Settlement, a: &kruxa_logic::Allocation, sigma: u128, sum_spend: u128, round: u32, out: &mut Vec<Violation>) {
    if a.launch_fee + a.lp_quote + a.stream + a.excess_pool != sigma {
        out.push(v(round, "A3", format!("buckets {} != total {sigma}", a.launch_fee + a.lp_quote + a.stream + a.excess_pool)));
    }
    if a.launch_fee + a.lp_quote + a.stream != a.accepted || a.accepted > b.params.hard_cap {
        out.push(v(round, "A3", format!("accepted {} vs hard cap {} or bucket split", a.accepted, b.params.hard_cap)));
    }
    let n = s.positions.len() as u128;
    if sum_spend < a.accepted || sum_spend - a.accepted >= n.max(1) {
        out.push(v(round, "A3", format!("sum spend {sum_spend} vs accepted {} for {n} buyers", a.accepted)));
    }
    let (mut tok, mut bon) = (0u128, 0u128);
    for p in &s.positions {
        let want_spend = mul_div_ceil(p.commit, a.accepted, sigma).unwrap_or(u128::MAX);
        if p.spend != want_spend || p.spend > p.commit {
            out.push(v(round, "A2", format!("agent {} spend {} != ceil share {want_spend}", p.idx, p.spend)));
        }
        let ent = mul_div_floor(p.commit, b.derived.n_sale, sigma).unwrap_or(0);
        let ent_bonus = mul_div_floor(p.commit, b.derived.n_backer, sigma).unwrap_or(0);
        if p.tokens > ent || p.bonus > ent_bonus {
            out.push(v(round, "A1", format!("agent {} tokens {} > entitlement {ent}", p.idx, p.tokens)));
        }
        tok += p.tokens;
        bon += p.bonus;
    }
    if tok > b.derived.n_sale || bon > b.derived.n_backer {
        out.push(v(round, "A1", format!("sold tokens {tok} > n_sale {}", b.derived.n_sale)));
    }
}

/// Mirror of the contract's `draw`: Err("STREAM_CAP") when `want` exceeds what has unlocked and not yet been drawn.
pub fn stream_draw(total: u128, t0: u64, dur_ns: u64, now: u64, drawn: u128, want: u128) -> Result<u128, &'static str> {
    let cap = linear_unlocked(total, t0, dur_ns, now).unwrap_or(0);
    let drawable = cap.saturating_sub(drawn);
    if want > drawable {
        Err("STREAM_CAP")
    } else {
        Ok(drawn + want)
    }
}

/// T1 for one settlement: withdraw-all at the settle instant must be refused; stream-sized draws never exceed the linear cap.
pub fn check_stream(s: &Settlement, dur_ns: u64, round: u32) -> Vec<Violation> {
    let Some(a) = &s.alloc else { return vec![] };
    let mut out = vec![];
    if a.stream > 0 && stream_draw(a.stream, 0, dur_ns, 0, 0, a.stream).is_ok() {
        out.push(v(round, "T1", "withdraw-all at the settle instant was allowed".to_string()));
    }
    let mut drawn = 0u128;
    for k in 1..=8u64 {
        let now = dur_ns / 4 * k;
        let cap = linear_unlocked(a.stream, 0, dur_ns, now).unwrap_or(0);
        match stream_draw(a.stream, 0, dur_ns, now, drawn, cap.saturating_sub(drawn)) {
            Ok(d) if d <= cap && d <= a.stream => drawn = d,
            _ => out.push(v(round, "T1", format!("draw at probe {k} broke the cap"))),
        }
    }
    if drawn != a.stream {
        out.push(v(round, "T1", format!("stream not fully drawable at the end: {drawn} of {}", a.stream)));
    }
    out
}
