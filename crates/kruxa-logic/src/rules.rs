use borsh::{BorshDeserialize, BorshSerialize};
use kruxa_math::{dec, mul_div_ceil, MathError};
use serde::{Deserialize, Serialize};

use crate::STORAGE_BYTE_COST_YOCTO;

/// Append-only. The Borsh tag is the index; never reorder. Message format is always "CODE: text".
#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum RuleCode {
    RSymbol,
    RSupply,
    RBuckets,
    RAlloc,
    RHardCap,
    RSoftCap,
    RMinBuy,
    RWalletCap,
    RFunders,
    RPassable,
    RWindow,
    RStream,
    RCapGlobal,
    RCapLaunch,
    RActiveTrial,
    RDeposit,
    RPaused,
    RFrozen,
    RWrongPhase,
    RNotAuthorized,
    RMath,
    RUnexpectedToken,
    RTokenCreate,
    RMinContribution,
    RCapAccount,
    RCapHolders,
    RSelfBuy,
    RDeliver,
    RNoPosition,
    RSignedMsg,
    RSig,
    RNonce,
    RDeadline,
    RNothingFree,
    RNotClear,
    RTooEarly,
    RTooLate,
    RWalkClosed,
    RRelayFee,
    RSolvency,
    RNothing,
    RNotYet,
    RNoLaunch,
    RFeeTotal,
    RCreatorShare,
    RCreatorTake,
    RPlatformFloor,
    RPlatformFixed,
    RHolderRange,
    RLpRange,
    RHolderLpFloor,
    RReferral,
    RSplitSum,
    RFeeVest,
    ROpening,
    /// D-1: the mainnet creator gate is closed; only the owner can create until `open_beta`.
    RCreatorGate,
    RGenesisState,
    RGenesisAlready,
    RGenesisAuth,
    RGenesisArg,
    RGenesisOrder,
    RGenesisLeaf,
    /// The stream must start at zero (PRD gap 17): nothing is drawable at the verdict instant.
    RStreamInit,
    /// Payee list: 1..=10, unique accounts, each bps above zero, sum 10_000.
    RPayees,
    /// Creator allocation schedule: cliff floor, total span floor and ceiling.
    RVest,
    /// `burn_mode` Burn is not available: the testnet factory token has no `ft_burn` (evidence/factory-probe.txt).
    RBurnUnsupported,
    /// One launch is halted by governance: new commits and creator-side payouts stop, exits stay open.
    RHalted,
    RLengthenOnly,
    RBatchSize,
    RUpgradeHash,
}

