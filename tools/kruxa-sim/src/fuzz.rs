//! `kruxa-sim fuzz`: random books through the contract's own settlement arithmetic, checking the money identities.
//! Deterministic for a given `--seed` (xorshift64*), so a failure reproduces.
use crate::cli::*;
use kruxa_logic::{allocate, settle_position, Rules};

pub const SPEC: Spec = Spec { values: &["n", "seed"], optional_values: &[], switches: &[] };

const N_SALE: u128 = 600_000_000_000_000;
const N_BACKER: u128 = 50_000_000_000_000;
const USDC: u128 = 1_000_000;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn between(&mut self, lo: u128, hi: u128) -> u128 {
        lo + u128::from(self.next()) % (hi - lo + 1)
    }
    fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            v.swap(i, self.between(0, i as u128) as usize);
        }
    }
}

#[derive(Default)]
struct Tally {
    conservation: u64,
    order: u64,
    no_overpay: u64,
    worst_residue: u128,
    worst_dust: u128,
}

/// One book. Returns Err(name of the broken identity).
fn trial(rng: &mut Rng, t: &mut Tally) -> Result<(), &'static str> {
    let rules = Rules::ladder();
    let hard = rng.between(500, 1_000) * USDC;
    let commits: Vec<u128> = (0..rng.between(10, 100)).map(|_| rng.between(20, 100) * USDC + u128::from(rng.next() % 1_000_000)).collect();
    let total: u128 = commits.iter().sum();
    if total < 350 * USDC || total > hard * 2 {
        return Ok(()); // not a passable or admissible book; counted by the caller as skipped
    }
    let a = allocate(total, hard, 6_000, 2_500, &rules).map_err(|_| "allocate")?;
    let each = |order: &[u128]| -> Result<Vec<(u128, u128, u128, u128)>, &'static str> {
        order
            .iter()
            .map(|c| {
                settle_position(*c, total, a.accepted, N_SALE, N_BACKER).map(|s| (*c, s.spend, s.refund, s.tokens)).map_err(|_| "settle")
            })
            .collect()
    };
    let rows = each(&commits)?;
    let (spend, refund, tokens): (u128, u128, u128) = rows.iter().fold((0, 0, 0), |x, r| (x.0 + r.1, x.1 + r.2, x.2 + r.3));
    if a.launch_fee + a.lp_quote + a.stream + a.excess_pool != total || spend + refund != total || rows.iter().any(|r| r.1 + r.2 != r.0) {
        return Err("conservation");
    }
    t.conservation += 1;
    if spend < a.accepted || refund > a.excess_pool || tokens > N_SALE {
        return Err("no-overpay");
    }
    t.no_overpay += 1;
    let mut shuffled = commits.clone();
    rng.shuffle(&mut shuffled);
    let mut again = each(&shuffled)?;
    let mut sorted = rows.clone();
    sorted.sort();
    again.sort();
    if again != sorted {
        return Err("order-independence");
    }
    t.order += 1;
    t.worst_residue = t.worst_residue.max(spend - a.accepted);
    t.worst_dust = t.worst_dust.max(N_SALE - tokens);
    Ok(())
}

pub fn run(args: &[String]) -> ! {
    let f = parse_flags(args, &SPEC);
    let n: u64 = if f.contains_key("n") { num(&f, "n") } else { 1_000 };
    let seed: u64 = if f.contains_key("seed") { num(&f, "seed") } else { 1 };
    let mut rng = Rng(seed.max(1));
    let (mut t, mut run_books) = (Tally::default(), 0u64);
    while run_books < n {
        let before = t.conservation;
        if let Err(name) = trial(&mut rng, &mut t) {
            println!("FAILED {name} at book {run_books} (seed {seed})");
            std::process::exit(EXIT_SELF_TEST);
        }
        run_books += u64::from(t.conservation > before);
    }
    println!("worst rounding residue {} micro-USDC, worst token dust {} base units", t.worst_residue, t.worst_dust);
    println!("order-independence {}/{n} ok", t.order);
    println!("no-overpay {}/{n} ok", t.no_overpay);
    println!("conservation {}/{n} ok", t.conservation);
    std::process::exit(EXIT_MATCH)
}
