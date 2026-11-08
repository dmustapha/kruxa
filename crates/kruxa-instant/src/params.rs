//! Instant-launch parameters, the supply split and the rule check. Every violation carries a stable `R_*` code.
use crate::code;
use borsh::{BorshDeserialize, BorshSerialize};
use kruxa_logic::{validate_all, FeeTerms, Rules, TrialParams};
use kruxa_market::validate_market_terms;
use kruxa_math::{dec, mul_div_floor, BPS};
use serde::{Deserialize, Serialize};

/// The trial default total supply (`TrialParams::example`); a test pins this to the trial's number.
pub const TOTAL_SUPPLY_WHOLE: u64 = 1_000_000_000;
pub const TOKEN_DECIMALS: u8 = 6;

pub const MAX_ALLOC_BPS: u16 = 1_000;
pub const DEFAULT_ALLOC_BPS: u16 = 500;
pub const MIN_CLIFF_DAYS: u16 = 7;
pub const MAX_CLIFF_DAYS: u16 = 30;
pub const DEFAULT_CLIFF_DAYS: u16 = 7;
pub const MIN_VEST_DAYS: u16 = 30;
pub const MAX_VEST_DAYS: u16 = 365;
pub const DEFAULT_VEST_DAYS: u16 = 90;
/// $100 and $1,000 in micro-USDC (CO-7 D-4).
pub const MIN_SEED_Q: u128 = 100_000_000;
pub const MAX_SEED_Q: u128 = 1_000_000_000;
pub const DEFAULT_SEED_Q: u128 = 250_000_000;
pub const MAX_DELAY_SECS: u32 = 3_600;
pub const DEFAULT_DELAY_SECS: u32 = 600;

/// Standard 50/15/15/10/10 split, 1.00% total, with the DN-26 opening decay (500 bps over 60 minutes).
pub fn default_fees() -> FeeTerms {
    FeeTerms { opening_fee_start_bps: 500, opening_decay_minutes: 60, ..FeeTerms::standard() }
}

fn d_alloc() -> u16 {
    DEFAULT_ALLOC_BPS
}
fn d_cliff() -> u16 {
    DEFAULT_CLIFF_DAYS
}
fn d_vest() -> u16 {
    DEFAULT_VEST_DAYS
}
fn d_seed() -> u128 {
    DEFAULT_SEED_Q
}
fn d_delay() -> u32 {
    DEFAULT_DELAY_SECS
}

/// What the creator passes to `create_instant`. Omitted fields take the defaults.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct InstantParams {
    pub name: String,
    pub symbol: String,
    #[serde(default = "d_alloc")]
    pub creator_alloc_bps: u16,
    #[serde(default = "d_cliff")]
    pub cliff_days: u16,
    #[serde(default = "d_vest")]
    pub vest_days: u16,
    #[serde(with = "dec::u128", default = "d_seed")]
    pub seed_q: u128,
    #[serde(default = "default_fees")]
    pub fees: FeeTerms,
    #[serde(default = "d_delay")]
    pub trade_delay_secs: u32,
}

impl InstantParams {
    pub fn example(symbol: &str) -> Self {
        InstantParams {
            name: format!("{symbol} Coin"),
            symbol: symbol.to_string(),
            creator_alloc_bps: d_alloc(),
            cliff_days: d_cliff(),
            vest_days: d_vest(),
            seed_q: d_seed(),
            fees: default_fees(),
            trade_delay_secs: d_delay(),
        }
    }
}

/// Live limits the contract passes in (caps move behind the 7-day timelock; the launch fee depends on the profile).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub seed_min: u128,
    pub seed_max: u128,
    pub launch_fee: u128,
}

impl Limits {
    pub fn standard(launch_fee: u128) -> Self {
        Limits { seed_min: MIN_SEED_Q, seed_max: MAX_SEED_Q, launch_fee }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    pub code: String,
    pub field: String,
    pub got: String,
    pub limit: String,
}

impl Violation {
    fn new(code: &str, field: &str, got: impl ToString, limit: impl ToString) -> Self {
        Violation { code: code.to_string(), field: field.to_string(), got: got.to_string(), limit: limit.to_string() }
    }

