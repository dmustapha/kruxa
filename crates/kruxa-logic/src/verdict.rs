use borsh::{BorshDeserialize, BorshSerialize};
use kruxa_math::dec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const BELOW_SOFT_CAP: u8 = 1;
pub const BELOW_MIN_FUNDERS: u8 = 2;
pub const CANCELLED: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct VerdictInputs {
    #[serde(with = "dec::u64")]
    pub launch_id: u64,
    pub charter_hash: [u8; 32],
    #[serde(with = "dec::u128")]
    pub total_active: u128,
    pub active_funders: u32,
    #[serde(with = "dec::u128")]
    pub soft_cap: u128,
    pub min_funders: u32,
    pub cancelled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Outcome {
    Pass,
    /// Bitset of BELOW_SOFT_CAP, BELOW_MIN_FUNDERS, CANCELLED.
    Fail(u8),
}

/// The deterministic verdict. No floats, no clock, no address, no discretion.
pub fn verdict(i: &VerdictInputs) -> Outcome {
    let mut reasons = 0u8;
    if i.cancelled {
        reasons |= CANCELLED;
    }
    if i.total_active < i.soft_cap {
        reasons |= BELOW_SOFT_CAP;
    }
    if i.active_funders < i.min_funders {
        reasons |= BELOW_MIN_FUNDERS;
    }
    if reasons == 0 {
        Outcome::Pass
    } else {
        Outcome::Fail(reasons)
    }
}

/// Canonical byte encoding (little endian, fixed order). A judge recomputes this with any language.
pub fn encode_inputs(i: &VerdictInputs) -> Vec<u8> {
    let mut b = Vec::with_capacity(8 + 32 + 16 + 4 + 16 + 4 + 1);
    b.extend_from_slice(&i.launch_id.to_le_bytes());
    b.extend_from_slice(&i.charter_hash);
    b.extend_from_slice(&i.total_active.to_le_bytes());
    b.extend_from_slice(&i.active_funders.to_le_bytes());
    b.extend_from_slice(&i.soft_cap.to_le_bytes());
    b.extend_from_slice(&i.min_funders.to_le_bytes());
    b.push(i.cancelled as u8);
    b
}

pub fn inputs_hash(i: &VerdictInputs) -> [u8; 32] {
    Sha256::digest(encode_inputs(i)).into()
}

/// Rolling book hash: book_k = sha256(book_{k-1} || kind || len(holder) u16 || holder || amount u128 || total_after u128 || funders_after u32).
/// kind: 1 = contributed, 2 = walked. Updated by the contract on every commit and walk; replayed by verify.
pub fn book_next(prev: &[u8; 32], kind: u8, holder: &[u8], amount: u128, total_after: u128, funders_after: u32) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(prev);
    h.update([kind]);
    h.update((holder.len() as u16).to_le_bytes());
    h.update(holder);
    h.update(amount.to_le_bytes());
    h.update(total_after.to_le_bytes());
    h.update(funders_after.to_le_bytes());
    h.finalize().into()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(total: u128, funders: u32, cancelled: bool) -> VerdictInputs {
        VerdictInputs {
            launch_id: 7,
            charter_hash: [9; 32],
            total_active: total,
            active_funders: funders,
            soft_cap: 350_000_000,
            min_funders: 10,
            cancelled,
        }
    }

    #[test]
    fn boundary_is_inclusive() {
        assert_eq!(verdict(&inputs(350_000_000, 10, false)), Outcome::Pass);
        assert_eq!(verdict(&inputs(349_999_999, 10, false)), Outcome::Fail(BELOW_SOFT_CAP));
        assert_eq!(verdict(&inputs(350_000_000, 9, false)), Outcome::Fail(BELOW_MIN_FUNDERS));
    }

    #[test]
    fn empty_book_and_cancel() {
        assert_eq!(verdict(&inputs(0, 0, false)), Outcome::Fail(BELOW_SOFT_CAP | BELOW_MIN_FUNDERS));
        assert_eq!(verdict(&inputs(10u128.pow(12), 500, true)), Outcome::Fail(CANCELLED));
    }

    #[test]
    fn hash_changes_with_any_field_and_book_fold_is_order_sensitive() {
        let a = inputs(350_000_000, 10, false);
        let mut b = a;
        b.total_active += 1;
        assert_ne!(inputs_hash(&a), inputs_hash(&b));
        let z = [0u8; 32];
        let ab = book_next(&book_next(&z, 1, b"a.near", 5, 5, 1), 1, b"b.near", 7, 12, 2);
        let ba = book_next(&book_next(&z, 1, b"b.near", 7, 7, 1), 1, b"a.near", 5, 12, 2);
        assert_ne!(ab, ba);
        assert_eq!(hex(&[0, 255]), "00ff");
    }

    // ---- W1-DC-2 named tests (S1-B 11.2) ----

    #[test]
    fn u_verdict_boundary_eq() {
        let mut i = inputs(350_000_000, 10, false);
        assert_eq!(verdict(&i), Outcome::Pass, "equality on both thresholds passes");
        i.min_funders = 11;
        assert_eq!(verdict(&i), Outcome::Fail(BELOW_MIN_FUNDERS), "raising only the funder threshold by one flips it");
    }

    #[test]
    fn u_verdict_one_below() {
        assert_eq!(verdict(&inputs(349_999_999, 10, false)), Outcome::Fail(BELOW_SOFT_CAP));
        assert_eq!(verdict(&inputs(350_000_000, 9, false)), Outcome::Fail(BELOW_MIN_FUNDERS));
        assert_eq!(verdict(&inputs(349_999_999, 9, false)), Outcome::Fail(BELOW_SOFT_CAP | BELOW_MIN_FUNDERS));
    }

    #[test]
    fn u_verdict_zero() {
        assert_eq!(verdict(&inputs(0, 0, false)), Outcome::Fail(BELOW_SOFT_CAP | BELOW_MIN_FUNDERS));
        assert_eq!(verdict(&inputs(0, 0, true)), Outcome::Fail(BELOW_SOFT_CAP | BELOW_MIN_FUNDERS | CANCELLED));
    }

    /// Reads fixtures/vectors/verdict.json, the same file app/lib/verdict.test.ts reads, so Rust and the TypeScript mirror cannot drift.
    #[test]
    fn u_verdict_hash_golden() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/vectors/verdict.json")).unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() >= 5);
        for c in cases {
            let i: VerdictInputs = serde_json::from_value(c["inputs"].clone()).unwrap();
            let want = match c["outcome"].as_str().unwrap() {
                "PASS" => Outcome::Pass,
                _ => Outcome::Fail(c["reasons"].as_u64().unwrap() as u8),
            };
            assert_eq!(verdict(&i), want, "{}", c["name"]);
            assert_eq!(hex(&inputs_hash(&i)), c["inputs_hash"].as_str().unwrap(), "{}", c["name"]);
        }
    }
}
