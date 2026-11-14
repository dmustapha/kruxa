//! State owned by the admin and exit-convenience methods (upgrade queue, queued force-resolves, stream lengthening,
//! owed NEAR, credited S4 payload hashes). One additive field on `Contract`, so the existing layout is untouched.
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, AccountId};

use crate::Contract;

/// Storage prefixes. The core's own maps use the one-byte `Key` enum (0, 1, 2, ...), so these start with a byte (b'x') that enum never reaches.
const OPS: &[u8] = b"x:ops";
const STREAM: &[u8] = b"x:stream";
const OWED: &[u8] = b"x:owed";
const CREDITED: &[u8] = b"x:cred";
/// Guardian freeze barrier: a raw little-endian u64 under one key, NOT a struct field, so the deployed `Contract` borsh layout is unchanged.
/// Absent means 0 (no freeze has happened yet), which never blocks.
const FREEZE_BARRIER: &[u8] = b"x:fbar";

/// A lengthened stream: the unlocked amount at the change (`base`) and the new line from there to `end_ns`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StreamExt {
    pub base: u128,
    pub base_ns: u64,
    pub end_ns: u64,
}

#[near(serializers = [borsh])]
pub struct Extra {
    /// Queued code hash (lowercase hex sha256) and the time it may be deployed.
    pub upgrade: Option<(String, u64)>,
    /// sha256 of a queued `force_resolve_op` call -> the time it may run.
    pub queued_ops: LookupMap<[u8; 32], u64>,
    pub stream_ext: LookupMap<u64, StreamExt>,
    /// NEAR pushes that failed; the account pulls them with `withdraw_owed`.
    pub owed_near: LookupMap<AccountId, u128>,
    /// sha256 of S4 payloads already credited or in flight (blocks a double credit between S4 and the orphan claim).
    pub credited: LookupSet<[u8; 32]>,
}

impl Extra {
    pub fn new() -> Self {
        Self {
            upgrade: None,
            queued_ops: LookupMap::new(OPS),
            stream_ext: LookupMap::new(STREAM),
            owed_near: LookupMap::new(OWED),
            credited: LookupSet::new(CREDITED),
        }
    }
}

impl Contract {
    pub(crate) fn freeze_barrier_ns(&self) -> u64 {
        env::storage_read(FREEZE_BARRIER).and_then(|b| <[u8; 8]>::try_from(b).ok()).map_or(0, u64::from_le_bytes)
    }

    pub(crate) fn set_freeze_barrier_ns(&mut self, at: u64) {
        env::storage_write(FREEZE_BARRIER, &at.to_le_bytes());
    }

    /// The demo profile uses a short clock (like `Rules::demo_clock`) so a sandbox can fast-forward through it; every other profile keeps the real delay.
    pub(crate) fn delay_ns(&self, real: u64) -> u64 {
        if self.cfg.profile == "demo" {
            crate::DEMO_DELAY_NS
        } else {
            real
        }
    }
}
