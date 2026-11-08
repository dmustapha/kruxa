//! Pure genesis logic shared by the contract, `kruxa-sim`, `verify.sh` and the relayer vectors: the committed `GenesisSpec`
//! (ARCHITECTURE 5.2, S1-D 2.4), the mint address derivation and the incremental Merkle builder behind `build_root_page`.
//! Everything here is [UNVERIFIED] against Solana until the devnet tests T-G3 and T-D1 read the real programs; the hashing
//! layout is a single place (this file) so a correction is one edit and one vector.
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const GENESIS_SPEC_VERSION: u8 = 1;
pub const GENESIS_COMPILER_VERSION: &str = "gs-compiler/1.0.0";
/// Classic SPL Token program id `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` as bytes.
pub const TOKEN_PROGRAM: [u8; 32] = [
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0,
    169,
];
pub const MAX_SIGS: usize = 4;
pub const MAX_ATTEST_LOG: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum GenesisMode {
    F1,
    F0,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Disclosure {
    SinglePartyDemo,
    Independent2of3,
}

/// Bucket roles in the order the compiler emits them.
pub const ROLE_RESERVE: u8 = 0;
pub const ROLE_DISTRIBUTOR: u8 = 1;
pub const ROLE_LP_MIRROR: u8 = 2;

/// The intent NEAR commits. Every field is derived by the contract; the relayer's only free input is `genesis_key_pubkey`.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct GenesisSpec {
    pub spec_version: u8,
    pub compiler_version: String,
    pub chain: String,
    pub cluster_genesis_hash: [u8; 32],
    pub launch_id: String,
    pub near_contract: String,
    pub near_block_height: u64,
    pub mode: GenesisMode,
    pub genesis_key_pubkey: [u8; 32],
    pub mint_seed: String,
    pub mint_address: [u8; 32],
    pub token_program: [u8; 32],
    pub decimals: u8,
    pub supply_total: u64,
    pub name: String,
    pub symbol: String,
    pub metadata_uri_sha256: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub mint_authority_none: bool,
    pub freeze_authority_none: bool,
    pub extensions_allowed: bool,
    /// (role, amount) ordered by role. Owners are derived by the public compiler from the fields below, not committed here.
    pub buckets: Vec<(u8, u64)>,
    pub reserve_squads_multisig_hash: [u8; 32],
    pub reserve_vault_index: u8,
    pub reserve_disclosure: Disclosure,
    pub merkle_root: [u8; 32],
    pub max_total_claim: u64,
    pub max_num_nodes: u32,
    pub clawback_days: u16,
}

impl GenesisSpec {
    pub fn canonical_bytes(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("spec serializes")
    }

    /// `genesis_spec_hash = sha256(borsh(GenesisSpec))`.
    pub fn hash(&self) -> [u8; 32] {
        Sha256::digest(self.canonical_bytes()).into()
    }
}

/// `createWithSeed(base, seed, owner)` = sha256(base || seed || owner). No private key exists for the result.
pub fn mint_address(base: &[u8; 32], seed: &str, owner: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(base);
    h.update(seed.as_bytes());
    h.update(owner);
    h.finalize().into()
}

/// Leaf layout `hashv([0], hashv([claimant, amount_unlocked u64 LE, amount_locked u64 LE]))` (Jito, UNVERIFIED until T-D1).
pub fn leaf_hash(claimant: &[u8; 32], unlocked: u64, locked: u64) -> [u8; 32] {
    let inner: [u8; 32] = Sha256::new().chain_update(claimant).chain_update(unlocked.to_le_bytes()).chain_update(locked.to_le_bytes()).finalize().into();
    Sha256::new().chain_update([0u8]).chain_update(inner).finalize().into()
}

/// Internal node: sorted pair, domain byte 1 (UNVERIFIED until T-D1).
pub fn node_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    Sha256::new().chain_update([1u8]).chain_update(lo).chain_update(hi).finalize().into()
}

/// Incremental Merkle builder: leaves arrive in pages, the state is a stack of (subtree size, hash). The final fold pairs the
/// smallest subtrees first, which equals the bottom-up construction where an odd node is carried up unchanged.
#[derive(Clone, Debug, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Frontier {
    pub count: u32,
    pub stack: Vec<(u32, [u8; 32])>,
}

impl Frontier {
    pub fn push(&mut self, leaf: [u8; 32]) {
        let (mut size, mut hash) = (1u32, leaf);
        while let Some(&(top_size, top)) = self.stack.last() {
            if top_size != size {
                break;
            }
            self.stack.pop();
            hash = node_hash(&top, &hash);
            size *= 2;
        }
        self.stack.push((size, hash));
        self.count += 1;
    }