    /// `R_X: field = got violates limit`, the panic text of a user call.
    pub fn message(&self) -> String {
        format!("{}: {} = {} violates {}", self.code, self.field, self.got, self.limit)
    }
}

/// Everything derived from validated params, in base units / micro-USDC.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Derived {
    #[serde(with = "dec::u128")]
    pub n_total: u128,
    #[serde(with = "dec::u128")]
    pub n_alloc: u128,
    #[serde(with = "dec::u128")]
    pub n_pool: u128,
    #[serde(with = "dec::u128")]
    pub launch_fee: u128,
    #[serde(with = "dec::u128")]
    pub pool_seed_q: u128,
    /// micro-USDC per whole token at the opening reserves.
    #[serde(with = "dec::u128")]
    pub open_price: u128,
}

const RESERVED_SYMBOLS: [&str; 9] = ["KRUXA", "USDC", "USDT", "NEAR", "WNEAR", "SOL", "ETH", "BTC", "DAI"];

/// The built-in reserved list (the same nine symbols core refuses). The contract adds the owner's list.
pub fn is_reserved_symbol(symbol: &str) -> bool {
    RESERVED_SYMBOLS.contains(&symbol)
}

pub fn total_supply_base() -> u128 {
    (TOTAL_SUPPLY_WHOLE as u128) * 10u128.pow(TOKEN_DECIMALS as u32)
}

fn check_text(p: &InstantParams, out: &mut Vec<Violation>) {
    let sym_ok = (2..=12).contains(&p.symbol.len()) && p.symbol.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    if !sym_ok {
        out.push(Violation::new(code::SYMBOL, "symbol", &p.symbol, "2..=12 of [A-Z0-9]"));
    } else if is_reserved_symbol(&p.symbol) {
        out.push(Violation::new(code::SYMBOL_RESERVED, "symbol", &p.symbol, "not a reserved symbol"));
    }
    if p.name.is_empty() || p.name.len() > 32 || !p.name.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        out.push(Violation::new(code::SYMBOL, "name", &p.name, "1..=32 printable ASCII"));
    }
}

fn check_schedule(p: &InstantParams, out: &mut Vec<Violation>) {
    if p.creator_alloc_bps > MAX_ALLOC_BPS {
        out.push(Violation::new(code::ALLOC, "creator_alloc_bps", p.creator_alloc_bps, format!("0..={MAX_ALLOC_BPS}")));
    }
    if !(MIN_VEST_DAYS..=MAX_VEST_DAYS).contains(&p.vest_days) {
        out.push(Violation::new(code::VEST, "vest_days", p.vest_days, format!("{MIN_VEST_DAYS}..={MAX_VEST_DAYS}")));
    }
    if !(MIN_CLIFF_DAYS..=MAX_CLIFF_DAYS).contains(&p.cliff_days) {
        out.push(Violation::new(code::VEST, "cliff_days", p.cliff_days, format!("{MIN_CLIFF_DAYS}..={MAX_CLIFF_DAYS}")));
    } else if p.cliff_days > p.vest_days {
        out.push(Violation::new(code::VEST, "cliff_days", p.cliff_days, format!("<= vest_days {}", p.vest_days)));
    }
}

fn check_money(p: &InstantParams, l: &Limits, out: &mut Vec<Violation>) {
    if p.seed_q < l.seed_min || p.seed_q > l.seed_max {
        out.push(Violation::new(code::SEED_RANGE, "seed_q", p.seed_q, format!("{}..={}", l.seed_min, l.seed_max)));
    } else if p.seed_q <= l.launch_fee {
        out.push(Violation::new(code::SEED_RANGE, "seed_q", p.seed_q, format!("> launch fee {}", l.launch_fee)));
    }
    if p.trade_delay_secs > MAX_DELAY_SECS {
        out.push(Violation::new(code::DELAY, "trade_delay_secs", p.trade_delay_secs, format!("0..={MAX_DELAY_SECS}")));
    }
}

