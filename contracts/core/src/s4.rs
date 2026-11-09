//! S4 fallback (cargo feature `s4-fallback`): anyone submits a buyer-signed raw_ed25519 transfer intent.
//! The contract parses the payload with a strict typed struct, checks it against the commit rules, then forwards
//! the SAME signed bytes to intents.near.execute_intents. The Verifier authenticates signer and key; we only attribute.
//! `claim_orphan_credit` covers the other order of events: someone else already executed the signed payload at the
//! Verifier, so the money sits in our Intents balance with no credit.
use crate::ContractExt;
use kruxa_logic::{hex, RuleCode};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{bs58, env, near, AccountId, Gas, Promise};
use std::collections::BTreeMap;

use crate::events::emit;
use crate::ext::ext_intents;
use crate::model::*;
use crate::{fail, Contract, GAS_CB};

#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
struct S4Payload {
    signer_id: AccountId,
    verifying_contract: AccountId,
    deadline: String,
    nonce: String,
    intents: Vec<S4Intent>,
}

#[near(serializers = [json])]
#[serde(tag = "intent", rename_all = "snake_case", deny_unknown_fields)]
enum S4Intent {
    Transfer { receiver_id: AccountId, tokens: BTreeMap<String, String>, memo: Option<String> },
}

/// memo = "kruxa:v1:t=<launch id>;d=sol:<base58>;fee=<micro-USDC>"
fn parse_memo(memo: &str) -> Option<(u64, String, u128)> {
    let body = memo.strip_prefix("kruxa:v1:")?;
    let (mut t, mut d, mut f) = (None, None, None);
    for part in body.split(';') {
        match part.split_once('=')? {
            ("t", v) if t.is_none() => t = Some(v.parse().ok()?),
            ("d", v) if d.is_none() => d = Some(v.to_string()),
            ("fee", v) if f.is_none() => f = Some(v.parse().ok()?),
            _ => return None,
        }
    }
    Some((t?, d?, f?))
}

fn pubkey(signed: &Value) -> Option<[u8; 32]> {
    let raw = bs58::decode(signed.get("public_key")?.as_str()?.strip_prefix("ed25519:")?).into_vec().ok()?;
    <[u8; 32]>::try_from(raw.as_slice()).ok()
}

/// A signed S4 payload that passed every shape check.
struct S4Parsed {
    id: u64,
    holder: HolderId,
    amount: u128,
    fee: u128,
    pk: [u8; 32],
    signer: AccountId,
    nonce: String,
    raw: String,
}

fn parse_s4(contract: &Contract, signed: &Value) -> S4Parsed {
    let bad = |t: &str| -> ! { fail(RuleCode::RSignedMsg, t) };
    if signed.get("standard").and_then(Value::as_str) != Some("raw_ed25519") {
        bad("only the raw_ed25519 standard (Phantom) is accepted");
    }
    let raw = signed.get("payload").and_then(Value::as_str).unwrap_or_else(|| bad("payload must be a string"));
    let payload: S4Payload = serde_json::from_str(raw).unwrap_or_else(|_| bad("payload is not the strict Kruxa transfer shape"));
    let pk = pubkey(signed).unwrap_or_else(|| bad("public_key must be ed25519:<base58 of 32 bytes>"));
    if payload.verifying_contract != contract.cfg.intents || payload.signer_id.as_str() != hex(&pk) {
        bad("verifying_contract must be intents.near and signer_id the lowercase hex of the key");
    }
    let [S4Intent::Transfer { receiver_id, tokens, memo }] = payload.intents.as_slice() else { bad("exactly one transfer intent") };
    let amount = match tokens.iter().collect::<Vec<_>>().as_slice() {
        [(token, amount)] if **token == contract.cfg.usdc_token_id => {
            amount.parse::<u128>().unwrap_or_else(|_| bad("amount is not a decimal string"))
        }
        _ => bad("exactly one token, and it must be USDC"),
    };
    if *receiver_id != env::current_account_id() {
        bad("receiver_id must be this contract");
    }
    let (id, deliver, fee) =
        parse_memo(memo.as_deref().unwrap_or("")).unwrap_or_else(|| bad("memo must be kruxa:v1:t=<id>;d=sol:<key>;fee=<micro>"));
    let holder = HolderId::parse(&deliver).filter(|h| *h == HolderId::Solana(pk)).unwrap_or_else(|| bad("d must be sol:<the signing key>"));
    S4Parsed { id, holder, amount, fee, pk, signer: payload.signer_id.clone(), nonce: payload.nonce.clone(), raw: raw.to_string() }
}

