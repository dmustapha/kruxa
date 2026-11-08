//! Settlement of a book: the real kruxa-logic `verdict`, `allocate` and `settle_position`. Pure; does not mutate the book.
use crate::book::Book;
use kruxa_logic::{allocate, settle_position, verdict, Allocation, Outcome, VerdictInputs};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PosOut {
    pub idx: usize,
    pub commit: u128,
    pub spend: u128,
    pub refund: u128,
    pub tokens: u128,
    pub bonus: u128,
}

#[derive(Clone, Debug)]
pub struct Settlement {
    pub inputs: VerdictInputs,
    pub outcome: Outcome,
    pub alloc: Option<Allocation>,
    pub positions: Vec<PosOut>,
}

/// Settle the book as of now. FAIL refunds everyone in full; PASS allocates by uniform price with pro-rata refunds.
pub fn settle(book: &Book) -> Settlement {
    let inputs = book.inputs();
    let outcome = verdict(&inputs);
    let open: Vec<(usize, u128)> = book.accts.iter().enumerate().filter(|(_, a)| a.open > 0).map(|(i, a)| (i, a.open)).collect();
    if outcome != Outcome::Pass {
        let positions = open.iter().map(|(i, c)| PosOut { idx: *i, commit: *c, spend: 0, refund: *c, tokens: 0, bonus: 0 }).collect();
        return Settlement { inputs, outcome, alloc: None, positions };
    }
    let (p, r) = (&book.params, &book.rules);
    let alloc = allocate(inputs.total_active, p.hard_cap, p.sale_bps, p.lp_bps, r).expect("allocate on validated params");
    let positions = open
        .iter()
        .map(|(i, c)| {
            let s = settle_position(*c, inputs.total_active, alloc.accepted, book.derived.n_sale, book.derived.n_backer)
                .expect("settle_position on validated params");
            PosOut { idx: *i, commit: *c, spend: s.spend, refund: s.refund, tokens: s.tokens, bonus: s.bonus }
        })
        .collect();
    Settlement { inputs, outcome, alloc: Some(alloc), positions }
}

pub fn outcome_str(o: Outcome) -> String {
    match o {
        Outcome::Pass => "PASS".to_string(),
        Outcome::Fail(bits) => {
            let mut v = vec![];
            if bits & kruxa_logic::verdict::BELOW_SOFT_CAP != 0 {
                v.push("BELOW_SOFT_CAP");
            }
            if bits & kruxa_logic::verdict::BELOW_MIN_FUNDERS != 0 {
                v.push("BELOW_MIN_FUNDERS");
            }
            if bits & kruxa_logic::verdict::CANCELLED != 0 {
                v.push("CANCELLED");
            }
            format!("FAIL({})", v.join("|"))
        }
    }
}