impl RuleCode {
    pub fn as_str(&self) -> &'static str {
        use RuleCode::*;
        match self {
            RSymbol => "R_SYMBOL",
            RSupply => "R_SUPPLY",
            RBuckets => "R_BUCKETS",
            RAlloc => "R_ALLOC",
            RHardCap => "R_HARD_CAP",
            RSoftCap => "R_SOFT_CAP",
            RMinBuy => "R_MIN_BUY",
            RWalletCap => "R_WALLET_CAP",
            RFunders => "R_FUNDERS",
            RPassable => "R_PASSABLE",
            RWindow => "R_WINDOW",
            RStream => "R_STREAM",
            RCapGlobal => "R_CAP_GLOBAL",
            RCapLaunch => "R_CAP_LAUNCH",
            RActiveTrial => "R_ACTIVE_TRIAL",
            RDeposit => "R_DEPOSIT",
            RPaused => "R_PAUSED",
            RFrozen => "R_FROZEN",
            RWrongPhase => "R_WRONG_PHASE",
            RNotAuthorized => "R_NOT_AUTHORIZED",
            RMath => "R_MATH",
            RUnexpectedToken => "R_UNEXPECTED_TOKEN",
            RTokenCreate => "R_TOKEN_CREATE",
            RMinContribution => "R_MIN_CONTRIBUTION",
            RCapAccount => "R_CAP_ACCOUNT",
            RCapHolders => "R_CAP_HOLDERS",
            RSelfBuy => "R_SELF_BUY",
            RDeliver => "R_DELIVER",
            RNoPosition => "R_NO_POSITION",
            RSignedMsg => "R_SIGNED_MSG",
            RSig => "R_SIG",
            RNonce => "R_NONCE",
            RDeadline => "R_DEADLINE",
            RNothingFree => "R_NOTHING_FREE",
            RNotClear => "R_NOT_CLEAR",
            RTooEarly => "R_TOO_EARLY",
            RTooLate => "R_TOO_LATE",
            RWalkClosed => "R_WALK_CLOSED",
            RRelayFee => "R_RELAY_FEE",
            RSolvency => "R_SOLVENCY",
            RNothing => "R_NOTHING",
            RNotYet => "R_NOT_YET",
            RNoLaunch => "R_NO_LAUNCH",
            RFeeTotal => "R_FEE_TOTAL",
            RCreatorShare => "R_CREATOR_SHARE",
            RCreatorTake => "R_CREATOR_TAKE",
            RPlatformFloor => "R_PLATFORM_FLOOR",
            RPlatformFixed => "R_PLATFORM_FIXED",
            RHolderRange => "R_HOLDER_RANGE",
            RLpRange => "R_LP_RANGE",
            RHolderLpFloor => "R_HOLDER_LP_FLOOR",
            RReferral => "R_REFERRAL",
            RSplitSum => "R_SPLIT_SUM",
            RFeeVest => "R_FEE_VEST",
            ROpening => "R_OPENING",
            RCreatorGate => "R_CREATOR_GATE",
            RGenesisState => "R_GENESIS_STATE",
            RGenesisAlready => "R_GENESIS_ALREADY",
            RGenesisAuth => "R_GENESIS_AUTH",
            RGenesisArg => "R_GENESIS_ARG",
            RGenesisOrder => "R_GENESIS_ORDER",
            RGenesisLeaf => "R_GENESIS_LEAF",
            RStreamInit => "R_STREAM_INIT",
            RPayees => "R_PAYEES",
            RVest => "R_VEST",
            RBurnUnsupported => "R_BURN_UNSUPPORTED",
            RHalted => "R_HALTED",
            RLengthenOnly => "R_LENGTHEN_ONLY",
            RBatchSize => "R_BATCH_SIZE",
            RUpgradeHash => "R_UPGRADE_HASH",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleViolation {
    pub code: RuleCode,
    pub field: &'static str,
    pub got: String,
    pub limit: String,
}

impl RuleViolation {
    pub fn new(code: RuleCode, field: &'static str, got: impl ToString, limit: impl ToString) -> Self {
        Self { code, field, got: got.to_string(), limit: limit.to_string() }
    }
    /// "R_X: field = got violates limit". Always starts with the code so a UI or agent can match the prefix.
    pub fn message(&self) -> String {
        format!("{}: {} = {} violates {}", self.code.as_str(), self.field, self.got, self.limit)
    }
}

impl From<MathError> for RuleViolation {
    fn from(e: MathError) -> Self {
        RuleViolation::new(RuleCode::RMath, "math", format!("{:?}", e), "no overflow, no division by zero")
    }
}

/// The snapshot stored inside every Charter. USDC only, all money in micro-USDC (6 decimals).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Rules {
    pub rules_version: u16,
    pub decimals: u8,
    pub min_supply_whole: u64,
    pub max_supply_whole: u64,
    pub min_sale_bps: u16,
    pub max_sale_bps: u16,
    pub min_lp_bps: u16,
    pub max_lp_bps: u16,
    pub max_creator_bps: u16,
    pub max_backer_bps: u16,
    pub max_creator_plus_backer_bps: u16,
    #[serde(with = "dec::u128")]
    pub min_hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub max_hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub min_soft_abs: u128,
    pub min_soft_pct_bps: u16,
    #[serde(with = "dec::u128")]
    pub min_buy_abs: u128,
    pub min_buy_divisor: u32,
    pub wallet_bps_min: u16,
    pub wallet_bps_max: u16,
    pub wallet_floor_multiple: u32,
    pub funders_min: u32,
    pub funders_max: u32,
    pub min_commit_secs: u64,
    pub max_commit_secs: u64,
    pub min_tail_secs: u64,
    pub max_tail_secs: u64,
    pub max_open_delay_secs: u64,
    pub max_holders: u32,
    /// Oversubscription ceiling: total_active may reach hard_cap * max_oversub_bps / 10000 (liability cap per launch).
    pub max_oversub_bps: u32,
    #[serde(with = "dec::u128")]
    pub max_relay_fee_abs: u128,
    pub max_relay_fee_bps: u16,
    pub launch_fee_bps: u16,
    pub max_launch_fee_bps: u16,
    #[serde(with = "dec::u128")]
    pub launch_fee_min: u128,
    #[serde(with = "dec::u128")]
    pub launch_fee_max: u128,
    pub min_stream_days_small: u16,
    pub min_stream_days_large: u16,
    pub max_stream_days: u16,
    #[serde(with = "dec::u128")]
    pub stream_large_threshold: u128,
    /// 0 = bonus immediately claimable. Ruling 2026-11-07: 30-day linear.
    pub backer_vest_days: u16,
    // Fee-router ceilings (S1-A 6.2). The market that applies them is Wave 3; the Charter commits to them now.
    pub min_total_fee_bps: u16,
    pub max_total_fee_bps: u16,
    pub max_creator_share_bps: u16,
    /// Exact-integer form: total_fee_bps * creator_bps <= max_creator_take_bps * 10_000.
    pub max_creator_take_bps: u16,
    pub platform_bps: u16,
    pub min_platform_bps: u16,
    pub min_holders_bps: u16,
    pub max_holders_bps: u16,
    pub min_lp_fee_bps: u16,
    pub max_lp_fee_bps: u16,
    pub min_holders_plus_lp_bps: u16,
    pub max_referral_bps: u16,
    pub min_fee_vest_bps: u16,
    pub min_fee_vest_days: u16,
    pub max_fee_vest_days: u16,
    pub max_opening_fee_start_bps: u16,
    pub max_opening_decay_minutes: u16,
    /// Creator allocation (`creator_bps`): nothing is claimable before the cliff, then it vests linearly. Seconds from PASS.
    pub alloc_cliff_secs: u64,
    pub alloc_linear_secs: u64,
    /// R_VEST floors: cliff at least 14 days, cliff + linear between 180 and 1460 days (S1-A 6.2).
    pub min_alloc_cliff_secs: u64,
    pub min_alloc_total_secs: u64,
    pub max_alloc_total_secs: u64,
    /// Unclaimed backer bonus (and rounding dust) is released to `burn_mode` this long after the bonus vest ends.
    pub bonus_sweep_after_secs: u64,
}

const DAY_S: u64 = 86_400;
const USDC: u128 = 1_000_000;

impl Rules {
    /// Capped-ladder profile (RULING 2026-11-07): $1,000 per launch. The global $3,000 cap lives in Config.
    pub fn ladder() -> Self {
        Rules {
            rules_version: 1,
            decimals: 6,
            min_supply_whole: 10_000_000,
            max_supply_whole: 1_000_000_000_000,
            min_sale_bps: 5_000,
            max_sale_bps: 8_000,
            min_lp_bps: 1_500,
            max_lp_bps: 4_000,
            max_creator_bps: 2_000,
            max_backer_bps: 1_000,
            max_creator_plus_backer_bps: 2_500,
            min_hard_cap: 500 * USDC,
            max_hard_cap: 1_000 * USDC,
            min_soft_abs: 350 * USDC,
            min_soft_pct_bps: 2_000,
            min_buy_abs: 20 * USDC,
            min_buy_divisor: 500,
            wallet_bps_min: 50,
            wallet_bps_max: 500,
            wallet_floor_multiple: 5,
            funders_min: 10,
            funders_max: 500,
            min_commit_secs: 86_400,
            max_commit_secs: 2_592_000,
            min_tail_secs: 3_600,
            max_tail_secs: 172_800,
            max_open_delay_secs: 604_800,
            max_holders: 500,
            max_oversub_bps: 20_000,
            max_relay_fee_abs: USDC / 2,
            max_relay_fee_bps: 500,
            launch_fee_bps: 150,
            max_launch_fee_bps: 300,
            launch_fee_min: 10 * USDC,
            launch_fee_max: 2_500 * USDC,
            min_stream_days_small: 30,
            min_stream_days_large: 90,
            max_stream_days: 365,
            stream_large_threshold: 25_000 * USDC,
            backer_vest_days: 30,
            min_total_fee_bps: 30,
            max_total_fee_bps: 200,
            max_creator_share_bps: 6_000,
            max_creator_take_bps: 100,
            platform_bps: 1_500, // CO-5 D-4: was 2_000; DN-15 ruled platform 15% (equals the floor)
            min_platform_bps: 1_500,
            min_holders_bps: 1_000,
            max_holders_bps: 3_000,
            min_lp_fee_bps: 500,
            max_lp_fee_bps: 3_000,
            min_holders_plus_lp_bps: 2_000,
            max_referral_bps: 2_000,
            min_fee_vest_bps: 2_500,
            min_fee_vest_days: 30,
            max_fee_vest_days: 365,
            max_opening_fee_start_bps: 1_000,
            max_opening_decay_minutes: 120,
            alloc_cliff_secs: 30 * DAY_S,
            alloc_linear_secs: 365 * DAY_S,
            min_alloc_cliff_secs: 14 * DAY_S,
            min_alloc_total_secs: 180 * DAY_S,
            max_alloc_total_secs: 1_460 * DAY_S,
            bonus_sweep_after_secs: 180 * DAY_S,
        }
    }

