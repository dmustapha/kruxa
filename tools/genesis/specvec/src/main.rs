//! Prints the borsh bytes and the genesis_spec_hash of a GenesisSpec given as JSON, using kruxa-logic (the contract's own code).
//! usage: kruxa-specvec FIELDS.json   (hex fields are 64 chars, u64 as strings). Output: {"spec_hex": .., "spec_hash": ..}
use kruxa_logic::genesis::{Disclosure, GenesisMode, GenesisSpec};
use serde_json::{json, Value};

fn h32(v: &Value, k: &str) -> [u8; 32] {
    let s = v[k].as_str().unwrap_or_else(|| panic!("{k} missing"));
    let mut out = [0u8; 32];
    assert_eq!(s.len(), 64, "{k} must be 64 hex chars");
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("hex");
    }
    out
}
fn st(v: &Value, k: &str) -> String { v[k].as_str().unwrap_or_else(|| panic!("{k} missing")).to_string() }
fn n(v: &Value, k: &str) -> u64 { v[k].as_str().map(|s| s.parse().expect("u64")).or(v[k].as_u64()).unwrap_or_else(|| panic!("{k} missing")) }

fn main() {
    let path = std::env::args().nth(1).expect("usage: kruxa-specvec FIELDS.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("read")).expect("json");
    let buckets = v["buckets"].as_array().expect("buckets").iter().map(|b| (b[0].as_u64().unwrap() as u8, b[1].as_str().unwrap().parse().unwrap())).collect();
    let spec = GenesisSpec {
        spec_version: n(&v, "spec_version") as u8, compiler_version: st(&v, "compiler_version"), chain: st(&v, "chain"),
        cluster_genesis_hash: h32(&v, "cluster_genesis_hash"), launch_id: st(&v, "launch_id"), near_contract: st(&v, "near_contract"),
        near_block_height: n(&v, "near_block_height"), mode: if st(&v, "mode") == "F0" { GenesisMode::F0 } else { GenesisMode::F1 },
        genesis_key_pubkey: h32(&v, "genesis_key_pubkey"), mint_seed: st(&v, "mint_seed"), mint_address: h32(&v, "mint_address"),
        token_program: h32(&v, "token_program"), decimals: n(&v, "decimals") as u8, supply_total: n(&v, "supply_total"),
        name: st(&v, "name"), symbol: st(&v, "symbol"), metadata_uri_sha256: h32(&v, "metadata_uri_sha256"), metadata_hash: h32(&v, "metadata_hash"),
        mint_authority_none: v["mint_authority_none"].as_bool().unwrap(), freeze_authority_none: v["freeze_authority_none"].as_bool().unwrap(),
        extensions_allowed: v["extensions_allowed"].as_bool().unwrap(), buckets,
        reserve_squads_multisig_hash: h32(&v, "reserve_squads_multisig_hash"), reserve_vault_index: n(&v, "reserve_vault_index") as u8,
        reserve_disclosure: if st(&v, "reserve_disclosure") == "Independent2of3" { Disclosure::Independent2of3 } else { Disclosure::SinglePartyDemo },
        merkle_root: h32(&v, "merkle_root"), max_total_claim: n(&v, "max_total_claim"), max_num_nodes: n(&v, "max_num_nodes") as u32,
        clawback_days: n(&v, "clawback_days") as u16,
    };
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    println!("{}", json!({ "spec_hex": hex(&spec.canonical_bytes()), "spec_hash": hex(&spec.hash()) }));
}