#[near]
impl Contract {
    pub fn contribute_via_intents(&mut self, signed: Value) -> Promise {
        self.require_live();
        let p = parse_s4(self, &signed);
        if let Err(v) = self.check_commit(p.id, &p.holder, Custody::Intents, p.amount, p.fee) {
            env::panic_str(&v.message());
        }
        let hash = env::sha256_array(p.raw.as_bytes());
        if !self.x.credited.insert(hash) {
            fail(RuleCode::RNothing, "this payload is already credited or in flight");
        }
        emit("contribution_submitted", json!({ "launch_id": p.id.to_string(), "holder": p.holder.key(), "amount": p.amount.to_string() }));
        ext_intents::ext(self.cfg.intents.clone()).with_static_gas(Gas::from_tgas(150)).execute_intents(vec![signed]).then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_contribute_intents(
                U64(p.id),
                p.holder.key(),
                U128(p.amount),
                U128(p.fee),
                hex(&hash),
            ),
        )
    }

    #[private]
    pub fn on_contribute_intents(&mut self, launch_id: U64, holder: String, amount: U128, fee: U128, payload_hash: String) {
        if env::promise_result_checked(0, 1 << 16).is_err() {
            // Nothing moved at the Verifier, so the same payload may be submitted again.
            if let Some(h) = crate::intake::hex32(&payload_hash) {
                self.x.credited.remove(&h);
            }
            emit("contribution_failed", json!({ "launch_id": launch_id.0.to_string(), "holder": holder }));
            return;
        }
        if let Some(h) = HolderId::parse(&holder) {
            self.attribute_intents(launch_id.0, h, amount.0, fee.0);
        }
    }

    /// Anyone. The signer's payload was executed at the Verifier by someone else, so the money is in our Intents balance with
    /// no credit. We re-verify the signature in the contract, then ask the Verifier two things: is that nonce spent, and is our
    /// balance there larger than everything our ledgers already owe. Only then is it credited, exactly like an S4 commit.
    pub fn claim_orphan_credit(&mut self, signed: Value) -> Promise {
        self.require_live();
        let p = parse_s4(self, &signed);
        if self.states.get(&p.id).is_none_or(|s| s.status != Status::Open) {
            fail(RuleCode::RWrongPhase, "orphan credits are attributed while the launch is Open");
        }
        if self.next_launch_id > MAX_SCAN {
            fail(RuleCode::RSolvency, "too many launches to attribute an orphan safely");
        }
        let sig = signed
            .get("signature")
            .and_then(Value::as_str)
            .and_then(|s| bs58::decode(s.strip_prefix("ed25519:")?).into_vec().ok())
            .and_then(|v| <[u8; 64]>::try_from(v.as_slice()).ok())
            .unwrap_or_else(|| fail(RuleCode::RSig, "signature must be ed25519:<base58 of 64 bytes>"));
        if !env::ed25519_verify(&sig, p.raw.as_bytes(), &p.pk) {
            fail(RuleCode::RSig, "signature does not verify");
        }
        let hash = env::sha256_array(p.raw.as_bytes());
        if self.x.credited.contains(&hash) {
            fail(RuleCode::RNothing, "this payload is already credited or in flight");
        }
        ext_intents::ext(self.cfg.intents.clone())
            .with_static_gas(Gas::from_tgas(10))
            .is_nonce_used(p.signer.clone(), p.nonce.clone())
            .and(
                ext_intents::ext(self.cfg.intents.clone())
                    .with_static_gas(Gas::from_tgas(10))
                    .mt_balance_of(env::current_account_id(), self.cfg.usdc_token_id.clone()),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_orphan_checked(
                U64(p.id),
                p.holder.key(),
                U128(p.amount),
                U128(p.fee),
                hex(&hash),
            ))
    }

    #[private]
    pub fn on_orphan_checked(&mut self, launch_id: U64, holder: String, amount: U128, fee: U128, payload_hash: String) {
        let spent = env::promise_result_checked(0, 16).ok().and_then(|b| serde_json::from_slice::<bool>(&b).ok()).unwrap_or(false);
        let balance = env::promise_result_checked(1, 64).ok().and_then(|b| serde_json::from_slice::<U128>(&b).ok()).map_or(0, |u| u.0);
        let (Some(hash), Some(h)) = (crate::intake::hex32(&payload_hash), HolderId::parse(&holder)) else { return };
        let free = balance.saturating_sub(self.intents_ledgered());
        if !spent || free < amount.0 || !self.x.credited.insert(hash) {
            emit("orphan_credit_refused", json!({ "launch_id": launch_id.0.to_string(), "holder": holder, "nonce_spent": spent }));
            return;
        }
        self.attribute_intents(launch_id.0, h, amount.0, fee.0);
    }
}