/// Fee rules: the trial's fine-grained codes (run through `validate_all` on a stand-in TrialParams, keeping only the fee
/// violations), then the market's own check, which is the authority the pool will apply.
fn check_fees(fees: &FeeTerms, out: &mut Vec<Violation>) {
    let stand_in = TrialParams { fees: fees.clone(), ..TrialParams::example("ABCD") };
    let fee_codes = [
        "R_FEE_TOTAL", "R_CREATOR_SHARE", "R_CREATOR_TAKE", "R_PLATFORM_FLOOR", "R_PLATFORM_FIXED", "R_HOLDER_RANGE", "R_LP_RANGE",
        "R_HOLDER_LP_FLOOR", "R_REFERRAL", "R_SPLIT_SUM", "R_FEE_VEST", "R_OPENING",
    ];
    let before = out.len();
    for v in validate_all(&stand_in, &Rules::ladder(), u128::MAX, true) {
        if fee_codes.contains(&v.code.as_str()) {
            out.push(Violation::new(v.code.as_str(), v.field, v.got, v.limit));
        }
    }
    if out.len() == before && validate_market_terms(fees).is_err() {
        out.push(Violation::new(code::FEE_TERMS, "fees", "terms", "market fee-terms rules"));
    }
}

/// Every violation, in a fixed order (text, schedule, money, fees). Empty = valid.
pub fn validate_instant(p: &InstantParams, l: &Limits) -> Vec<Violation> {
    let mut out = Vec::new();
    check_text(p, &mut out);
    check_schedule(p, &mut out);
    check_money(p, l, &mut out);
    check_fees(&p.fees, &mut out);
    out
}

