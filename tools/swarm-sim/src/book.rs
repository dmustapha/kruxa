//! The trial book: positions, ledger counters, and the admission rules. Admission mirrors the contract's
//! `check_commit` and `walk_inner` (same rule codes, same clocks from kruxa-logic). The verdict and the
//! allocation are NOT here: they live in `settle.rs` and call kruxa-logic.
use kruxa_logic::{phase_at, validate_params, walk_window_open, Derived, Phase, RuleCode, Rules, TrialParams, VerdictInputs};

pub const USDC: u128 = 1_000_000;
pub const OPENS_AT: u64 = 0;
pub const COMMIT_END: u64 = 20;
pub const WALK_END: u64 = 24;
pub const ROUNDS: u32 = 24;
/// The same boundaries as round numbers.
pub const COMMIT_END_R: u32 = COMMIT_END as u32;
pub const WALK_END_R: u32 = WALK_END as u32;

#[derive(Clone, Debug)]
pub struct Acct {
    pub wallet: u128,
    pub open: u128,
    pub peak: u128,
    pub walked_amount: u128,
    pub walked_round: Option<u32>,
    pub refused: Vec<(u32, &'static str)>,
}

#[derive(Clone, Debug)]
pub struct Book {
    pub rules: Rules,
    pub params: TrialParams,
    pub derived: Derived,
    pub accts: Vec<Acct>,
    pub initial_funds: u128,
    /// Running counters, updated on each commit and walk exactly like the contract's `total_active` and `active_funders`.
    pub ledger_total: u128,
    pub ledger_funders: u32,
}

impl Book {
    pub fn new(params: TrialParams, rules: Rules, budgets: &[u128]) -> Result<Book, String> {
        let derived = validate_params(&params, &rules, u128::MAX, false).map_err(|v| v.message())?;
        let accts: Vec<Acct> =
            budgets.iter().map(|b| Acct { wallet: *b, open: 0, peak: 0, walked_amount: 0, walked_round: None, refused: vec![] }).collect();
        Ok(Book { rules, params, derived, accts, initial_funds: budgets.iter().sum(), ledger_total: 0, ledger_funders: 0 })
    }

    pub fn phase(&self, now: u64) -> Phase {
        phase_at(now, OPENS_AT, COMMIT_END, WALK_END)
    }

    pub fn holders(&self) -> u32 {
        self.accts.iter().filter(|a| a.open > 0).count() as u32
    }

    /// Admission checks in the contract's order. Err carries the rule code string.
    pub fn check_commit(&self, i: usize, amount: u128, now: u64) -> Result<(), &'static str> {
        if self.phase(now) != Phase::Open {
            return Err(RuleCode::RWrongPhase.as_str());
        }
        if amount < self.params.min_buy {
            return Err(RuleCode::RMinContribution.as_str());
        }
        if self.accts[i].open + amount > self.derived.wallet_cap {
            return Err(RuleCode::RCapAccount.as_str());
        }
        if self.accts[i].open == 0 && self.holders() >= self.derived.max_holders {
            return Err(RuleCode::RCapHolders.as_str());
        }
        if self.ledger_total + amount > self.derived.max_total_held {
            return Err(RuleCode::RCapLaunch.as_str());
        }
        if self.accts[i].wallet < amount {
            return Err("NO_FUNDS");
        }
        Ok(())
    }

    pub fn commit(&mut self, i: usize, amount: u128, now: u64) -> Result<(), &'static str> {
        self.check_commit(i, amount, now)?;
        let a = &mut self.accts[i];
        if a.open == 0 {
            self.ledger_funders += 1;
        }
        a.wallet -= amount;
        a.open += amount;
        a.peak = a.peak.max(a.open);
        self.ledger_total += amount;
        Ok(())
    }

    /// Walk: whole position back to the wallet. Open from opens_at until walk_end (exclusive).
    pub fn walk(&mut self, i: usize, now: u64) -> Result<u128, &'static str> {
        if !walk_window_open(now, OPENS_AT, WALK_END) {
            return Err(RuleCode::RWalkClosed.as_str());
        }
        let a = &mut self.accts[i];
        if a.open == 0 {
            return Err(RuleCode::RNoPosition.as_str());
        }
        let amt = a.open;
        a.wallet += amt;
        a.open = 0;
        a.walked_round = Some(now as u32);
        a.walked_amount += amt;
        self.ledger_total -= amt;
        self.ledger_funders -= 1;
        Ok(amt)
    }

    pub fn log_refusal(&mut self, i: usize, round: u32, code: &'static str) {
        self.accts[i].refused.push((round, code));
    }

    /// Verdict inputs from the ledger counters (what the contract passes to `verdict`).
    pub fn inputs(&self) -> VerdictInputs {
        VerdictInputs {
            launch_id: 1,
            charter_hash: [7u8; 32],
            total_active: self.ledger_total,
            active_funders: self.ledger_funders,
            soft_cap: self.params.soft_cap,
            min_funders: self.params.min_funders,
            cancelled: false,
        }
    }

    /// Same inputs recomputed from the positions, for the checker.
    pub fn inputs_recomputed(&self) -> VerdictInputs {
        VerdictInputs { total_active: self.accts.iter().map(|a| a.open).sum(), active_funders: self.holders(), ..self.inputs() }
    }
}
