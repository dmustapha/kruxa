//! Summary, JSON and terminal output for one run.
use crate::agents::Group;
use crate::book::{COMMIT_END_R as COMMIT_END, ROUNDS, USDC, WALK_END_R as WALK_END};
use crate::settle::outcome_str;
use crate::sim::Run;
use kruxa_logic::Outcome;
use kruxa_math::mul_div_floor;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const SCHEMA: &str = "kruxa.swarm.run/1";
pub const GROUPS: [Group; 5] = [Group::Honest, Group::Whale, Group::Sniper, Group::Sybil, Group::Flipper];

#[derive(Clone, Debug, Default)]
pub struct AgentOut {
    pub committed: u128,
    pub spend: u128,
    pub refund: u128,
    pub tokens: u128,
    pub bonus: u128,
}

#[derive(Clone, Debug, Default)]
pub struct GroupStat {
    pub agents: u32,
    pub committed: u128,
    pub spend: u128,
    pub refund: u128,
    pub tokens: u128,
    pub commit_share_bps: u128,
    pub token_share_bps: u128,
    pub fill_bps: u128,
}

#[derive(Clone, Debug)]
pub struct Summary {
    pub agent: Vec<AgentOut>,
    pub groups: Vec<(Group, GroupStat)>,
    pub passed: bool,
    pub verdict: String,
    pub accepted: u128,
    pub clearing_price_micro_per_whole: Option<f64>,
    pub oversub_bps: u128,
    pub margin_usdc: i128,
    pub margin_funders: i64,
    pub max_price_dev_ppm: u128,
    pub price_parity: bool,
    pub blocked: BTreeMap<(String, String), u32>,
    pub flip_succeeded: bool,
    pub flip_margin_before: Option<i128>,
    pub sybil_multiple_x100: u128,
    pub adversaries_beat_honest: bool,
}

pub fn summarize(run: &Run) -> Summary {
    let n = run.agents.len();
    let mut agent = vec![AgentOut::default(); n];
    for p in &run.settlement.positions {
        agent[p.idx] = AgentOut { committed: p.commit, spend: p.spend, refund: p.refund, tokens: p.tokens, bonus: p.bonus };
    }
    let total = run.settlement.inputs.total_active;
    let groups: Vec<(Group, GroupStat)> = GROUPS.iter().map(|g| (*g, group_stat(run, &agent, *g, total))).collect();
    let (price_ok, dev) = price_parity(run, &agent);
    let flip = flip_analysis(run);
    let sybil_multiple_x100 = sybil_multiple(run, &groups);
    let violations = run.violations();
    let cap_ok = run.agents.iter().enumerate().all(|(i, _)| run.book.accts[i].peak <= run.book.derived.wallet_cap);
    let last = run.rounds.last().expect("24 rounds");
    Summary {
        agent,
        groups,
        passed: run.settlement.outcome == Outcome::Pass,
        verdict: outcome_str(run.settlement.outcome),
        accepted: run.settlement.alloc.map_or(0, |a| a.accepted),
        clearing_price_micro_per_whole: clearing(run),
        oversub_bps: total * 10_000 / run.book.params.hard_cap,
        margin_usdc: last.margin_usdc,
        margin_funders: last.margin_funders,
        max_price_dev_ppm: dev,
        price_parity: price_ok,
        blocked: blocked_counts(run),
        flip_succeeded: flip.0,
        flip_margin_before: flip.1,
        sybil_multiple_x100,
        adversaries_beat_honest: !(price_ok && cap_ok && violations.is_empty()),
    }
}

fn group_stat(run: &Run, agent: &[AgentOut], g: Group, total: u128) -> GroupStat {
    let idx: Vec<usize> = (0..agent.len()).filter(|i| run.agents[*i].group == g).collect();
    let sum = |f: fn(&AgentOut) -> u128| idx.iter().map(|i| f(&agent[*i])).sum::<u128>();
    let (committed, spend, tokens) = (sum(|a| a.committed), sum(|a| a.spend), sum(|a| a.tokens));
    let n_sale = run.book.derived.n_sale;
    GroupStat {
        agents: idx.len() as u32,
        committed,
        spend,
        refund: sum(|a| a.refund),
        tokens,
        commit_share_bps: (committed * 10_000).checked_div(total).unwrap_or(0),
        token_share_bps: if run.settlement.outcome == Outcome::Pass { tokens * 10_000 / n_sale } else { 0 },
        fill_bps: (spend * 10_000).checked_div(committed).unwrap_or(0),
    }
}