    /// Labelled demo profile (separate account, same wasm): clock compressed. Hostile-preset checks unchanged.
    pub fn demo_clock() -> Self {
        Rules {
            min_commit_secs: 90,
            min_tail_secs: 30,
            alloc_cliff_secs: 20,
            alloc_linear_secs: 40,
            min_alloc_cliff_secs: 10,
            min_alloc_total_secs: 30,
            bonus_sweep_after_secs: 30,
            ..Rules::ladder()
        }
    }

    /// R_VEST: the creator allocation schedule this rule set would snapshot must respect the floors and the ceiling.
    pub fn check_alloc_vest(&self) -> Result<(), RuleViolation> {
        let total = self.alloc_cliff_secs.saturating_add(self.alloc_linear_secs);
        if self.alloc_cliff_secs < self.min_alloc_cliff_secs {
            return Err(RuleViolation::new(RuleCode::RVest, "alloc_cliff_secs", self.alloc_cliff_secs, "cliff floor"));
        }
        if total < self.min_alloc_total_secs || total > self.max_alloc_total_secs {
            return Err(RuleViolation::new(RuleCode::RVest, "alloc_cliff_secs+alloc_linear_secs", total, "total floor and ceiling"));
        }
        Ok(())
    }
}

/// R_STREAM_INIT: the amount drawable at the verdict instant must be zero (stream initial release is 0).
pub fn check_stream_init(drawable_at_verdict: u128) -> Result<(), RuleViolation> {
    if drawable_at_verdict != 0 {
        return Err(RuleViolation::new(RuleCode::RStreamInit, "stream_initial_release", drawable_at_verdict, "== 0"));
    }
    Ok(())
}

/// R_PAYEES: 1..=10 payees, no duplicate account, every share above zero, shares sum to exactly 10_000 bps.
pub fn check_payees<A: PartialEq>(payees: &[(A, u16)]) -> Result<(), RuleViolation> {
    let sum: u32 = payees.iter().map(|p| p.1 as u32).sum();
    let unique = payees.iter().enumerate().all(|(i, p)| payees[..i].iter().all(|q| q.0 != p.0));
    if payees.is_empty() || payees.len() > 10 || !unique || payees.iter().any(|p| p.1 == 0) || sum != 10_000 {
        let got = format!("{} payees, sum {}", payees.len(), sum);
        return Err(RuleViolation::new(RuleCode::RPayees, "payees", got, "1..=10 unique, each bps > 0, sum 10000"));
    }
    Ok(())
}

/// Trading-fee terms committed in the Charter. In Wave 1 they are validated and stored but INERT: the market contract
/// that applies them is Wave 3 (RECONCILED market_mode). Committing now means a creator cannot loosen them later.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct FeeTerms {
    pub total_fee_bps: u16,
    pub creator_bps: u16,
    pub platform_bps: u16,
    pub holders_bps: u16,
    pub lp_bps: u16,
    pub referral_bps: u16,
    pub opening_fee_start_bps: u16,
    pub opening_decay_minutes: u16,
    pub fee_vest_bps: u16,
    pub fee_vest_days: u16,
}

