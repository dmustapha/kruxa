//! Records kept BESIDE the stored state, under their own storage prefixes: no `Launcher` field and no `Instant` field changed, so a
//! launcher deployed before these existed still loads every record. A launch or creator without an entry reads as "none":
//! delay 0 (trading opens with the pool) and not indexed.
use crate::kv::Map;
use crate::model::Instant;
use crate::{fail, Launcher, LauncherExt, INSTANT_ID_BASE};
use near_sdk::{near, AccountId};

const P_TRADE_DELAY: u8 = 8;
const P_TRADE_FROM: u8 = 9;
const P_CREATOR_COUNT: u8 = 10;
const P_CREATOR_ITEM: u8 = 11;
const P_INDEXED: u8 = 12;

/// `instants_by_creator` pages are at most this long.
pub const MAX_PAGE: u64 = 50;
pub const DEFAULT_PAGE: u64 = 20;

impl Launcher {
    /// Announced open in seconds, as declared at creation. 0 for a launch created before the field existed.
    pub(crate) fn trade_delay_of(&self, id: u64) -> u32 {
        Map::<u64, u32>::new(P_TRADE_DELAY).get(&id).unwrap_or(0)
    }

    pub(crate) fn set_trade_delay(&mut self, id: u64, secs: u32) {
        Map::<u64, u32>::new(P_TRADE_DELAY).insert(id, secs);
    }

    /// Absolute time sent to the market with the seed leg (0 = none).
    pub(crate) fn trade_from_of(&self, id: u64) -> u64 {
        Map::<u64, u64>::new(P_TRADE_FROM).get(&id).unwrap_or(0)
    }

    pub(crate) fn set_trade_from(&mut self, id: u64, ns: u64) {
        Map::<u64, u64>::new(P_TRADE_FROM).insert(id, ns);
    }

    pub(crate) fn creator_count(&self, creator: &AccountId) -> u64 {
        Map::<AccountId, u64>::new(P_CREATOR_COUNT).get(creator).unwrap_or(0)
    }

    pub(crate) fn creator_item(&self, creator: &AccountId, index: u64) -> Option<u64> {
        Map::<(AccountId, u64), u64>::new(P_CREATOR_ITEM).get(&(creator.clone(), index))
    }

    /// Appends the launch to its creator's list once. Returns false when it was already there.
    pub(crate) fn index_creator(&mut self, r: &Instant) -> bool {
        let mut indexed = Map::<u64, u8>::new(P_INDEXED);
        if indexed.contains(&r.launch_id) {
            return false;
        }
        indexed.insert(r.launch_id, 1);
        let n = self.creator_count(&r.creator);
        Map::<(AccountId, u64), u64>::new(P_CREATOR_ITEM).insert((r.creator.clone(), n), r.launch_id);
        Map::<AccountId, u64>::new(P_CREATOR_COUNT).insert(r.creator.clone(), n + 1);
        true
    }
}

#[near]
impl Launcher {
    /// Anyone. Adds launches created before the creator index existed to their creator's list: ids `from_launch_id` up to
    /// `limit` (at most 50) of them. Idempotent, derived from the stored records only, moves no funds. Returns how many were added.
    pub fn index_creators(&mut self, from_launch_id: near_sdk::json_types::U64, limit: u64) -> u64 {
        let start = from_launch_id.0;
        let end = INSTANT_ID_BASE + self.next_id;
        if start < INSTANT_ID_BASE || limit == 0 || limit > MAX_PAGE {
            fail("R_NOTHING", "from_launch_id must be a launch id and limit 1..=50");
        }
        let mut added = 0;
        for id in start..end.min(start + limit) {
            if let Some(r) = self.instants.get(&id) {
                added += u64::from(self.index_creator(&r));
            }
        }
        added
    }
}