/// Validates, then derives the split. The supply is exact: `n_alloc + n_pool == n_total`, no dust.
pub fn derive(p: &InstantParams, l: &Limits) -> Result<Derived, Vec<Violation>> {
    let v = validate_instant(p, l);
    if !v.is_empty() {
        return Err(v);
    }
    let math = |_| vec![Violation::new(code::MATH, "split", "overflow", "no overflow")];
    let n_total = total_supply_base();
    let n_alloc = mul_div_floor(n_total, p.creator_alloc_bps as u128, BPS).map_err(math)?;
    let n_pool = n_total - n_alloc;
    let pool_seed_q = p.seed_q - l.launch_fee;
    let open_price = mul_div_floor(pool_seed_q, 10u128.pow(TOKEN_DECIMALS as u32), n_pool).map_err(math)?;
    Ok(Derived { n_total, n_alloc, n_pool, launch_fee: l.launch_fee, pool_seed_q, open_price })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn lim() -> Limits {
        Limits::standard(0)
    }

    fn first_code(p: &InstantParams, l: &Limits) -> String {
        validate_instant(p, l).first().map(|v| v.code.clone()).unwrap_or_default()
    }

    #[test]
    fn supply_constant_is_the_trial_default() {
        assert_eq!(TOTAL_SUPPLY_WHOLE, TrialParams::example("ABCD").total_supply_whole);
        assert_eq!(TOKEN_DECIMALS, Rules::ladder().decimals);
    }

    #[test]
    fn the_defaults_are_valid_and_split_exactly() {
        let p = InstantParams::example("MYC");
        assert!(validate_instant(&p, &lim()).is_empty(), "{:?}", validate_instant(&p, &lim()));
        let d = derive(&p, &lim()).unwrap();
        assert_eq!(d.n_total, 1_000_000_000_000_000);
        assert_eq!(d.n_alloc, 50_000_000_000_000);
        assert_eq!(d.n_pool, 950_000_000_000_000);
        assert_eq!(d.pool_seed_q, 250_000_000);
    }

    #[test]
    fn the_launch_fee_comes_out_of_the_seed() {
        let d = derive(&InstantParams::example("MYC"), &Limits::standard(10_000_000)).unwrap();
        assert_eq!((d.launch_fee, d.pool_seed_q), (10_000_000, 240_000_000));
    }

    #[test]
    fn json_defaults_fill_omitted_fields() {
        let p: InstantParams = serde_json::from_str(r#"{"name":"A Coin","symbol":"ACN"}"#).unwrap();
        assert_eq!(p, InstantParams { name: "A Coin".into(), ..InstantParams::example("ACN") });
        let q: InstantParams = serde_json::from_str(r#"{"name":"A Coin","symbol":"ACN","seed_q":"500000000"}"#).unwrap();
        assert_eq!(q.seed_q, 500_000_000);
    }

    /// One failing case per rule code.
    #[test]
    fn each_rule_code_has_a_failing_case() {
        let base = InstantParams::example("MYC");
        let cases: Vec<(&str, InstantParams)> = vec![
            (code::SYMBOL, InstantParams { symbol: "x".into(), ..base.clone() }),
            (code::SYMBOL, InstantParams { symbol: "lower".into(), ..base.clone() }),
            (code::SYMBOL, InstantParams { name: String::new(), ..base.clone() }),
            (code::SYMBOL_RESERVED, InstantParams { symbol: "KRUXA".into(), ..base.clone() }),
            (code::ALLOC, InstantParams { creator_alloc_bps: 1_001, ..base.clone() }),
            (code::VEST, InstantParams { vest_days: 29, ..base.clone() }),
            (code::VEST, InstantParams { vest_days: 366, ..base.clone() }),
            (code::VEST, InstantParams { cliff_days: 6, ..base.clone() }),
            (code::VEST, InstantParams { cliff_days: 31, vest_days: 365, ..base.clone() }),
            (code::SEED_RANGE, InstantParams { seed_q: 99_999_999, ..base.clone() }),
            (code::SEED_RANGE, InstantParams { seed_q: 1_000_000_001, ..base.clone() }),
            (code::DELAY, InstantParams { trade_delay_secs: 3_601, ..base.clone() }),
            ("R_FEE_TOTAL", InstantParams { fees: FeeTerms { total_fee_bps: 201, ..default_fees() }, ..base.clone() }),
            ("R_SPLIT_SUM", InstantParams { fees: FeeTerms { referral_bps: 900, ..default_fees() }, ..base.clone() }),
            ("R_OPENING", InstantParams { fees: FeeTerms { opening_decay_minutes: 0, ..default_fees() }, ..base.clone() }),
        ];
        for (want, p) in cases {
            assert!(validate_instant(&p, &lim()).iter().any(|v| v.code == want), "{want} not raised for {p:?}");
        }
        assert_eq!(first_code(&InstantParams { seed_q: 10_000_000, ..base.clone() }, &Limits { seed_min: 1, ..Limits::standard(10_000_000) }), code::SEED_RANGE);
    }

    #[test]
    fn violations_are_collected_not_just_the_first() {
        let p = InstantParams { creator_alloc_bps: 2_000, vest_days: 5, ..InstantParams::example("MYC") };
        let codes: Vec<String> = validate_instant(&p, &lim()).into_iter().map(|v| v.code).collect();
        assert!(codes.contains(&"R_ALLOC".to_string()) && codes.contains(&"R_VEST".to_string()), "{codes:?}");
    }

    proptest! {
        #[test]
        fn split_is_exact_for_every_allocation(bps in 0u16..=1_000) {
            let p = InstantParams { creator_alloc_bps: bps, ..InstantParams::example("MYC") };
            let d = derive(&p, &lim()).unwrap();
            prop_assert_eq!(d.n_alloc + d.n_pool, d.n_total);
            prop_assert!(d.n_alloc <= d.n_total / 10);
            prop_assert_eq!(d.n_alloc, d.n_total * bps as u128 / 10_000);
        }

        #[test]
        fn allocation_above_ten_percent_is_always_refused(bps in 1_001u16..=u16::MAX) {
            let p = InstantParams { creator_alloc_bps: bps, ..InstantParams::example("MYC") };
            prop_assert!(derive(&p, &lim()).is_err());
        }

        #[test]
        fn seed_range_is_exact(seed in 0u128..=2_000_000_000u128, fee in prop::sample::select(vec![0u128, 10_000_000])) {
            let l = Limits::standard(fee);
            let p = InstantParams { seed_q: seed, ..InstantParams::example("MYC") };
            let ok = derive(&p, &l).is_ok();
            prop_assert_eq!(ok, (MIN_SEED_Q..=MAX_SEED_Q).contains(&seed) && seed > fee);
        }
    }
}