impl FeeTerms {
    /// 1.00% total; creator 50%, platform 15%, holders 15%, LP 10%, referral 10%; creator take 0.50% of volume (DN-15 RULED, CO-5 D-4).
    pub fn standard() -> Self {
        FeeTerms {
            total_fee_bps: 100,
            creator_bps: 5_000,
            platform_bps: 1_500,
            holders_bps: 1_500,
            lp_bps: 1_000,
            referral_bps: 1_000,
            opening_fee_start_bps: 0,
            opening_decay_minutes: 0,
            fee_vest_bps: 5_000,
            fee_vest_days: 90,
        }
    }
}

/// Numeric launch parameters. Account-dependent checks (creator is not a payee, one active trial) live in the contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct TrialParams {
    pub symbol: String,
    pub name: String,
    pub total_supply_whole: u64,
    pub sale_bps: u16,
    pub lp_bps: u16,
    pub creator_bps: u16,
    pub backer_bps: u16,
    #[serde(with = "dec::u128")]
    pub hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub soft_cap: u128,
    #[serde(with = "dec::u128")]
    pub min_buy: u128,
    pub wallet_bps: u16,
    pub min_funders: u32,
    pub open_delay_secs: u64,
    pub commit_secs: u64,
    pub tail_secs: u64,
    pub stream_days: u16,
    #[serde(default = "FeeTerms::standard")]
    pub fees: FeeTerms,
}

impl TrialParams {
    /// Spec defaults: 1B supply, 60/25/10/5, $1,000 hard cap, 35% soft cap, $20 min buy, 2% wallet, 10 funders.
    pub fn example(symbol: &str) -> Self {
        TrialParams {
            symbol: symbol.to_string(),
            name: format!("{} Test Token", symbol),
            total_supply_whole: 1_000_000_000,
            sale_bps: 6_000,
            lp_bps: 2_500,
            creator_bps: 1_000,
            backer_bps: 500,
            hard_cap: 1_000 * USDC,
            soft_cap: 350 * USDC,
            min_buy: 20 * USDC,
            wallet_bps: 200,
            min_funders: 10,
            open_delay_secs: 0,
            commit_secs: 86_400,
            tail_secs: 21_600,
            stream_days: 30,
            fees: FeeTerms::standard(),
        }
    }
}

/// Everything the contract derives from validated params. Token amounts in base units.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Derived {
    #[serde(with = "dec::u128")]
    pub n_total: u128,
    #[serde(with = "dec::u128")]
    pub n_sale: u128,
    #[serde(with = "dec::u128")]
    pub n_creator: u128,
    #[serde(with = "dec::u128")]
    pub n_backer: u128,
    #[serde(with = "dec::u128")]
    pub n_lp: u128,
    #[serde(with = "dec::u128")]
    pub wallet_cap: u128,
    #[serde(with = "dec::u128")]
    pub max_total_held: u128,
    pub max_holders: u32,
}

const RESERVED_SYMBOLS: [&str; 9] = ["KRUXA", "USDC", "USDT", "NEAR", "WNEAR", "SOL", "ETH", "BTC", "DAI"];

fn within<T: PartialOrd + std::fmt::Display>(code: RuleCode, field: &'static str, v: T, lo: T, hi: T) -> Result<(), RuleViolation> {
    if v < lo || v > hi {
        return Err(RuleViolation::new(code, field, &v, format!("{}..={}", lo, hi)));
    }
    Ok(())
}

fn check_text(p: &TrialParams, brand_ok: bool) -> Result<(), RuleViolation> {
    let sym_ok = (2..=12).contains(&p.symbol.len()) && p.symbol.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let reserved = RESERVED_SYMBOLS.contains(&p.symbol.as_str()) && !brand_ok;
    if !sym_ok || reserved {
        return Err(RuleViolation::new(RuleCode::RSymbol, "symbol", &p.symbol, "2..=12 of [A-Z0-9], not reserved"));
    }
    if p.name.is_empty() || p.name.len() > 32 || !p.name.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        return Err(RuleViolation::new(RuleCode::RSymbol, "name", &p.name, "1..=32 printable ASCII"));
    }
    Ok(())
}