fn clearing(run: &Run) -> Option<f64> {
    run.settlement.alloc.map(|a| a.accepted as f64 / run.book.derived.n_sale as f64 * 1e6)
}

/// Every buyer's spend/tokens must equal accepted/n_sale up to the integer rounding of its own two numbers.
fn price_parity(run: &Run, agent: &[AgentOut]) -> (bool, u128) {
    let Some(a) = run.settlement.alloc else { return (true, 0) };
    let n_sale = run.book.derived.n_sale;
    let (mut worst, mut ok) = (0u128, true);
    for o in agent.iter().filter(|o| o.tokens > 0) {
        // |spend/tokens - accepted/n_sale| in ppm of the clearing price, versus the rounding allowance.
        let lhs = o.spend * n_sale;
        let rhs = a.accepted * o.tokens;
        let diff = lhs.abs_diff(rhs);
        let dev_ppm = mul_div_floor(diff, 1_000_000, rhs.max(1)).unwrap_or(u128::MAX);
        let allowance = 1_000_000 / o.spend.max(1) + 1_000_000 / o.tokens.max(1) + 1;
        worst = worst.max(dev_ppm);
        ok &= dev_ppm <= allowance;
    }
    (ok, worst)
}

fn blocked_counts(run: &Run) -> BTreeMap<(String, String), u32> {
    let mut m = BTreeMap::new();
    for (i, a) in run.agents.iter().enumerate() {
        for (_, code) in &run.book.accts[i].refused {
            *m.entry((a.group.name().to_string(), code.to_string())).or_insert(0) += 1;
        }
    }
    m
}

/// (flip succeeded, pass margin in USDC at the end of the second-to-last round). A flip succeeded only if the trial would
/// have passed had the flipper not walked.
fn flip_analysis(run: &Run) -> (bool, Option<i128>) {
    let Some(fi) = run.agents.iter().position(|a| a.group == Group::Flipper) else { return (false, None) };
    let acct = &run.book.accts[fi];
    let Some(wr) = acct.walked_round else { return (false, None) };
    let before = run.rounds[(wr as usize).saturating_sub(1).min(run.rounds.len() - 1)].margin_usdc;
    let p = &run.book.params;
    let s = run.settlement.inputs;
    let would = s.total_active + acct.walked_amount >= p.soft_cap && s.active_funders + 1 >= p.min_funders;
    (run.settlement.outcome != Outcome::Pass && would, Some(before))
}

fn sybil_multiple(run: &Run, groups: &[(Group, GroupStat)]) -> u128 {
    let sy = &groups.iter().find(|g| g.0 == Group::Sybil).expect("group").1;
    let single = run.book.derived.wallet_cap;
    (sy.committed * 100).checked_div(single).unwrap_or(0)
}

fn s(x: u128) -> String {
    x.to_string()
}

pub fn to_json(run: &Run, sm: &Summary) -> Value {
    let p = &run.book.params;
    let a = run.settlement.alloc;
    json!({
        "schema": SCHEMA,
        "seed": run.cfg.seed, "preset": run.cfg.preset, "honest_budget_pct": run.cfg.honest_pct,
        "label": "SCRIPTED, RECORDED (offline simulation against the real kruxa-logic verdict and allocation functions)",
        "trial": {
            "hard_cap": s(p.hard_cap), "soft_cap": s(p.soft_cap), "min_funders": p.min_funders, "min_buy": s(p.min_buy),
            "wallet_cap": s(run.book.derived.wallet_cap), "max_total_held": s(run.book.derived.max_total_held),
            "max_holders": run.book.derived.max_holders, "n_sale": s(run.book.derived.n_sale),
            "rounds": ROUNDS, "commit_end_round": COMMIT_END, "walk_end_round": WALK_END, "usdc_unit": s(USDC)
        },
        "agents": agents_json(run, sm),
        "rounds": run.rounds.iter().map(round_json).collect::<Vec<_>>(),
        "settlement": {
            "verdict": sm.verdict, "passed": sm.passed, "total_committed": s(run.settlement.inputs.total_active),
            "funders": run.settlement.inputs.active_funders, "accepted": s(sm.accepted),
            "launch_fee": s(a.map_or(0, |x| x.launch_fee)), "lp_quote": s(a.map_or(0, |x| x.lp_quote)),
            "stream": s(a.map_or(0, |x| x.stream)), "excess_refunded": s(a.map_or(0, |x| x.excess_pool)),
            "oversubscription_bps": sm.oversub_bps, "margin_usdc": sm.margin_usdc.to_string(), "margin_funders": sm.margin_funders,
            "clearing_usdc_per_million_whole_tokens": sm.clearing_price_micro_per_whole.map(|x| format!("{x:.2}")),
        },
        "groups": sm.groups.iter().map(|(g, st)| group_json(*g, st)).collect::<Vec<_>>(),
        "analysis": analysis_json(run, sm),
        "probes": run.probes.iter().map(|x| json!({"what": x.what, "result": x.result})).collect::<Vec<_>>(),
        "invariants": invariants_json(run),
    })
}

