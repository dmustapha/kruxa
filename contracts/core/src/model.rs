use kruxa_logic::genesis::{Disclosure, Frontier, GenesisMode, GenesisSpec};
use kruxa_logic::{hex, Derived, Rules, StatusClass, TrialParams, VerdictInputs};
use near_sdk::{bs58, near, AccountId};

/// Who owns a position. A 64-hex Intents signer is a Solana key only if `deliver` says so (RECONCILED row 13).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum HolderId {
    Near(AccountId),
    Solana([u8; 32]),
}

impl HolderId {
    /// Stable text key used in events, views, the book hash and the walk_signed preimage.
    pub fn key(&self) -> String {
        match self {
            HolderId::Near(a) => format!("near:{}", a),
            HolderId::Solana(b) => format!("sol:{}", bs58::encode(b).into_string()),
        }
    }

    pub fn parse(s: &str) -> Option<HolderId> {
        if let Some(a) = s.strip_prefix("near:") {
            return a.parse().ok().map(HolderId::Near);
        }
        let raw = bs58::decode(s.strip_prefix("sol:")?).into_vec().ok()?;
        <[u8; 32]>::try_from(raw.as_slice()).ok().map(HolderId::Solana)
    }

    /// The account that holds this holder's balance inside intents.near.
    pub fn intents_account(&self) -> AccountId {
        match self {
            HolderId::Near(a) => a.clone(),
            HolderId::Solana(b) => hex(b).parse().expect("64 hex chars is a valid implicit account id"),
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Custody {
    Native,
    Intents,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseLevel {
    None,
    Paused,
    Frozen,
}

impl From<PauseLevel> for kruxa_logic::Pause {
    fn from(p: PauseLevel) -> Self {
        match p {
            PauseLevel::None => Self::None,
            PauseLevel::Paused => Self::Paused,
            PauseLevel::Frozen => Self::Frozen,
        }
    }
}

impl From<kruxa_logic::Pause> for PauseLevel {
    fn from(p: kruxa_logic::Pause) -> Self {
        match p {
            kruxa_logic::Pause::None => Self::None,
            kruxa_logic::Pause::Paused => Self::Paused,
            kruxa_logic::Pause::Frozen => Self::Frozen,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenRoute {
    FactoryPrimitives,
    /// Reserved: own immutable FT published by hash. Not approved (RULING 2026-11-07), trait seam only.
    OwnGlobalByHash([u8; 32]),
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Charter {
    pub launch_id: u64,
    pub creator: AccountId,
    pub stream_recipient: AccountId,
    pub created_at: u64,
    pub params: TrialParams,
    pub derived: Derived,
    pub rules: Rules,
    pub opens_at: u64,
    pub commit_end: u64,
    pub walk_end: u64,
    pub route: TokenRoute,
    /// Static genesis intent, committed with the Charter (ARCHITECTURE 5.2). Defaults keep every authority None.
    pub genesis: GenesisPlan,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Creating,
    CreationFailed,
    Open,
    Passed,
    /// Reason bitset: 1 below soft cap, 2 below min funders, 4 cancelled.
    Failed(u8),
    Dissolved,
}

impl Status {
    pub fn class(&self) -> StatusClass {
        match self {
            Status::Creating => StatusClass::Creating,
            Status::CreationFailed => StatusClass::CreationFailed,
            Status::Open => StatusClass::Open,
            Status::Passed => StatusClass::Passed,
            Status::Failed(_) => StatusClass::Failed,
            Status::Dissolved => StatusClass::Dissolved,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Ledger {
    pub credited: u128,
    pub open_native: u128,
    pub open_intents: u128,
    pub due_native: u128,
    pub due_intents: u128,
    pub inflight_native: u128,
    pub inflight_intents: u128,
    pub refunded: u128,
    pub spent_native: u128,
    pub spent_intents: u128,
    pub consolidated: u128,
    pub consolidating: u128,
    pub excess_pool: u128,
    pub launch_fee_due: u128,
    pub launch_fee_paid: u128,
    pub launch_fee_inflight: u128,
    pub lp_seed_due: u128,
    /// D-3: the part of the LP seed handed to `open_market` and not yet answered, and the part the market accepted.
    pub lp_seed_inflight: u128,
    pub lp_seed_sent: u128,
    pub lp_tokens_inflight: u128,
    pub lp_tokens_sent: u128,
    pub stream_total: u128,
    pub stream_drawn: u128,
    pub stream_inflight: u128,
    pub relay_fee_total: u128,
    pub relay_fee_paid: u128,
    pub relay_fee_inflight: u128,
    /// Launch-token custody (token_claims.rs). Creator allocation claimed (debited at claim, re-credited on failure).
    pub alloc_claimed: u128,
    /// Position token claims in flight or done (debited at claim, re-credited on failure).
    pub claimed_total: u128,
    /// Sum of `tokens_entitled` over NEAR positions whose `claimed` is still zero: sale tokens that stay owed to buyers.
    pub unclaimed_sale_total: u128,
    /// Sum of `tokens_entitled + bonus_entitled` over Solana-delivery positions: the NEAR copy stays locked for the Solana mint (L7').
    pub solana_locked_total: u128,
    /// Supply released by `sweep_tokens` to `burn_mode` (sunk, or marked held). Debited before the transfer.
    pub swept: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Settlement {
    pub pass: bool,
    pub reasons: u8,
    pub settled_at: u64,
    pub total_active: u128,
    pub accepted: u128,
    pub launch_fee: u128,
    pub lp_quote: u128,
    pub stream: u128,
    pub excess_pool: u128,
    pub inputs_hash: [u8; 32],
    pub book_hash: [u8; 32],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct LaunchState {
    pub charter_hash: [u8; 32],
    pub status: Status,
    pub halted: bool,
    pub cancelled: bool,
    pub token: Option<AccountId>,
    pub total_active: u128,
    pub active_funders: u32,
    pub holder_count: u32,
    pub positions_live: u32,
    pub positions_unsettled: u32,
    pub residue_swept: bool,
    pub bond: u128,
    pub bond_reclaimed: bool,
    pub book_hash: [u8; 32],
    pub ledger: Ledger,
    pub settlement: Option<Settlement>,
    pub genesis: GenesisState,
}

impl LaunchState {
    /// The one place the verdict inputs are assembled: `settle`, `cancel_trial` and the `get_verdict_inputs` view all call it,
    /// so the hash stored in the settlement is exactly the hash a judge recomputes.
    pub fn verdict_inputs(&self, ch: &Charter) -> VerdictInputs {
        VerdictInputs {
            launch_id: ch.launch_id,
            charter_hash: self.charter_hash,
            total_active: self.total_active,
            active_funders: self.active_funders,
            soft_cap: ch.params.soft_cap,
            min_funders: ch.params.min_funders,
            cancelled: self.cancelled,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Position {
    pub seq: u32,
    pub deliver: HolderId,
    pub referrer: Option<AccountId>,
    pub contributed: u128,
    pub open_native: u128,
    pub open_intents: u128,
    pub due_native: u128,
    pub due_intents: u128,
    pub inflight_native: u128,
    pub inflight_intents: u128,
    pub refunded: u128,
    pub spent: u128,
    pub tokens_entitled: u128,
    pub bonus_entitled: u128,
    pub claimed: u128,
    /// Part of `claimed` whose `ft_transfer` has not resolved yet. A position is not deleted while this is non-zero.
    pub claim_inflight: u128,
    pub settled: bool,
}

impl Position {
    pub fn open(&self) -> u128 {
        self.open_native + self.open_intents
    }
    pub fn owed(&self) -> u128 {
        self.due_native + self.due_intents
    }
    pub fn inflight(&self) -> u128 {
        self.inflight_native + self.inflight_intents
    }
    /// L3: contributed == open + due + in_flight + refunded + spent.
    pub fn conserved(&self) -> bool {
        self.contributed == self.open() + self.owed() + self.inflight() + self.refunded + self.spent
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub treasury: AccountId,
    pub relay_fees: AccountId,
    pub usdc: AccountId,
    pub usdc_token_id: String,
    pub intents: AccountId,
    pub factory: AccountId,
    pub rules: Rules,
    pub global_cap: u128,
    pub pending_global_cap: Option<(u128, u64)>,
    pub pending_launch_cap: Option<(u128, u64)>,
    pub global_held: u128,
    pub pause: PauseLevel,
    pub frozen_until: u64,
    pub factory_deposit: u128,
    pub profile: String,
    /// D-1: while true only the owner can `create_trial`. Starts true on the mainnet profile, one-way off through `open_beta`.
    pub creator_gate: bool,
    /// D-3: the market contract that receives the LP seed. Set once by the owner; locked after the first `open_market`.
    pub market: Option<AccountId>,
    pub market_locked: bool,
    /// The genesis relayer (`genesis-relayer.kruxa.near`): commit, build_root_page, confirm, abort, attest_log_append and nothing else.
    pub genesis_relayer: Option<AccountId>,
    pub genesis_paused: bool,
    /// What `sweep_tokens` does with unclaimed bonus, rounding dust and a dissolved launch's supply. Default Hold.
    pub burn_mode: BurnMode,
    /// Set by the first `set_burn_mode` or the first sweep: the destination can then never be changed.
    pub burn_mode_locked: bool,
}

/// `Burn` calls the token's `ft_burn`; the testnet factory token has none (evidence/factory-probe.txt), so it is refused today.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BurnMode {
    Burn,
    Sink(AccountId),
    Hold,
}

impl BurnMode {
    /// "burn", "hold" or "sink:<account>": the text form used by `set_burn_mode`, events and views.
    pub fn label(&self) -> String {
        match self {
            BurnMode::Burn => "burn".into(),
            BurnMode::Hold => "hold".into(),
            BurnMode::Sink(a) => format!("sink:{}", a),
        }
    }

    pub fn parse(s: &str) -> Option<BurnMode> {
        match s {
            "burn" => Some(BurnMode::Burn),
            "hold" => Some(BurnMode::Hold),
            _ => s.strip_prefix("sink:")?.parse().ok().map(BurnMode::Sink),
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GenesisPlan {
    pub plan_version: u8,
    pub mode: GenesisMode,
    pub decimals: u8,
    pub metadata_uri_sha256: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub mint_authority_none: bool,
    pub freeze_authority_none: bool,
    pub extensions_allowed: bool,
    pub lp_mirror_to_solana: bool,
    pub reserve_bps: u16,
    pub squads_multisig_hash: [u8; 32],
    pub vault_index: u8,
    pub disclosure: Disclosure,
    pub clawback_days: u16,
    pub mint_pubkey_f0: Option<[u8; 32]>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GenesisStatus {
    None,
    Committed,
    Confirmed,
    Aborted,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct GenesisState {
    pub status: GenesisStatus,
    pub g_pub: Option<[u8; 32]>,
    pub mint_address: Option<[u8; 32]>,
    pub commit_height: u64,
    pub expected_leaves: u32,
    pub expected_total: u64,
    pub frontier: Frontier,
    pub last_leaf: Option<[u8; 32]>,
    pub leaf_sum: u64,
    pub root_ready: bool,
    pub merkle_root: Option<[u8; 32]>,
    pub spec: Option<GenesisSpec>,
    pub genesis_spec_hash: Option<[u8; 32]>,
    pub sol_mint_supply: u64,
    pub tx_sigs: Vec<String>,
    pub slot: u64,
    pub ceremony_hash: Option<[u8; 32]>,
    pub attest_log: Vec<[u8; 32]>,
    pub abort_reason: String,
    /// F0 policy gate: sha256 of the only message `sign_genesis` may sign for tx1 (index 0) and tx2 (index 1); and whether it was signed.
    pub f0_hash: [Option<[u8; 32]>; 2],
    pub f0_signed: [bool; 2],
}

impl Default for GenesisState {
    fn default() -> Self {
        Self {
            status: GenesisStatus::None,
            g_pub: None,
            mint_address: None,
            commit_height: 0,
            expected_leaves: 0,
            expected_total: 0,
            frontier: Frontier::default(),
            last_leaf: None,
            leaf_sum: 0,
            root_ready: false,
            merkle_root: None,
            spec: None,
            genesis_spec_hash: None,
            sol_mint_supply: 0,
            tx_sigs: Vec::new(),
            slot: 0,
            ceremony_hash: None,
            attest_log: Vec::new(),
            abort_reason: String::new(),
            f0_hash: [None; 2],
            f0_signed: [false; 2],
        }
    }
}