/// Orphan attribution walks every launch ledger once, so it refuses past this many launches instead of running out of gas.
const MAX_SCAN: u64 = 400;

impl Contract {
    /// Credits Intents money that already sits with us. If the window closed in the meantime it becomes a refundable parked deposit.
    fn attribute_intents(&mut self, id: u64, holder: HolderId, amount: u128, fee: u128) {
        if let Err(v) = self.try_commit(id, holder.clone(), Custody::Intents, amount, fee, None) {
            self.park_rejected(id, holder.clone(), amount);
            emit("deposit_rejected_refundable", json!({ "launch_id": id.to_string(), "holder": holder.key(), "code": v.code.as_str() }));
        }
    }

    /// Everything the ledgers say should be in core's balance at the Verifier (a deliberate over-count while a leg is in flight).
    fn intents_ledgered(&self) -> u128 {
        (1..self.next_launch_id)
            .filter_map(|i| self.states.get(&i))
            .map(|st| {
                let l = &st.ledger;
                l.open_intents
                    + l.due_intents
                    + l.inflight_intents
                    + l.spent_intents.saturating_sub(l.consolidated + l.consolidating)
                    + l.relay_fee_total.saturating_sub(l.relay_fee_paid)
            })
            .sum()
    }

    /// The window closed between forwarding and the callback: the money is already ours, so record it as owed back.
    fn park_rejected(&mut self, id: u64, holder: HolderId, amount: u128) {
        let mut st = self.state(id);
        let key = (id, holder.clone());
        let mut pos = self.positions.get(&key).cloned().unwrap_or_else(|| {
            st.holder_count += 1;
            st.positions_live += 1;
            self.seq_index.insert((id, st.holder_count - 1), holder.clone());
            Position {
                seq: st.holder_count - 1,
                deliver: holder.clone(),
                referrer: None,
                contributed: 0,
                open_native: 0,
                open_intents: 0,
                due_native: 0,
                due_intents: 0,
                inflight_native: 0,
                inflight_intents: 0,
                refunded: 0,
                spent: 0,
                tokens_entitled: 0,
                bonus_entitled: 0,
                claimed: 0,
                claim_inflight: 0,
                settled: false,
            }
        });
        pos.contributed += amount;
        pos.due_intents += amount;
        st.ledger.credited += amount;
        st.ledger.due_intents += amount;
        self.cfg.global_held += amount;
        self.positions.insert(key, pos);
        self.save_state(id, st);
    }
}
