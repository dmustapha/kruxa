//! Task 4.4: the contract side of the Solana genesis ceremony (ARCHITECTURE 5.2, S1-D 2.4). The contract derives every field of the
//! `GenesisSpec` itself; the relayer's only free input is `g_pub`. NEAR cannot see Solana: `confirm_genesis` is a signed claim that
//! `verify.sh` audits ("detected, not prevented"). F0 differs only in who signs (`sign_genesis`, Task 4.6, not built here): in F0 the
//! key is the MPC child key committed in the plan, and `commit_genesis` refuses any other `g_pub`.
use crate::ContractExt;
use base64::Engine as _;
use kruxa_logic::genesis::{
    leaf_hash, mint_address, Disclosure, GenesisMode, GenesisSpec, MAX_ATTEST_LOG, MAX_SIGS, ROLE_DISTRIBUTOR, ROLE_LP_MIRROR,
    TOKEN_PROGRAM,
};
use kruxa_logic::{hex, RuleCode};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

use crate::events::emit;
use crate::model::*;
use crate::{fail, Contract};

const PAGE_MAX: usize = 25;
const MAINNET_GENESIS_HASH: &str = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS_HASH: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/// What a creator may say about the genesis. Every field is optional; the defaults are the only safe values.
#[near(serializers = [json])]
#[derive(Clone, Debug, Default)]
pub struct GenesisPlanInput {
    pub mode: Option<GenesisMode>,
    pub metadata_uri_sha256: Option<String>,
    pub metadata_hash: Option<String>,
    pub mint_authority_none: Option<bool>,
    pub freeze_authority_none: Option<bool>,
    pub extensions_allowed: Option<bool>,
    pub lp_mirror_to_solana: Option<bool>,
    pub reserve_bps: Option<u16>,
    pub squads_multisig_hash: Option<String>,
    pub vault_index: Option<u8>,
    pub disclosure: Option<Disclosure>,
    pub clawback_days: Option<u16>,
    pub mint_pubkey_f0: Option<String>,
}

fn unhex32(s: &str) -> [u8; 32] {
    let ok = s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        fail(RuleCode::RGenesisArg, "expected 64 hex characters");
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("checked hex");
    }
    out
}

fn opt32(s: &Option<String>) -> [u8; 32] {
    s.as_deref().map_or([0; 32], unhex32)
}

/// Validates the creator's genesis wishes. R_GENESIS_AUTH: mint None, freeze None, no extensions are the only accepted values.
pub(crate) fn plan_from_input(input: Option<GenesisPlanInput>) -> GenesisPlan {
    let i = input.unwrap_or_default();
    let (mint_none, freeze_none, ext) =
        (i.mint_authority_none.unwrap_or(true), i.freeze_authority_none.unwrap_or(true), i.extensions_allowed.unwrap_or(false));
    if !mint_none || !freeze_none || ext {
        fail(RuleCode::RGenesisAuth, "mint authority None, freeze authority None and no extensions are required");
    }
    if i.reserve_bps.unwrap_or(0) != 0 {
        fail(RuleCode::RGenesisArg, "reserve_bps must be 0 until the reserve split is ruled (DN-7)");
    }
    let clawback_days = i.clawback_days.unwrap_or(90);
    if !(1..=365).contains(&clawback_days) {
        fail(RuleCode::RGenesisArg, "clawback_days must be 1..=365");
    }
    let mode = i.mode.unwrap_or(GenesisMode::F1);
    let mint_pubkey_f0 = i.mint_pubkey_f0.as_deref().map(unhex32);
    if (mode == GenesisMode::F0) != mint_pubkey_f0.is_some() {
        fail(RuleCode::RGenesisArg, "mint_pubkey_f0 is required for F0 and forbidden for F1");
    }
    GenesisPlan {
        plan_version: 1,
        mode,
        decimals: 6,
        metadata_uri_sha256: opt32(&i.metadata_uri_sha256),
        metadata_hash: opt32(&i.metadata_hash),
        mint_authority_none: true,
        freeze_authority_none: true,
        extensions_allowed: false,
        lp_mirror_to_solana: i.lp_mirror_to_solana.unwrap_or(false),
        reserve_bps: 0,
        squads_multisig_hash: opt32(&i.squads_multisig_hash),
        vault_index: i.vault_index.unwrap_or(0),
        disclosure: i.disclosure.unwrap_or(Disclosure::SinglePartyDemo),
        clawback_days,
        mint_pubkey_f0,
    }
}

