//! The 16 scripted agents. Each sees only public book data (`View`) and its own position. No model calls, no randomness
//! at decision time: every random choice (budgets, schedules) is drawn once from the seeded RNG when the roster is built.
use crate::book::{COMMIT_END_R as COMMIT_END, USDC, WALK_END_R as WALK_END};
use crate::rng::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Honest,
    Whale,
    Sniper,
    Sybil,
    Flipper,
}

impl Group {
    pub fn name(self) -> &'static str {
        match self {
            Group::Honest => "honest",
            Group::Whale => "whale",
            Group::Sniper => "sniper",
            Group::Sybil => "sybil",
            Group::Flipper => "flipper",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct View {
    pub round: u32,
    pub total: u128,
    pub funders: u32,
    pub soft_cap: u128,
    pub hard_cap: u128,
    pub min_funders: u32,
    pub wallet_cap: u128,
    pub min_buy: u128,
    pub own_open: u128,
    pub own_wallet: u128,
}

impl View {
    pub fn passing(&self) -> bool {
        self.total >= self.soft_cap && self.funders >= self.min_funders
    }
    fn in_tail(&self) -> bool {
        self.round >= COMMIT_END && self.round < WALK_END
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Commit(u128),
    Walk,
}

#[derive(Clone, Debug)]
pub enum Strat {
    Steady { round: u32 },
    Dca { rounds: [u32; 4], next: usize },
    Cautious { done: bool },
    FillAverse { round: u32 },
    Small { round: u32 },
    TopUp { second: bool },
    Nervous { round: u32 },
    Whale { start: u32 },
    Sniper { conditional: bool },
    SybilLead { round: u32, tried_big: bool },
    Sybil { round: u32 },
    Flipper { round: u32 },
}

#[derive(Clone, Debug)]
pub struct Agent {
    pub id: &'static str,
    pub label: &'static str,
    pub group: Group,
    pub budget: u128,
    pub strat: Strat,
}

impl Agent {
    pub fn act(&mut self, v: &View) -> Vec<Action> {
        let budget = self.budget;
        let cap = v.wallet_cap;
        match &mut self.strat {
            Strat::Steady { round } => once(v.round == *round, budget.min(cap)),
            Strat::Dca { rounds, next } => {
                if *next < 4 && v.round == rounds[*next] {
                    *next += 1;
                    return once(v.own_open + 20 * USDC <= budget, 20 * USDC);
                }
                vec![]
            }
            Strat::Cautious { done } => {
                let ready = (8..=17).contains(&v.round) && v.total * 4 >= v.soft_cap;
                if !*done && ready {
                    *done = true;
                    return vec![Action::Commit(budget.min(cap))];
                }
                vec![]
            }
            Strat::FillAverse { round } => {
                if v.round == *round {
                    return vec![Action::Commit(budget.min(cap))];
                }
                let over = v.total * 10_000 > v.hard_cap * 15_000;
                if v.in_tail() && over && v.own_open > 0 {
                    return vec![Action::Walk];
                }
                vec![]
            }
            Strat::Small { round } => once(v.round == *round, budget),
            Strat::TopUp { second } => {
                if v.round == 1 {
                    return vec![Action::Commit(budget / 2)];
                }
                if v.round == 14 && !*second && v.passing() {
                    *second = true;
                    return vec![Action::Commit(budget - budget / 2)];
                }
                vec![]
            }
            Strat::Nervous { round } => {
                if v.round == *round {
                    return vec![Action::Commit(budget.min(cap))];
                }
                let thin = v.passing() && (v.total - v.soft_cap) * 10 < v.soft_cap;
                if v.in_tail() && thin && v.own_open > 0 {
                    return vec![Action::Walk];
                }
                vec![]
            }
            Strat::Whale { start } => whale(v, *start, cap),
            Strat::Sniper { conditional } => sniper(v, *conditional, cap),
            Strat::SybilLead { round, tried_big } => {
                if v.round + 1 == *round && !*tried_big {
                    *tried_big = true;
                    return vec![Action::Commit(4 * cap)];
                }
                once(v.round == *round, cap)
            }
            Strat::Sybil { round } => once(v.round == *round, cap),
            Strat::Flipper { round } => flipper(v, *round, cap),
        }
    }
}

fn once(cond: bool, amount: u128) -> Vec<Action> {
    if cond {
        vec![Action::Commit(amount)]
    } else {
        vec![]
    }
}

/// Whale: a far-too-large commit first (refused), then the cap, then periodic top-up attempts (refused).
fn whale(v: &View, start: u32, cap: u128) -> Vec<Action> {
    if v.round == start {
        return vec![Action::Commit(10 * cap)];
    }
    if v.round == start + 1 {
        return vec![Action::Commit(cap)];
    }
    if v.round > start + 1 && (v.round - start).is_multiple_of(6) && v.round < COMMIT_END {
        return vec![Action::Commit(50 * USDC)];
    }
    vec![]
}

/// The rescuer commits only when the book is failing and one wallet cap would be enough to make it pass.
fn rescue_possible(v: &View, cap: u128) -> bool {
    !v.passing() && v.total + cap >= v.soft_cap && v.funders + 1 >= v.min_funders
}

/// Sniper: last commit round only; also tries again after close (refused).
fn sniper(v: &View, conditional: bool, cap: u128) -> Vec<Action> {
    if v.round == COMMIT_END - 1 && (!conditional || rescue_possible(v, cap)) {
        return vec![Action::Commit(cap)];
    }
    if v.round == COMMIT_END + 1 {
        return vec![Action::Commit(cap)];
    }
    vec![]
}

/// Walk-flipper: commit the cap, then on the last tail round Walk iff that single Walk flips PASS to FAIL.
fn flipper(v: &View, round: u32, cap: u128) -> Vec<Action> {
    if v.round == round {
        return vec![Action::Commit(cap)];
    }
    if v.round == WALK_END - 1 && v.own_open > 0 && v.passing() {
        let soft_flip = v.total - v.own_open < v.soft_cap;
        let funder_flip = v.funders - 1 < v.min_funders;
        if soft_flip || funder_flip {
            return vec![Action::Walk];
        }
    }
    vec![]
}

/// Build the 16-agent roster. Order is fixed: 7 honest, 2 whales, 2 snipers, 4 sybils, 1 flipper.
pub fn roster(rng: &mut Rng, wallet_cap: u128, honest_pct: u64) -> Vec<Agent> {
    // Honest budgets scale with the crowd temperature (percent), floored at min buy so every honest agent can act.
    let mut budget = |lo: u64, hi: u64| (rng.range(lo, hi) * honest_pct / 100).max(20) as u128 * USDC;
    let h = |id, label, budget, strat| Agent { id, label, group: Group::Honest, budget, strat };
    let (b1, b2, b3, b4, b5, b6, b7) =
        (budget(60, 100), budget(40, 80), budget(40, 100), budget(60, 100), budget(20, 40), budget(40, 100), budget(40, 100));
    let r1 = rng.range(0, 3) as u32;
    let r5 = rng.range(12, 16) as u32;
    let r_fill = rng.range(0, 3) as u32;
    let dca = [2, 5, 8, 11];
    let y = [rng.range(2, 4) as u32, rng.range(6, 8) as u32, rng.range(10, 12) as u32, rng.range(14, 16) as u32];
    let a = |id, label, group, budget, strat| Agent { id, label, group, budget, strat };
    let whale_budget = 10 * wallet_cap;
    vec![
        h("H1", "steady", b1, Strat::Steady { round: r1 }),
        h("H2", "dca", b2, Strat::Dca { rounds: dca, next: 0 }),
        h("H3", "cautious", b3, Strat::Cautious { done: false }),
        h("H4", "fill-averse", b4, Strat::FillAverse { round: r_fill }),
        h("H5", "small", b5, Strat::Small { round: r5 }),
        h("H6", "top-up", b6, Strat::TopUp { second: false }),
        h("H7", "nervous", b7, Strat::Nervous { round: 6 }),
        a("W1", "whale", Group::Whale, whale_budget, Strat::Whale { start: 0 }),
        a("W2", "whale", Group::Whale, whale_budget, Strat::Whale { start: 8 }),
        a("S1", "sniper-rescuer", Group::Sniper, wallet_cap, Strat::Sniper { conditional: true }),
        a("S2", "sniper", Group::Sniper, wallet_cap, Strat::Sniper { conditional: false }),
        a("Y1", "sybil-lead", Group::Sybil, wallet_cap, Strat::SybilLead { round: y[0], tried_big: false }),
        a("Y2", "sybil", Group::Sybil, wallet_cap, Strat::Sybil { round: y[1] }),
        a("Y3", "sybil", Group::Sybil, wallet_cap, Strat::Sybil { round: y[2] }),
        a("Y4", "sybil", Group::Sybil, wallet_cap, Strat::Sybil { round: y[3] }),
        a("F", "walk-flipper", Group::Flipper, wallet_cap, Strat::Flipper { round: 4 }),
    ]
}
