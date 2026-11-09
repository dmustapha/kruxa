//! Stream cap and `lengthen_stream`. The cap is a pure function of the clock; a creator can only slow it, never speed it up.
use crate::ContractExt;
use kruxa_logic::RuleCode;
use kruxa_math::{days_to_ns, linear_unlocked};
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::events::emit;
use crate::extra::StreamExt;
use crate::model::*;
use crate::{fail, Contract};

impl Contract {
    /// When the stream is fully unlocked: the Charter's schedule, or the later end after a lengthening.
    pub(crate) fn stream_end(&self, ch: &Charter, settled_at: u64) -> u64 {
        let planned = settled_at.saturating_add(days_to_ns(ch.params.stream_days as u64).unwrap_or(0));
        self.x.stream_ext.get(&ch.launch_id).map_or(planned, |e| e.end_ns)
    }

    /// What the stream has unlocked at `now` (STREAM_CAP is enforced against this in `draw`). After a lengthening it is the
    /// unlocked amount at the change plus a slower line from there to the new end.
    pub(crate) fn stream_cap(&self, st: &LaunchState, ch: &Charter, settled_at: u64, now: u64) -> u128 {
        let total = st.ledger.stream_total;
        match self.x.stream_ext.get(&ch.launch_id) {
            Some(e) => e.base + linear_unlocked(total - e.base, e.base_ns, e.end_ns - e.base_ns, now).unwrap_or(0),
            None => linear_unlocked(total, settled_at, days_to_ns(ch.params.stream_days as u64).unwrap_or(0), now).unwrap_or(0),
        }
    }
}

#[near]
impl Contract {
    /// Creator only. Moves the end of the stream later, never earlier: the cap stays continuous at the change and is
    /// never higher afterwards than it would have been. Pause does not block it (it only slows the creator).
    pub fn lengthen_stream(&mut self, launch_id: U64, new_duration_days: u16) {
        let id = launch_id.0;
        let (st, ch) = (self.state(id), self.charter(id));
        if env::predecessor_account_id() != ch.creator {
            fail(RuleCode::RNotAuthorized, "creator only");
        }
        let Some(s) = st.settlement.as_ref().filter(|_| st.status == Status::Passed) else {
            fail(RuleCode::RWrongPhase, "a stream exists only after PASS")
        };
        if new_duration_days > ch.rules.max_stream_days {
            fail(RuleCode::RStream, &format!("at most {} days", ch.rules.max_stream_days));
        }
        let now = env::block_timestamp();
        let cur_end = self.stream_end(&ch, s.settled_at);
        if now >= cur_end {
            fail(RuleCode::RTooLate, "the stream is already fully unlocked");
        }
        let new_end = s.settled_at.saturating_add(days_to_ns(new_duration_days as u64).unwrap_or(0));
        if new_end <= cur_end {
            fail(RuleCode::RLengthenOnly, "the new duration must be longer than the current one");
        }
        let base = self.stream_cap(&st, &ch, s.settled_at, now);
        self.x.stream_ext.insert(id, StreamExt { base, base_ns: now, end_ns: new_end });
        emit(
            "stream_lengthened",
            json!({ "launch_id": id.to_string(), "end_ns": new_end.to_string(), "unlocked_at_change": base.to_string() }),
        );
    }
}