fn agents_json(run: &Run, sm: &Summary) -> Vec<Value> {
    run.agents
        .iter()
        .enumerate()
        .map(|(i, ag)| {
            let (o, acct) = (&sm.agent[i], &run.book.accts[i]);
            let mut refused: BTreeMap<&str, u32> = BTreeMap::new();
            for (_, c) in &acct.refused {
                *refused.entry(c).or_insert(0) += 1;
            }
            json!({
                "index": i, "id": ag.id, "label": ag.label, "group": ag.group.name(), "honest": ag.group == Group::Honest,
                "budget": s(ag.budget), "peak_commit": s(acct.peak), "final_commit": s(o.committed),
                "spend": s(o.spend), "refund": s(o.refund), "tokens": s(o.tokens), "bonus_tokens": s(o.bonus),
                "walked": acct.walked_round.is_some(), "walked_round": acct.walked_round,
                "refused": refused,
            })
        })
        .collect()
}

fn round_json(r: &crate::sim::RoundRec) -> Value {
    json!({
        "round": r.round, "phase": r.phase, "total_committed": s(r.total), "funders": r.funders,
        "margin_usdc": r.margin_usdc.to_string(), "margin_funders": r.margin_funders, "verdict_now": r.verdict_now,
        "oversubscription_bps": r.oversub_bps,
        "events": r.events.iter().map(|e| json!({"agent": e.agent, "action": e.action, "amount": s(e.amount), "result": e.result})).collect::<Vec<_>>(),
        "invariants_checked": r.checks, "violations": r.violations.iter().map(|v| json!({"id": v.id, "detail": v.detail})).collect::<Vec<_>>(),
    })
}

fn group_json(g: Group, st: &GroupStat) -> Value {
    json!({
        "group": g.name(), "agents": st.agents, "committed": s(st.committed), "spend": s(st.spend), "refund": s(st.refund),
        "tokens": s(st.tokens), "commit_share_bps": st.commit_share_bps, "token_share_bps": st.token_share_bps, "fill_bps": st.fill_bps,
    })
}

fn analysis_json(run: &Run, sm: &Summary) -> Value {
    let blocked: Vec<Value> = sm.blocked.iter().map(|((g, c), n)| json!({"group": g, "rule_code": c, "count": n})).collect();
    json!({
        "adversaries_beat_honest": sm.adversaries_beat_honest,
        "price_parity": sm.price_parity, "max_price_deviation_ppm": sm.max_price_dev_ppm.to_string(),
        "blocked_by_rule": blocked,
        "bounded_not_blocked": [
            {"attack": "sybil_split", "outcome": "BOUNDED", "ring_accounts": 4,
             "ring_committed": s(sm.groups.iter().find(|g| g.0 == Group::Sybil).map_or(0, |g| g.1.committed)),
             "multiple_of_one_wallet_cap_x100": sm.sybil_multiple_x100.to_string(),
             "note": "accounts are unlinkable on chain, so the ring holds up to 4x the per-wallet cap; it pays the same uniform price and is diluted pro-rata"},
            {"attack": "walk_flip", "outcome": "BOUNDED", "flip_succeeded": sm.flip_succeeded,
             "margin_before_walk_usdc": sm.flip_margin_before.map(|m| m.to_string()),
             "note": "a last-round Walk flips PASS to FAIL only when the pass margin is smaller than one position (at most the wallet cap); all other buyers are refunded in full"}
        ],
        "violations": run.violations().iter().map(|v| json!({"round": v.round, "id": v.id, "detail": v.detail})).collect::<Vec<_>>(),
    })
}

fn invariants_json(run: &Run) -> Value {
    let checks: u32 = run.rounds.iter().map(|r| r.checks).sum();
    json!({"ids": ["C1","C2","K1","K2","V1","A1","A2","A3","A4","T1"], "rounds_checked": run.rounds.len(), "checks_run": checks,
           "violations": run.violations().len(), "held": run.violations().is_empty()})
}

fn usdc(x: u128) -> String {
    format!("{}.{:02}", x / USDC, x % USDC / 10_000)
}