fn check_buckets(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    within(RuleCode::RSupply, "total_supply_whole", p.total_supply_whole, r.min_supply_whole, r.max_supply_whole)?;
    within(RuleCode::RBuckets, "sale_bps", p.sale_bps, r.min_sale_bps, r.max_sale_bps)?;
    within(RuleCode::RBuckets, "lp_bps", p.lp_bps, r.min_lp_bps, r.max_lp_bps)?;
    within(RuleCode::RBuckets, "creator_bps", p.creator_bps, 0, r.max_creator_bps)?;
    within(RuleCode::RBuckets, "backer_bps", p.backer_bps, 0, r.max_backer_bps)?;
    let sum = p.sale_bps as u32 + p.lp_bps as u32 + p.creator_bps as u32 + p.backer_bps as u32;
    if sum != 10_000 {
        return Err(RuleViolation::new(RuleCode::RBuckets, "bucket sum", sum, "== 10000"));
    }
    let cb = p.creator_bps as u32 + p.backer_bps as u32;
    if cb > r.max_creator_plus_backer_bps as u32 {
        return Err(RuleViolation::new(RuleCode::RAlloc, "creator+backer bps", cb, r.max_creator_plus_backer_bps));
    }
    Ok(())
}

fn check_fees(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    let f = &p.fees;
    within(RuleCode::RFeeTotal, "total_fee_bps", f.total_fee_bps, r.min_total_fee_bps, r.max_total_fee_bps)?;
    within(RuleCode::RCreatorShare, "creator_bps", f.creator_bps, 0, r.max_creator_share_bps)?;
    let take = f.total_fee_bps as u64 * f.creator_bps as u64;
    if take > r.max_creator_take_bps as u64 * 10_000 {
        return Err(RuleViolation::new(
            RuleCode::RCreatorTake,
            "total_fee_bps*creator_bps",
            take,
            format!("<= {}", r.max_creator_take_bps as u64 * 10_000),
        ));
    }
    if f.platform_bps < r.min_platform_bps {
        return Err(RuleViolation::new(RuleCode::RPlatformFloor, "platform_bps", f.platform_bps, format!(">= {}", r.min_platform_bps)));
    }
    if f.platform_bps != r.platform_bps {
        return Err(RuleViolation::new(RuleCode::RPlatformFixed, "platform_bps", f.platform_bps, format!("== {}", r.platform_bps)));
    }
    within(RuleCode::RHolderRange, "holders_bps", f.holders_bps, r.min_holders_bps, r.max_holders_bps)?;
    within(RuleCode::RLpRange, "lp_bps", f.lp_bps, r.min_lp_fee_bps, r.max_lp_fee_bps)?;
    if f.holders_bps + f.lp_bps < r.min_holders_plus_lp_bps {
        return Err(RuleViolation::new(
            RuleCode::RHolderLpFloor,
            "holders_bps+lp_bps",
            f.holders_bps + f.lp_bps,
            format!(">= {}", r.min_holders_plus_lp_bps),
        ));
    }
    within(RuleCode::RReferral, "referral_bps", f.referral_bps, 0, r.max_referral_bps)?;
    let sum = [f.creator_bps, f.platform_bps, f.holders_bps, f.lp_bps, f.referral_bps].iter().map(|b| *b as u32).sum::<u32>();
    if sum != 10_000 {
        return Err(RuleViolation::new(RuleCode::RSplitSum, "fee split sum", sum, "== 10000"));
    }
    within(RuleCode::RFeeVest, "fee_vest_bps", f.fee_vest_bps, r.min_fee_vest_bps, 10_000)?;
    within(RuleCode::RFeeVest, "fee_vest_days", f.fee_vest_days, r.min_fee_vest_days, r.max_fee_vest_days)?;
    let (start, decay) = (f.opening_fee_start_bps, f.opening_decay_minutes);
    if (start == 0) != (decay == 0)
        || (start != 0 && (start < f.total_fee_bps || start > r.max_opening_fee_start_bps || decay > r.max_opening_decay_minutes))
    {
        return Err(RuleViolation::new(
            RuleCode::ROpening,
            "opening fee",
            format!("{start} bps over {decay} min"),
            "both zero, or start in total..=max over <= max minutes",
        ));
    }
    Ok(())
}

fn check_raise(p: &TrialParams, r: &Rules) -> Result<u128, RuleViolation> {
    within(RuleCode::RHardCap, "hard_cap", p.hard_cap, r.min_hard_cap, r.max_hard_cap)?;
    let soft_floor = r.min_soft_abs.max(mul_div_ceil(p.hard_cap, r.min_soft_pct_bps as u128, 10_000)?);
    if p.soft_cap < soft_floor || p.soft_cap > p.hard_cap {
        return Err(RuleViolation::new(RuleCode::RSoftCap, "soft_cap", p.soft_cap, format!("{}..={}", soft_floor, p.hard_cap)));
    }
    let min_buy_floor = r.min_buy_abs.max(mul_div_ceil(p.hard_cap, 1, r.min_buy_divisor as u128)?);
    if p.min_buy < min_buy_floor || p.min_buy > p.soft_cap {
        return Err(RuleViolation::new(RuleCode::RMinBuy, "min_buy", p.min_buy, format!(">= {}", min_buy_floor)));
    }
    within(RuleCode::RWalletCap, "wallet_bps", p.wallet_bps, r.wallet_bps_min, r.wallet_bps_max)?;
    within(RuleCode::RFunders, "min_funders", p.min_funders, r.funders_min, r.funders_max)?;
    if (p.min_funders as u128).saturating_mul(p.min_buy) > p.soft_cap {
        return Err(RuleViolation::new(
            RuleCode::RPassable,
            "min_funders*min_buy",
            p.min_funders as u128 * p.min_buy,
            format!("<= soft_cap {}", p.soft_cap),
        ));
    }
    let by_bps = mul_div_ceil(p.hard_cap, p.wallet_bps as u128, 10_000)?;
    Ok(by_bps.max(p.min_buy.saturating_mul(r.wallet_floor_multiple as u128)))
}

