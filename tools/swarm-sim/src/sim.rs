//! The 24-round loop: agents act, invariants are checked after every round, then settlement and post-close probes.
use crate::agents::{roster, Action, Agent, View};
use crate::book::{Book, ROUNDS, USDC, WALK_END};
use crate::invariants::{check_book, check_settlement, check_stream, Violation};
use crate::rng::Rng;
use crate::settle::{outcome_str, settle, Settlement};
use kruxa_logic::{Rules, TrialParams};
use kruxa_math::days_to_ns;

const SEED2_SOFT: u64 = 1000;
const SEED2_PCT: u64 = 45;
const SEED3_SOFT: u64 = 1000;
const SEED3_PCT: u64 = 30;

/// Invariant ids asserted each round: C1 C2 K1 K2 V1 A1 A2 A3 A4 T1.
pub const CHECKS_PER_ROUND: u32 = 10;

#[derive(Clone, Debug)]
pub struct Config {
    pub seed: u64,
    pub params: TrialParams,
    pub rules: Rules,
    /// Crowd temperature: honest budgets as a percent of their nominal 20 to 100 USDC range.
    pub honest_pct: u64,
    pub preset: &'static str,
}

impl Config {
    /// The recorded scenario: spec defaults ($1,000 hard cap, 200 bps wallet cap, 10 funders), soft cap chosen by the seed.
    pub fn for_seed(seed: u64) -> Config {
        let mut rng = Rng::new(seed ^ 0xA5A5);
        let mut params = TrialParams::example("SWARM");
        let (soft, pct, preset) = match seed {
            1 => (600, 100, "warm crowd, comfortable pass"),
            2 => (SEED2_SOFT, SEED2_PCT, "thin margin, soft cap near the crowd"),
            3 => (SEED3_SOFT, SEED3_PCT, "cold crowd, soft cap too high"),
            _ => (350 + 50 * rng.range(0, 13), rng.range(30, 100), "seeded random"),
        };
        params.soft_cap = soft as u128 * USDC;
        Config { seed, params, rules: Rules::ladder(), honest_pct: pct, preset }
    }

    /// Wider sweep for property tests: hard cap, soft cap, wallet cap and funder floor all vary inside the validated rules.
    pub fn fuzz(seed: u64) -> Config {
        let mut rng = Rng::new(seed ^ 0x5A5A);
        let mut params = TrialParams::example("SWARM");
        params.hard_cap = (500 + 100 * rng.range(0, 5) as u128) * USDC;
        let floor = (350 * USDC).max(params.hard_cap / 5);
        params.soft_cap = floor + (params.hard_cap - floor) * rng.range(0, 6) as u128 / 6;
        params.wallet_bps = [50u16, 200, 350, 500][rng.range(0, 3) as usize];
        params.min_funders = rng.range(10, 14) as u32;
        Config { seed, params, rules: Rules::ladder(), honest_pct: rng.range(30, 100), preset: "fuzz" }
    }
}

#[derive(Clone, Debug)]
pub struct Event {
    pub round: u32,
    pub agent: usize,
    pub action: &'static str,
    pub amount: u128,
    pub result: &'static str,
}

#[derive(Clone, Debug)]
pub struct RoundRec {
    pub round: u32,
    pub phase: &'static str,
    pub total: u128,
    pub funders: u32,
    pub margin_usdc: i128,
    pub margin_funders: i64,
    pub verdict_now: String,
    pub oversub_bps: u128,
    pub events: Vec<Event>,
    pub checks: u32,
    pub violations: Vec<Violation>,
}

#[derive(Clone, Debug)]
pub struct Probe {
    pub what: &'static str,
    pub agent: usize,
    pub result: &'static str,
}

#[derive(Clone, Debug)]
pub struct Run {
    pub cfg: Config,
    pub agents: Vec<Agent>,
    pub book: Book,
    pub rounds: Vec<RoundRec>,
    pub settlement: Settlement,
    pub probes: Vec<Probe>,
    pub final_violations: Vec<Violation>,
}

impl Run {
    pub fn violations(&self) -> Vec<Violation> {
        let mut v: Vec<Violation> = self.rounds.iter().flat_map(|r| r.violations.clone()).collect();
        v.extend(self.final_violations.clone());
        v
    }
}

fn view(book: &Book, round: u32, i: usize) -> View {
    View {
        round,
        total: book.ledger_total,
        funders: book.ledger_funders,
        soft_cap: book.params.soft_cap,
        hard_cap: book.params.hard_cap,
        min_funders: book.params.min_funders,
        wallet_cap: book.derived.wallet_cap,
        min_buy: book.params.min_buy,
        own_open: book.accts[i].open,
        own_wallet: book.accts[i].wallet,
    }
}