fn to_u64(v: u128) -> u64 {
    u64::try_from(v).unwrap_or_else(|_| fail(RuleCode::RGenesisArg, "amount does not fit a Solana u64"))
}

impl Contract {
    fn require_relayer(&self) {
        if self.cfg.genesis_relayer.as_ref() != Some(&env::predecessor_account_id()) {
            fail(RuleCode::RNotAuthorized, "genesis relayer only");
        }
    }

    fn require_genesis_live(&self) {
        self.require_live();
        if self.cfg.genesis_paused {
            fail(RuleCode::RPaused, "genesis is paused");
        }
    }

    /// Solana holders with something to claim, in sequence order: (pubkey, amount). Bounded by the holder cap.
    fn solana_leaves(&self, id: u64, st: &LaunchState) -> Vec<([u8; 32], u64)> {
        (0..st.holder_count)
            .filter_map(|seq| self.seq_index.get(&(id, seq)))
            .filter_map(|h| match h {
                HolderId::Solana(pk) => self.positions.get(&(id, h.clone())).map(|p| (*pk, p.tokens_entitled + p.bonus_entitled)),
                HolderId::Near(_) => None,
            })
            .filter(|(_, amount)| *amount > 0)
            .map(|(pk, amount)| (pk, to_u64(amount)))
            .collect()
    }

    fn build_spec(&self, ch: &Charter, st: &LaunchState) -> GenesisSpec {
        let (g, plan) = (&st.genesis, &ch.genesis);
        let mut buckets = vec![(ROLE_DISTRIBUTOR, g.expected_total)];
        if plan.lp_mirror_to_solana {
            buckets.push((ROLE_LP_MIRROR, to_u64(ch.derived.n_lp)));
        }
        let (chain, cluster) =
            if self.cfg.profile == "mainnet" { ("solana-mainnet", MAINNET_GENESIS_HASH) } else { ("solana-devnet", DEVNET_GENESIS_HASH) };
        let mut cluster_hash = [0u8; 32];
        cluster_hash.copy_from_slice(&near_sdk::bs58::decode(cluster).into_vec().expect("static base58"));
        GenesisSpec {
            spec_version: kruxa_logic::genesis::GENESIS_SPEC_VERSION,
            compiler_version: kruxa_logic::genesis::GENESIS_COMPILER_VERSION.into(),
            chain: chain.into(),
            cluster_genesis_hash: cluster_hash,
            launch_id: ch.launch_id.to_string(),
            near_contract: env::current_account_id().to_string(),
            near_block_height: g.commit_height,
            mode: plan.mode,
            genesis_key_pubkey: g.g_pub.expect("committed"),
            mint_seed: ch.launch_id.to_string(),
            mint_address: g.mint_address.expect("committed"),
            token_program: TOKEN_PROGRAM,
            decimals: plan.decimals,
            supply_total: buckets.iter().map(|b| b.1).sum(),
            name: ch.params.name.clone(),
            symbol: ch.params.symbol.clone(),
            metadata_uri_sha256: plan.metadata_uri_sha256,
            metadata_hash: plan.metadata_hash,
            mint_authority_none: plan.mint_authority_none,
            freeze_authority_none: plan.freeze_authority_none,
            extensions_allowed: plan.extensions_allowed,
            buckets,
            reserve_squads_multisig_hash: plan.squads_multisig_hash,
            reserve_vault_index: plan.vault_index,
            reserve_disclosure: plan.disclosure,
            merkle_root: g.merkle_root.expect("root ready"),
            max_total_claim: g.expected_total,
            max_num_nodes: g.expected_leaves,
            clawback_days: plan.clawback_days,
        }
    }