fn check_window(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    within(RuleCode::RWindow, "commit_secs", p.commit_secs, r.min_commit_secs, r.max_commit_secs)?;
    within(RuleCode::RWindow, "tail_secs", p.tail_secs, r.min_tail_secs, r.max_tail_secs)?;
    within(RuleCode::RWindow, "open_delay_secs", p.open_delay_secs, 0, r.max_open_delay_secs)?;
    let need = if p.hard_cap <= r.stream_large_threshold { r.min_stream_days_small } else { r.min_stream_days_large };
    within(RuleCode::RStream, "stream_days", p.stream_days, need, r.max_stream_days)
}

/// Check order is fixed: text, buckets, raise, window/stream, caps. First violation wins.
/// `global_headroom` = global cap minus hard caps already reserved by other launches.
pub fn validate_params(p: &TrialParams, r: &Rules, global_headroom: u128, brand_ok: bool) -> Result<Derived, RuleViolation> {
    check_text(p, brand_ok)?;
    check_buckets(p, r)?;
    check_fees(p, r)?;
    let wallet_cap = check_raise(p, r)?;
    check_window(p, r)?;
    if p.hard_cap > global_headroom {
        return Err(RuleViolation::new(RuleCode::RCapGlobal, "hard_cap", p.hard_cap, format!("global headroom {}", global_headroom)));
    }
    let n_total = (p.total_supply_whole as u128) * 10u128.pow(r.decimals as u32);
    let part = |bps: u16| kruxa_math::bps_floor(n_total, bps);
    let (n_sale, n_creator, n_backer) = (part(p.sale_bps)?, part(p.creator_bps)?, part(p.backer_bps)?);
    let n_lp = n_total - n_sale - n_creator - n_backer;
    let cap_by_math = mul_div_ceil(2 * p.hard_cap, 1, p.min_buy)?;
    let max_holders = (r.max_holders as u128).min(cap_by_math) as u32;
    let max_total_held = kruxa_math::mul_div_floor(p.hard_cap, r.max_oversub_bps as u128, 10_000)?;
    Ok(Derived { n_total, n_sale, n_creator, n_backer, n_lp, wallet_cap, max_total_held, max_holders })
}

/// Every stage's first violation, in the fixed check order (text, buckets, fees, raise, window/stream, global cap). Where
/// `validate_params` stops at the first failure, this shows a creator or a judge ALL the stages a preset breaks.
pub fn validate_all(p: &TrialParams, r: &Rules, global_headroom: u128, brand_ok: bool) -> Vec<RuleViolation> {
    let mut out: Vec<RuleViolation> =
        [check_text(p, brand_ok), check_buckets(p, r), check_fees(p, r), check_raise(p, r).map(|_| ()), check_window(p, r)]
            .into_iter()
            .filter_map(Result::err)
            .collect();
    if p.hard_cap > global_headroom {
        out.push(RuleViolation::new(RuleCode::RCapGlobal, "hard_cap", p.hard_cap, format!("global headroom {global_headroom}")));
    }
    out
}

/// Position-storage bond the creator attaches (refundable): max_holders x bytes x 1e-5 NEAR + record overhead.
pub const POSITION_BYTES: u128 = 330;
pub const LAUNCH_RECORD_BYTES: u128 = 3_000;

pub fn bond_required(max_holders: u32) -> u128 {
    (max_holders as u128 * POSITION_BYTES + LAUNCH_RECORD_BYTES) * STORAGE_BYTE_COST_YOCTO
}

#[cfg(test)]
mod tests {
    #[test]
    fn creator_gate_has_its_own_rule_code() {
        assert_eq!(RuleCode::RCreatorGate.as_str(), "R_CREATOR_GATE");
    }

    use super::*;

    fn ok(p: &TrialParams) -> Result<Derived, RuleViolation> {
        validate_params(p, &Rules::ladder(), 3_000 * USDC, false)
    }

    fn with_fees(base: &TrialParams, edit: impl FnOnce(&mut FeeTerms)) -> TrialParams {
        let mut p = base.clone();
        edit(&mut p.fees);
        p
    }

    fn code(p: &TrialParams) -> RuleCode {
        ok(p).unwrap_err().code
    }

    #[test]
    fn defaults_pass_and_derive() {
        let d = ok(&TrialParams::example("ABCD")).unwrap();
        assert_eq!(d.n_total, 1_000_000_000_000_000);
        assert_eq!(d.n_sale, 600_000_000_000_000);
        assert_eq!(d.n_lp, 250_000_000_000_000);
        assert_eq!(d.n_sale + d.n_creator + d.n_backer + d.n_lp, d.n_total);
        assert_eq!(d.wallet_cap, 100 * USDC);
        assert_eq!(d.max_holders, 100);
        assert_eq!(d.max_total_held, 2_000 * USDC);
    }