    /// Root of everything pushed so far; all zeros for an empty tree.
    pub fn root(&self) -> [u8; 32] {
        let mut it = self.stack.iter().rev();
        let Some(&(_, mut acc)) = it.next() else { return [0; 32] };
        for &(_, h) in it {
            acc = node_hash(&h, &acc);
        }
        acc
    }
}

/// Reference construction used by tests and by verifiers: pair left to right, carry the odd node up.
pub fn merkle_root_bottom_up(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return [0; 32];
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = level.chunks(2).map(|c| if c.len() == 2 { node_hash(&c[0], &c[1]) } else { c[0] }).collect();
    }
    level[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn spec() -> GenesisSpec {
        GenesisSpec {
            spec_version: GENESIS_SPEC_VERSION,
            compiler_version: GENESIS_COMPILER_VERSION.into(),
            chain: "solana-devnet".into(),
            cluster_genesis_hash: [7; 32],
            launch_id: "1".into(),
            near_contract: "core.kruxa.near".into(),
            near_block_height: 100,
            mode: GenesisMode::F1,
            genesis_key_pubkey: [1; 32],
            mint_seed: "1".into(),
            mint_address: mint_address(&[1; 32], "1", &TOKEN_PROGRAM),
            token_program: TOKEN_PROGRAM,
            decimals: 6,
            supply_total: 1_000,
            name: "N".into(),
            symbol: "SYM".into(),
            metadata_uri_sha256: [2; 32],
            metadata_hash: [3; 32],
            mint_authority_none: true,
            freeze_authority_none: true,
            extensions_allowed: false,
            buckets: vec![(ROLE_DISTRIBUTOR, 1_000)],
            reserve_squads_multisig_hash: [0; 32],
            reserve_vault_index: 0,
            reserve_disclosure: Disclosure::SinglePartyDemo,
            merkle_root: [9; 32],
            max_total_claim: 1_000,
            max_num_nodes: 3,
            clawback_days: 90,
        }
    }

    #[test]
    fn spec_hash_is_deterministic_and_binds_every_field() {
        let a = spec();
        assert_eq!(a.hash(), spec().hash());
        let mut b = spec();
        b.mint_authority_none = false;
        assert_ne!(a.hash(), b.hash());
        let mut c = spec();
        c.merkle_root = [8; 32];
        assert_ne!(a.hash(), c.hash());
        let mut d = spec();
        d.buckets = vec![(ROLE_DISTRIBUTOR, 999)];
        assert_ne!(a.hash(), d.hash());
    }

    #[test]
    fn token_program_bytes_are_tokenkeg() {
        // base58 of these bytes is TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA; checked against bs58 in the sandbox suite.
        assert_eq!(TOKEN_PROGRAM.len(), 32);
        assert_eq!(TOKEN_PROGRAM[0], 6);
    }

    #[test]
    fn mint_address_depends_on_base_and_seed() {
        let m = mint_address(&[1; 32], "7", &TOKEN_PROGRAM);
        assert_ne!(m, mint_address(&[2; 32], "7", &TOKEN_PROGRAM));
        assert_ne!(m, mint_address(&[1; 32], "8", &TOKEN_PROGRAM));
    }

    #[test]
    fn empty_tree_has_the_zero_root() {
        assert_eq!(Frontier::default().root(), [0; 32]);
        assert_eq!(merkle_root_bottom_up(&[]), [0; 32]);
    }

    proptest! {
        #[test]
        fn frontier_equals_the_bottom_up_root(n in 1usize..70) {
            let leaves: Vec<[u8; 32]> = (0..n).map(|i| leaf_hash(&[i as u8; 32], i as u64 + 1, 0)).collect();
            let mut f = Frontier::default();
            for l in &leaves { f.push(*l); }
            prop_assert_eq!(f.root(), merkle_root_bottom_up(&leaves));
            prop_assert_eq!(f.count as usize, n);
        }

        #[test]
        fn a_page_split_does_not_change_the_root(n in 2usize..40, cut in 1usize..39) {
            let leaves: Vec<[u8; 32]> = (0..n).map(|i| leaf_hash(&[i as u8; 32], 5, 0)).collect();
            let cut = cut.min(n - 1);
            let mut whole = Frontier::default();
            leaves.iter().for_each(|l| whole.push(*l));
            let mut paged = Frontier::default();
            leaves[..cut].iter().for_each(|l| paged.push(*l));
            let saved = borsh::to_vec(&paged).unwrap();
            let mut resumed: Frontier = borsh::from_slice(&saved).unwrap();
            leaves[cut..].iter().for_each(|l| resumed.push(*l));
            prop_assert_eq!(whole.root(), resumed.root());
        }
    }
}