    /// Called once the last leaf landed (or at commit when there are no Solana buyers): freezes the root and the spec hash.
    fn finish_root(&mut self, id: u64, ch: &Charter, st: &mut LaunchState) {
        st.genesis.merkle_root = Some(st.genesis.frontier.root());
        st.genesis.root_ready = true;
        let spec = self.build_spec(ch, st);
        let hash = spec.hash();
        st.genesis.sol_mint_supply = spec.supply_total;
        st.genesis.genesis_spec_hash = Some(hash);
        st.genesis.spec = Some(spec);
        let g = &st.genesis;
        emit(
            "genesis_committed",
            json!({ "launch_id": id.to_string(), "g_pub": hex(&g.g_pub.expect("committed")), "mint": hex(&g.mint_address.expect("committed")),
                    "merkle_root": hex(&g.merkle_root.expect("set")), "genesis_spec_hash": hex(&hash), "leaf_count": g.expected_leaves,
                    "max_total_claim": g.expected_total.to_string(), "mode": format!("{:?}", ch.genesis.mode) }),
        );
    }
}

#[near]
impl Contract {
    /// OWNER: names the relayer account (a function-call key limited to the five relayer methods lives on it).
    pub fn set_genesis_relayer(&mut self, account: AccountId) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
        emit("genesis_relayer_set", json!({ "account": account }));
        self.cfg.genesis_relayer = Some(account);
    }

    /// GUARD: stops the ceremony (commit, pages, confirm). Exits and the verdict are untouched.
    pub fn pause_genesis(&mut self) {
        let p = env::predecessor_account_id();
        if p != self.cfg.guardian && p != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner or guardian only");
        }
        self.cfg.genesis_paused = true;
        emit("genesis_paused", json!({ "by": p }));
    }

    pub fn resume_genesis(&mut self) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
        self.cfg.genesis_paused = false;
        emit("genesis_resumed", json!({}));
    }

    /// RELAYER. Needs a PASSED launch with every position settled; one-shot. `g_pub` is the per-launch key (F1) or the committed MPC child key (F0).
    pub fn commit_genesis(&mut self, launch_id: U64, g_pub: String) {
        self.require_relayer();
        self.require_genesis_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        if st.status != Status::Passed || st.positions_unsettled != 0 || !st.residue_swept {
            fail(RuleCode::RGenesisState, "needs Passed, every position settled and sweep_residue done");
        }
        if st.genesis.status != GenesisStatus::None {
            fail(RuleCode::RGenesisAlready, "genesis is one-shot per launch");
        }
        let key = unhex32(&g_pub);
        if ch.genesis.mode == GenesisMode::F0 && ch.genesis.mint_pubkey_f0 != Some(key) {
            fail(RuleCode::RGenesisArg, "F0 commits only the MPC child key named in the plan");
        }
        let leaves = self.solana_leaves(id, &st);
        let g = &mut st.genesis;
        g.status = GenesisStatus::Committed;
        g.g_pub = Some(key);
        g.mint_address = Some(mint_address(&key, &id.to_string(), &TOKEN_PROGRAM));
        g.commit_height = env::block_height();
        g.expected_leaves = u32::try_from(leaves.len()).expect("bounded by the holder cap");
        g.expected_total = leaves.iter().map(|l| l.1).sum();
        if leaves.is_empty() {
            self.finish_root(id, &ch, &mut st);
        }
        self.save_state(id, st);
    }

    /// RELAYER. `leaves` = (claimant pubkey hex, amount), strictly ascending by pubkey across all pages; each is checked against the
    /// Solana Position, so the relayer can neither invent a claimant nor change an amount. The root completes with the last expected leaf.
    pub fn build_root_page(&mut self, launch_id: U64, leaves: Vec<(String, U64)>) {
        self.require_relayer();
        self.require_genesis_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        if st.genesis.status != GenesisStatus::Committed || st.genesis.root_ready {
            fail(RuleCode::RGenesisState, "pages are accepted after commit_genesis and until the root is complete");
        }
        if leaves.len() > PAGE_MAX {
            fail(RuleCode::RGenesisArg, "at most 25 leaves per page");
        }
        for (key_hex, amount) in leaves {
            let key = unhex32(&key_hex);
            let g = &mut st.genesis;
            if g.last_leaf.is_some_and(|last| key <= last) || g.frontier.count >= g.expected_leaves {
                fail(RuleCode::RGenesisOrder, "leaves must be strictly ascending and no more than expected");
            }
            let held = self.positions.get(&(id, HolderId::Solana(key)));
            if held.map(|p| p.tokens_entitled + p.bonus_entitled) != Some(amount.0 as u128) || amount.0 == 0 {
                fail(RuleCode::RGenesisLeaf, "leaf does not match a Solana position");
            }
            g.frontier.push(leaf_hash(&key, amount.0, 0));
            g.leaf_sum += amount.0;
            g.last_leaf = Some(key);
        }
        if st.genesis.frontier.count == st.genesis.expected_leaves {
            self.finish_root(id, &ch, &mut st);
        }
        self.save_state(id, st);
    }

    /// RELAYER, one-shot, after the root is complete. A signed claim about Solana state, audited by verify.sh.
    pub fn confirm_genesis(&mut self, launch_id: U64, mint: String, sigs: Vec<String>, slot: U64, ceremony_hash: String) {
        self.require_relayer();
        self.require_genesis_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.genesis.status != GenesisStatus::Committed || !st.genesis.root_ready {
            fail(RuleCode::RGenesisState, "confirm needs a committed genesis with a complete root");
        }
        if Some(unhex32(&mint)) != st.genesis.mint_address {
            fail(RuleCode::RGenesisArg, "mint is not the committed address");
        }
        if sigs.is_empty() || sigs.len() > MAX_SIGS || sigs.iter().any(|s| s.is_empty() || s.len() > 100) {
            fail(RuleCode::RGenesisArg, "1 to 4 transaction signatures of at most 100 characters");
        }
        let g = &mut st.genesis;
        g.status = GenesisStatus::Confirmed;
        g.tx_sigs = sigs.clone();
        g.slot = slot.0;
        g.ceremony_hash = Some(unhex32(&ceremony_hash));
        emit(
            "genesis_confirmed",
            json!({ "launch_id": id.to_string(), "mint": mint, "sigs": sigs, "slot": slot.0.to_string(), "ceremony_hash": ceremony_hash }),
        );
        self.save_state(id, st);
    }

    /// RELAYER or GUARD, only between commit and confirm.
    pub fn abort_genesis(&mut self, launch_id: U64, reason: String) {
        let p = env::predecessor_account_id();
        if self.cfg.genesis_relayer.as_ref() != Some(&p) && p != self.cfg.guardian {
            fail(RuleCode::RNotAuthorized, "genesis relayer or guardian only");
        }
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.genesis.status != GenesisStatus::Committed {
            fail(RuleCode::RGenesisState, "only a committed, unconfirmed genesis can be aborted");
        }
        if reason.len() > 200 {
            fail(RuleCode::RGenesisArg, "reason is at most 200 bytes");
        }
        st.genesis.status = GenesisStatus::Aborted;
        st.genesis.abort_reason = reason.clone();
        emit("genesis_aborted", json!({ "launch_id": id.to_string(), "by": p, "reason": reason }));
        self.save_state(id, st);
    }

    /// OWNER only. Puts an ABORTED genesis back to its starting state so the relayer can commit again. The relayer and the guardian cannot
    /// do this, so an abort by the guardian stays final until the owner decides otherwise. A confirmed genesis can never be reopened.
    /// The earlier attempt stays in the `genesis_committed` and `genesis_aborted` events; `genesis_reopened` marks the new start.
    pub fn reopen_genesis(&mut self, launch_id: U64) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.genesis.status != GenesisStatus::Aborted {
            fail(RuleCode::RGenesisState, "only an aborted genesis can be reopened");
        }
        st.genesis = GenesisState::default();
        emit("genesis_reopened", json!({ "launch_id": id.to_string(), "by": env::predecessor_account_id() }));
        self.save_state(id, st);
    }

    /// RELAYER: appends the hash of a Verdict Rail attestation (the verify script flags attestations missing from this log).
    pub fn attest_log_append(&mut self, launch_id: U64, attestation_hash: String) {
        self.require_relayer();
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.genesis.status != GenesisStatus::Confirmed || st.genesis.attest_log.len() >= MAX_ATTEST_LOG {
            fail(RuleCode::RGenesisState, "needs a confirmed genesis and room in the log");
        }
        let h = unhex32(&attestation_hash);
        st.genesis.attest_log.push(h);
        emit("attest_log", json!({ "launch_id": id.to_string(), "attestation_hash": attestation_hash }));
        self.save_state(id, st);
    }

    pub fn get_genesis(&self, launch_id: U64) -> Option<Value> {
        let (st, ch) = (self.states.get(&launch_id.0)?, self.charters.get(&launch_id.0)?);
        let g = &st.genesis;
        let h = |v: &Option<[u8; 32]>| v.as_ref().map(|b| hex(b));
        Some(json!({
            "status": format!("{:?}", g.status), "mode": format!("{:?}", ch.genesis.mode), "g_pub": h(&g.g_pub), "mint_address": h(&g.mint_address),
            "expected_leaves": g.expected_leaves, "leaf_count": g.frontier.count, "root_ready": g.root_ready, "merkle_root": h(&g.merkle_root),
            "genesis_spec_hash": h(&g.genesis_spec_hash), "max_total_claim": g.expected_total.to_string(), "sol_mint_supply": g.sol_mint_supply.to_string(),
            "tx_sigs": g.tx_sigs, "slot": g.slot.to_string(), "ceremony_hash": h(&g.ceremony_hash),
            "attest_log": g.attest_log.iter().map(|b| hex(b)).collect::<Vec<_>>(), "abort_reason": g.abort_reason,
            "plan": { "decimals": ch.genesis.decimals, "mint_authority_none": ch.genesis.mint_authority_none, "freeze_authority_none": ch.genesis.freeze_authority_none,
                      "extensions_allowed": ch.genesis.extensions_allowed, "lp_mirror_to_solana": ch.genesis.lp_mirror_to_solana, "reserve_bps": ch.genesis.reserve_bps,
                      "clawback_days": ch.genesis.clawback_days, "disclosure": format!("{:?}", ch.genesis.disclosure) },
        }))
    }

    /// The committed GenesisSpec, borsh then base64. `sha256` of the decoded bytes equals `genesis_spec_hash`.
    pub fn get_genesis_spec(&self, launch_id: U64) -> Option<String> {
        let spec = self.states.get(&launch_id.0)?.genesis.spec.as_ref()?;
        Some(base64::engine::general_purpose::STANDARD.encode(spec.canonical_bytes()))
    }

    /// Solana buyers and what each claims. Valid only after `settle_positions_page`; the relayer sorts by pubkey before `build_root_page`.
    pub fn solana_allocations_page(&self, launch_id: U64, from_seq: u32, limit: u32) -> Vec<Value> {
        let id = launch_id.0;
        (from_seq..from_seq.saturating_add(limit.min(50)))
            .filter_map(|s| self.seq_index.get(&(id, s)))
            .filter_map(|h| match h {
                HolderId::Solana(pk) => self
                    .positions
                    .get(&(id, h.clone()))
                    .map(|p| json!({ "pubkey": hex(pk), "amount": (p.tokens_entitled + p.bonus_entitled).to_string() })),
                HolderId::Near(_) => None,
            })
            .collect()
    }
}
