use kruxa_logic::{EVENT_STANDARD, EVENT_VERSION};
use near_sdk::log;
use near_sdk::serde_json::{json, Value};

/// NEP-297 event. `data` is always a single object; no unbounded arrays.
pub fn emit(event: &str, data: Value) {
    log!("EVENT_JSON:{}", json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] }));
}