    #[test]
    fn u_alloc_sum_10000() {
        // Every accepted bucket split sums to exactly 10_000 bps, and the derived token buckets sum to the supply to the unit.
        let base = TrialParams::example("ABCD");
        let d = ok(&base).unwrap();
        assert_eq!(base.sale_bps + base.lp_bps + base.creator_bps + base.backer_bps, 10_000);
        assert_eq!(d.n_sale + d.n_lp + d.n_creator + d.n_backer, d.n_total);
        for (sale, lp, creator, backer) in
            [(8_000u16, 1_500u16, 500u16, 0u16), (5_000, 4_000, 1_000, 0), (5_500, 2_500, 1_500, 500), (8_000, 2_000, 0, 0)]
        {
            let p = TrialParams { sale_bps: sale, lp_bps: lp, creator_bps: creator, backer_bps: backer, ..base.clone() };
            assert_eq!(sale + lp + creator + backer, 10_000);
            let d = ok(&p).unwrap();
            assert_eq!(d.n_sale + d.n_lp + d.n_creator + d.n_backer, d.n_total, "{p:?}");
        }
        let off = TrialParams { sale_bps: 5_999, ..base };
        assert_eq!(ok(&off).unwrap_err().code, RuleCode::RBuckets, "9_999 bps is refused");
    }

    #[test]
    fn one_failing_case_per_code() {
        let base = TrialParams::example("ABCD");
        let cases: Vec<(RuleCode, TrialParams)> = vec![
            (RuleCode::RSymbol, TrialParams { symbol: "abcd".into(), ..base.clone() }),
            (RuleCode::RSymbol, TrialParams { symbol: "USDC".into(), ..base.clone() }),
            (RuleCode::RSupply, TrialParams { total_supply_whole: 9_999_999, ..base.clone() }),
            (RuleCode::RBuckets, TrialParams { sale_bps: 5_900, ..base.clone() }),
            (RuleCode::RBuckets, TrialParams { sale_bps: 4_900, lp_bps: 3_600, ..base.clone() }),
            (RuleCode::RAlloc, TrialParams { creator_bps: 1_900, backer_bps: 700, sale_bps: 5_400, lp_bps: 2_000, ..base.clone() }),
            (RuleCode::RHardCap, TrialParams { hard_cap: 1_000 * USDC + 1, ..base.clone() }),
            (RuleCode::RHardCap, TrialParams { hard_cap: 499 * USDC, ..base.clone() }),
            (RuleCode::RSoftCap, TrialParams { soft_cap: 349 * USDC, ..base.clone() }),
            (RuleCode::RMinBuy, TrialParams { min_buy: 19 * USDC, ..base.clone() }),
            (RuleCode::RWalletCap, TrialParams { wallet_bps: 49, ..base.clone() }),
            (RuleCode::RFunders, TrialParams { min_funders: 9, ..base.clone() }),
            (RuleCode::RPassable, TrialParams { min_funders: 18, ..base.clone() }),
            (RuleCode::RWindow, TrialParams { commit_secs: 86_399, ..base.clone() }),
            (RuleCode::RWindow, TrialParams { tail_secs: 3_599, ..base.clone() }),
            (RuleCode::RFeeTotal, with_fees(&base, |f| f.total_fee_bps = 201)),
            (RuleCode::RFeeTotal, with_fees(&base, |f| f.total_fee_bps = 29)),
            (RuleCode::RCreatorShare, with_fees(&base, |f| f.creator_bps = 6_001)),
            (
                RuleCode::RCreatorTake,
                with_fees(&base, |f| {
                    f.total_fee_bps = 200;
                    f.creator_bps = 5_100;
                }),
            ),
            (RuleCode::RPlatformFloor, with_fees(&base, |f| f.platform_bps = 1_400)),
            (RuleCode::RPlatformFixed, with_fees(&base, |f| f.platform_bps = 2_100)),
            (RuleCode::RHolderRange, with_fees(&base, |f| f.holders_bps = 999)),
            (RuleCode::RLpRange, with_fees(&base, |f| f.lp_bps = 3_001)),
            (
                RuleCode::RHolderLpFloor,
                with_fees(&base, |f| {
                    f.holders_bps = 1_000;
                    f.lp_bps = 900;
                }),
            ),
            (RuleCode::RReferral, with_fees(&base, |f| f.referral_bps = 2_001)),
            (RuleCode::RSplitSum, with_fees(&base, |f| f.referral_bps = 400)),
            (RuleCode::RFeeVest, with_fees(&base, |f| f.fee_vest_bps = 2_499)),
            (RuleCode::ROpening, with_fees(&base, |f| f.opening_fee_start_bps = 500)),
            (RuleCode::RStream, TrialParams { stream_days: 29, ..base.clone() }),
        ];
        for (want, p) in cases {
            assert_eq!(code(&p), want, "{:?}", p);
        }
        let e = validate_params(&base, &Rules::ladder(), 999 * USDC, false).unwrap_err();
        assert_eq!(e.code, RuleCode::RCapGlobal);
        assert!(e.message().starts_with("R_CAP_GLOBAL: "));
    }

    #[test]
    fn validate_all_lists_every_stage_a_hostile_preset_breaks() {
        let base = TrialParams::example("ABCD");
        assert!(validate_all(&base, &Rules::ladder(), 3_000 * USDC, false).is_empty());
        let hostile =
            TrialParams { creator_bps: 1_900, backer_bps: 700, sale_bps: 5_400, lp_bps: 2_000, commit_secs: 86_399, ..base.clone() };
        let codes: Vec<RuleCode> = validate_all(&hostile, &Rules::ladder(), 3_000 * USDC, false).iter().map(|v| v.code).collect();
        assert_eq!(codes, vec![RuleCode::RAlloc, RuleCode::RWindow]);
        assert_eq!(
            validate_params(&hostile, &Rules::ladder(), 3_000 * USDC, false).unwrap_err().code,
            RuleCode::RAlloc,
            "first-failure API unchanged"
        );
    }