pub fn print_run(run: &Run, sm: &Summary) {
    for r in &run.rounds {
        if r.violations.is_empty() {
            println!(
                "INV OK   r{:02}/{} {:<8} total {:>9} funders {:>2} margin {:>9} {}",
                r.round + 1,
                ROUNDS,
                r.phase,
                usdc(r.total),
                r.funders,
                format!("{:+.2}", r.margin_usdc as f64 / 1e6),
                r.verdict_now
            );
        }
        for v in &r.violations {
            println!("INV FAIL r{:02} {} {}", r.round, v.id, v.detail);
        }
    }
    for v in &run.final_violations {
        println!("INV FAIL settlement {} {}", v.id, v.detail);
    }
    print_agents(run, sm);
    print_aggregate(run, sm);
}

fn print_agents(run: &Run, sm: &Summary) {
    println!(
        "\n{:<4} {:<18} {:<8} {:>9} {:>9} {:>9} {:>12} {:<7} refused",
        "id", "label", "group", "commit", "spend", "refund", "tokens(M)", "walked"
    );
    for (i, a) in run.agents.iter().enumerate() {
        let (o, acct) = (&sm.agent[i], &run.book.accts[i]);
        let mut codes: BTreeMap<&str, u32> = BTreeMap::new();
        for (_, c) in &acct.refused {
            *codes.entry(c).or_insert(0) += 1;
        }
        let refused = codes.iter().map(|(c, n)| format!("{c}x{n}")).collect::<Vec<_>>().join(",");
        println!(
            "{:<4} {:<18} {:<8} {:>9} {:>9} {:>9} {:>12.3} {:<7} {}",
            a.id,
            a.label,
            a.group.name(),
            usdc(o.committed),
            usdc(o.spend),
            usdc(o.refund),
            o.tokens as f64 / 1e12,
            if acct.walked_round.is_some() { "yes" } else { "no" },
            refused
        );
    }
}

fn print_aggregate(run: &Run, sm: &Summary) {
    println!(
        "\nseed {} ({}) | soft cap {} | hard cap {} | wallet cap {}",
        run.cfg.seed,
        run.cfg.preset,
        usdc(run.book.params.soft_cap),
        usdc(run.book.params.hard_cap),
        usdc(run.book.derived.wallet_cap)
    );
    println!(
        "verdict {} | committed {} | accepted {} | oversubscription {:.2}x | margin {} USDC, {} funders",
        sm.verdict,
        usdc(run.settlement.inputs.total_active),
        usdc(sm.accepted),
        sm.oversub_bps as f64 / 1e4,
        usdc_signed(sm.margin_usdc),
        sm.margin_funders
    );
    if let Some(p) = sm.clearing_price_micro_per_whole {
        println!(
            "clearing price {:.4} USDC per 1M tokens (same for every buyer); max deviation {} ppm; price parity {}",
            p, sm.max_price_dev_ppm, sm.price_parity
        );
    }
    println!(
        "{:<8} {:>6} {:>10} {:>10} {:>10} {:>12} {:>12}",
        "group", "agents", "committed", "spend", "fill %", "pool share %", "token share %"
    );
    for (g, st) in &sm.groups {
        println!(
            "{:<8} {:>6} {:>10} {:>10} {:>10.2} {:>12.2} {:>12.2}",
            g.name(),
            st.agents,
            usdc(st.committed),
            usdc(st.spend),
            st.fill_bps as f64 / 100.0,
            st.commit_share_bps as f64 / 100.0,
            st.token_share_bps as f64 / 100.0
        );
    }
    print_findings(sm);
}

fn usdc_signed(x: i128) -> String {
    format!("{:+.2}", x as f64 / 1e6)
}

fn print_findings(sm: &Summary) {
    println!("\nBLOCKED by rule (contract refuses):");
    for ((g, c), n) in &sm.blocked {
        println!("  {g:<8} {c} x{n}");
    }
    println!("BOUNDED, NOT BLOCKED:");
    println!(
        "  sybil split: ring holds {:.2}x one wallet cap (4 unlinkable accounts), same uniform price, diluted pro-rata",
        sm.sybil_multiple_x100 as f64 / 100.0
    );
    println!(
        "  walk-flip: flip succeeded = {} (pass margin before the walk: {} USDC)",
        sm.flip_succeeded,
        sm.flip_margin_before.map_or("n/a".to_string(), usdc_signed)
    );
    println!("adversaries beat honest backers on price or caps: {}", sm.adversaries_beat_honest);
}