fn apply(book: &mut Book, i: usize, a: Action, round: u32) -> Event {
    let now = round as u64;
    let (name, amount, res) = match a {
        Action::Commit(x) => ("commit", x, book.commit(i, x, now).err()),
        Action::Walk => {
            let open = book.accts[i].open;
            ("walk", open, book.walk(i, now).err())
        }
    };
    if let Some(code) = res {
        book.log_refusal(i, round, code);
    }
    Event { round, agent: i, action: name, amount, result: res.unwrap_or("ok") }
}

/// Everything the checker asserts at the end of one round: the book, a hypothetical settlement, and the creator's withdraw-all.
fn round_checks(book: &Book, round: u32) -> (u32, Vec<Violation>) {
    let dur = days_to_ns(book.params.stream_days as u64).unwrap_or(0);
    let hypo = settle(book);
    let mut out = check_book(book, round);
    out.extend(check_settlement(book, &hypo, round));
    out.extend(check_stream(&hypo, dur, round));
    (CHECKS_PER_ROUND, out)
}

pub fn run(cfg: &Config) -> Result<Run, String> {
    let mut rng = Rng::new(cfg.seed);
    let wallet_cap = kruxa_logic::validate_params(&cfg.params, &cfg.rules, u128::MAX, false).map_err(|e| e.message())?.wallet_cap;
    let mut agents = roster(&mut rng, wallet_cap, cfg.honest_pct);
    let budgets: Vec<u128> = agents.iter().map(|a| a.budget).collect();
    let mut book = Book::new(cfg.params.clone(), cfg.rules.clone(), &budgets)?;
    let mut rounds = vec![];
    for round in 0..ROUNDS {
        let mut order: Vec<usize> = (0..agents.len()).collect();
        rng.shuffle(&mut order);
        let mut events = vec![];
        for i in order {
            let acts = agents[i].act(&view(&book, round, i));
            events.extend(acts.into_iter().map(|a| apply(&mut book, i, a, round)));
        }
        rounds.push(record(&book, round, events));
    }
    let settlement = settle(&book);
    let probes = post_close_probes(&mut book);
    let dur = days_to_ns(book.params.stream_days as u64).unwrap_or(0);
    let mut final_violations = check_book(&book, ROUNDS);
    final_violations.extend(check_settlement(&book, &settlement, ROUNDS));
    final_violations.extend(check_stream(&settlement, dur, ROUNDS));
    Ok(Run { cfg: cfg.clone(), agents, book, rounds, settlement, probes, final_violations })
}

fn record(book: &Book, round: u32, events: Vec<Event>) -> RoundRec {
    let (checks, violations) = round_checks(book, round);
    let phase = format!("{:?}", book.phase(round as u64));
    let phase: &'static str = match phase.as_str() {
        "Open" => "Open",
        "Closing" => "Closing",
        "Ready" => "Ready",
        _ => "Scheduled",
    };
    RoundRec {
        round,
        phase,
        total: book.ledger_total,
        funders: book.ledger_funders,
        margin_usdc: book.ledger_total as i128 - book.params.soft_cap as i128,
        margin_funders: book.ledger_funders as i64 - book.params.min_funders as i64,
        verdict_now: outcome_str(kruxa_logic::verdict(&book.inputs())),
        oversub_bps: book.ledger_total * 10_000 / book.params.hard_cap,
        events,
        checks,
        violations,
    }
}

/// At now = walk_end: a Walk must be refused and a commit must be refused. Anyone settling is allowed (the clock says Ready).
fn post_close_probes(book: &mut Book) -> Vec<Probe> {
    let now = WALK_END;
    let late_walk = book.walk(book.accts.iter().position(|a| a.open > 0).unwrap_or(0), now);
    let late_commit = book.commit(0, book.params.min_buy, now);
    let ready = book.phase(now) == kruxa_logic::Phase::Ready;
    vec![
        Probe { what: "walk at walk_end", agent: 0, result: late_walk.err().unwrap_or("ACCEPTED (BUG)") },
        Probe { what: "commit at walk_end", agent: 0, result: late_commit.err().unwrap_or("ACCEPTED (BUG)") },
        Probe { what: "settle phase at walk_end", agent: 0, result: if ready { "Ready" } else { "NOT READY (BUG)" } },
    ]
}