    #[test]
    fn boundaries_are_inclusive() {
        let base = TrialParams::example("ABCD");
        assert!(ok(&TrialParams { soft_cap: 350 * USDC, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { hard_cap: 1_000 * USDC, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { commit_secs: 86_400, tail_secs: 3_600, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { min_funders: 17, ..base.clone() }).is_ok());
        assert!(validate_params(&TrialParams::example("KRUXA"), &Rules::ladder(), 3_000 * USDC, true).is_ok());
    }

    #[test]
    fn json_without_fees_gets_the_standard_terms_and_roundtrips() {
        let mut v = serde_json::to_value(TrialParams::example("ABCD")).unwrap();
        v.as_object_mut().unwrap().remove("fees");
        let p: TrialParams = serde_json::from_value(v).unwrap();
        assert_eq!(p.fees, FeeTerms::standard());
        assert_eq!(p.hard_cap, 1_000 * USDC);
        let back: TrialParams = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn demo_clock_only_relaxes_time() {
        let mut p = TrialParams::example("ABCD");
        p.commit_secs = 90;
        p.tail_secs = 30;
        assert_eq!(code(&p), RuleCode::RWindow);
        assert!(validate_params(&p, &Rules::demo_clock(), 3_000 * USDC, false).is_ok());
    }

    /// Task 1.1: every ruling-bound constant in one place, so a silent edit to `Rules::ladder()` or `FeeTerms::standard()` fails here.
    #[test]
    fn ruled_constants_match_the_rulings() {
        let r = Rules::ladder();
        assert_eq!(r.max_hard_cap, 1_000 * USDC, "RULING 2026-11-07: $1,000 per launch");
        assert_eq!(r.backer_vest_days, 30, "RULING 2026-11-07: backer bonus 30-day vest");
        assert_eq!(r.platform_bps, 1_500, "DN-15 / CO-5 D-4: platform 15%");
        let f = FeeTerms::standard();
        assert_eq!(
            [f.creator_bps, f.platform_bps, f.holders_bps, f.lp_bps, f.referral_bps],
            [5_000, 1_500, 1_500, 1_000, 1_000],
            "DN-15 RULED 50/15/15/10/10"
        );
        assert_eq!((r.max_oversub_bps, r.max_relay_fee_abs, r.max_relay_fee_bps), (20_000, USDC / 2, 500), "open: DN-2, DN-1 as built");
        assert_eq!(Rules::demo_clock().max_hard_cap, r.max_hard_cap, "the demo clock never loosens the cap");
        // W1-DC-17: the standard preset passes, and a different platform share (2_000, the pre-D-4 value) is refused.
        assert!(ok(&TrialParams::example("ABCD")).is_ok());
        let mut old = TrialParams::example("ABCD");
        old.fees.platform_bps = 2_000;
        assert_eq!(code(&old), RuleCode::RPlatformFixed);
    }

    #[test]
    fn r_vest_floors_and_ceiling() {
        assert!(Rules::ladder().check_alloc_vest().is_ok());
        assert!(Rules::demo_clock().check_alloc_vest().is_ok());
        let short_cliff = Rules { alloc_cliff_secs: 13 * 86_400, ..Rules::ladder() };
        assert_eq!(short_cliff.check_alloc_vest().unwrap_err().code, RuleCode::RVest);
        let short_total = Rules { alloc_cliff_secs: 14 * 86_400, alloc_linear_secs: 100 * 86_400, ..Rules::ladder() };
        assert_eq!(short_total.check_alloc_vest().unwrap_err().code, RuleCode::RVest);
        let too_long = Rules { alloc_linear_secs: 1_431 * 86_400, ..Rules::ladder() };
        assert_eq!(too_long.check_alloc_vest().unwrap_err().code, RuleCode::RVest);
        assert!(check_stream_init(1).unwrap_err().message().starts_with("R_STREAM_INIT: "));
        assert!(check_stream_init(0).is_ok());
    }

    #[test]
    fn r_payees_cases() {
        assert!(check_payees(&[("a", 6_000u16), ("b", 4_000)]).is_ok());
        for bad in [vec![], vec![("a", 9_999u16)], vec![("a", 5_000), ("a", 5_000)], vec![("a", 10_000), ("b", 0)]] {
            assert_eq!(check_payees(&bad).unwrap_err().code, RuleCode::RPayees, "{bad:?}");
        }
        let eleven: Vec<(u32, u16)> = (0..11).map(|i| (i, if i == 0 { 9_990 } else { 1 })).collect();
        assert_eq!(check_payees(&eleven).unwrap_err().code, RuleCode::RPayees, "more than ten payees");
        assert_eq!(RuleCode::RBurnUnsupported.as_str(), "R_BURN_UNSUPPORTED");
    }

    #[test]
    fn storage_constant_is_1e5_near_per_byte() {
        assert_eq!(STORAGE_BYTE_COST_YOCTO, 10u128.pow(19));
        assert_eq!(bond_required(100), (100 * 330 + 3_000) * 10u128.pow(19));
    }
}
