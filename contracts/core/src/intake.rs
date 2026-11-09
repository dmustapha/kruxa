use crate::ContractExt;
use kruxa_logic::{book_next, hex, phase_at, walk_window_open, Phase, RuleCode, RuleViolation};
use kruxa_math::bps_floor;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::{assert_one_yocto, bs58, env, near, AccountId, PromiseOrValue};

use crate::events::emit;
use crate::model::*;
use crate::{fail, Contract};

/// Commit message carried by ft_transfer_call (native path) and by the signed intent's flat `msg` (S3 path).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
pub struct IntakeMsg {
    pub v: u8,
    pub op: String,
    pub launch_id: String,
    pub deliver: Option<String>,
    pub relay_fee: Option<String>,
    pub referrer: Option<AccountId>,
}

pub(crate) fn parse_msg(msg: &str) -> Result<(u64, IntakeMsg), RuleViolation> {
    let bad = |t: &str| RuleViolation::new(RuleCode::RSignedMsg, "msg", t, "v1 contribute JSON <= 512 bytes");
    if msg.len() > 512 {
        return Err(bad("too long"));
    }
    let m: IntakeMsg = serde_json::from_str(msg).map_err(|_| bad("not valid IntakeMsg JSON"))?;
    if m.v != 1 || m.op != "contribute" {
        return Err(bad("unknown version or op"));
    }
    let id = m.launch_id.parse::<u64>().map_err(|_| bad("launch_id is not a u64 string"))?;
    Ok((id, m))
}

/// 64 lowercase hex chars -> 32 bytes.
pub(crate) fn hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(out)
}

/// RECONCILED row 13: a hex signer is a Solana holder ONLY if `deliver == sol:<same key>`. Any other mix is R_DELIVER.
pub(crate) fn resolve_holder(sender: &AccountId, deliver: &Option<String>, custody: Custody) -> Result<HolderId, RuleViolation> {
    let bad = |t: &str| RuleViolation::new(RuleCode::RDeliver, "deliver", t, "near:<sender> or sol:<same key as signer>");
    match deliver.as_deref() {
        None => Ok(HolderId::Near(sender.clone())),
        Some(d) if d == format!("near:{}", sender) => Ok(HolderId::Near(sender.clone())),
        Some(d) if d.starts_with("sol:") && custody == Custody::Intents => match (HolderId::parse(d), hex32(sender.as_str())) {
            (Some(HolderId::Solana(a)), Some(b)) if a == b => Ok(HolderId::Solana(a)),
            _ => Err(bad("signer is not the delivered Solana key")),
        },
        Some(_) => Err(bad("unsupported deliver for this path")),
    }
}

#[near]
impl Contract {
    /// Native path: USDC.ft_transfer_call(core, amount, msg). Rejections return the whole amount; they never panic.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.cfg.usdc {
            // A different token contract. Nothing is credited; the amount goes back to that token's sender.
            emit(
                "deposit_rejected",
                json!({ "payer": sender_id, "amount": amount.0.to_string(), "code": RuleCode::RUnexpectedToken.as_str(), "token": env::predecessor_account_id() }),
            );
            return PromiseOrValue::Value(amount);
        }
        let accepted = parse_msg(&msg).and_then(|(id, m)| {
            let holder = resolve_holder(&sender_id, &m.deliver, Custody::Native)?;
            if m.relay_fee.is_some() {
                return Err(RuleViolation::new(RuleCode::RRelayFee, "relay_fee", "set", "absent on the native path"));
            }
            self.try_commit(id, holder, Custody::Native, amount.0, 0, m.referrer)
        });
        match accepted {
            Ok(()) => PromiseOrValue::Value(U128(0)),
            Err(v) => {
                emit(
                    "deposit_rejected",
                    json!({ "payer": sender_id, "amount": amount.0.to_string(), "code": v.code.as_str(), "detail": v.message() }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Intents path (S3 primary, S2 identical): intents.near moved the balance to us BEFORE this call.
    /// Returning the amounts refunds them to the signer's Intents balance automatically; so does a panic.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        if env::predecessor_account_id() != self.cfg.intents {
            fail(RuleCode::RNotAuthorized, "mt_on_transfer is callable by intents.near only");
        }
        let refund = || PromiseOrValue::Value(amounts.clone());
        if token_ids.len() != 1
            || amounts.len() != 1
            || token_ids[0] != self.cfg.usdc_token_id
            || previous_owner_ids.first() != Some(&sender_id)
        {
            return refund();
        }
        let gross = amounts[0].0;
        let accepted = parse_msg(&msg).and_then(|(id, m)| {
            let holder = resolve_holder(&sender_id, &m.deliver, Custody::Intents)?;
            let fee = m
                .relay_fee
                .as_deref()
                .map(str::parse::<u128>)
                .transpose()
                .map_err(|_| RuleViolation::new(RuleCode::RRelayFee, "relay_fee", "not a u128", "decimal string"))?
                .unwrap_or(0);
            self.try_commit(id, holder, Custody::Intents, gross, fee, m.referrer)
        });
        match accepted {
            Ok(()) => PromiseOrValue::Value(vec![U128(0)]),
            Err(v) => {
                emit(
                    "deposit_rejected",
                    json!({ "payer": sender_id, "amount": gross.to_string(), "code": v.code.as_str(), "detail": v.message() }),
                );
                refund()
            }
        }
    }

    /// Exit by the holder's own NEAR key. 1 yocto forces a wallet confirmation.
    #[payable]
    pub fn walk(&mut self, launch_id: U64) -> PromiseOrValue<bool> {
        assert_one_yocto();
        self.require_exit_open();
        let holder = HolderId::Near(env::predecessor_account_id());
        self.walk_inner(launch_id.0, holder)
    }

    /// Exit authorised by an ed25519 signature, for payers with no NEAR key (Phantom-only). Anyone may submit;
    /// the refund destination is fixed by the position. Preimage: kruxa:walk:v1|<contract>|<launch_id>|<holder key>|<nonce>|<deadline_ns>.
    pub fn walk_signed(&mut self, launch_id: U64, holder: String, nonce: U64, deadline: U64, signature: String) -> PromiseOrValue<bool> {
        self.require_exit_open();
        let Some(HolderId::Solana(pk)) = HolderId::parse(&holder) else { fail(RuleCode::RDeliver, "holder must be sol:<base58 key>") };
        if env::block_timestamp() > deadline.0 {
            fail(RuleCode::RDeadline, "signature expired");
        }
        if nonce.0 <= self.walk_nonces.get(&pk).copied().unwrap_or(0) {
            fail(RuleCode::RNonce, "nonce must increase");
        }
        let sig = bs58::decode(&signature)
            .into_vec()
            .ok()
            .and_then(|v| <[u8; 64]>::try_from(v.as_slice()).ok())
            .unwrap_or_else(|| fail(RuleCode::RSig, "signature must be base58 of 64 bytes"));
        let msg = format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env::current_account_id(), launch_id.0, holder, nonce.0, deadline.0);
        if !env::ed25519_verify(&sig, msg.as_bytes(), &pk) {
            fail(RuleCode::RSig, "signature does not verify");
        }
        self.walk_nonces.insert(pk, nonce.0);
        self.walk_inner(launch_id.0, HolderId::Solana(pk))
    }
}

impl Contract {
    /// Non-mutating admission check shared by every commit path (used again by S4 before forwarding).
    pub(crate) fn check_commit(&self, id: u64, holder: &HolderId, custody: Custody, gross: u128, fee: u128) -> Result<u128, RuleViolation> {
        let v = |c: RuleCode, f: &'static str, got: String, lim: String| RuleViolation::new(c, f, got, lim);
        if self.pause_level() != PauseLevel::None {
            return Err(v(RuleCode::RPaused, "pause", "on".into(), "none".into()));
        }
        let (Some(ch), Some(st)) = (self.charters.get(&id), self.states.get(&id)) else {
            return Err(v(RuleCode::RNoLaunch, "launch_id", id.to_string(), "exists".into()));
        };
        if st.status != Status::Open || phase_at(env::block_timestamp(), ch.opens_at, ch.commit_end, ch.walk_end) != Phase::Open {
            return Err(v(RuleCode::RWrongPhase, "phase", format!("{:?}", st.status), "Open window".into()));
        }
        if st.halted {
            return Err(v(RuleCode::RHalted, "launch", id.to_string(), "not halted".into()));
        }
        if let HolderId::Near(a) = holder {
            if *a == ch.creator || *a == ch.stream_recipient {
                return Err(v(RuleCode::RSelfBuy, "holder", a.to_string(), "not creator or payee".into()));
            }
        }
        let max_fee = ch.rules.max_relay_fee_abs.min(bps_floor(gross, ch.rules.max_relay_fee_bps).unwrap_or(0));
        if fee > max_fee || (custody == Custody::Native && fee != 0) {
            return Err(v(RuleCode::RRelayFee, "relay_fee", fee.to_string(), format!("<= {}", max_fee)));
        }
        let net = gross.saturating_sub(fee);
        if net < ch.params.min_buy {
            return Err(v(RuleCode::RMinContribution, "net amount", net.to_string(), format!(">= {}", ch.params.min_buy)));
        }
        let existing = self.positions.get(&(id, holder.clone()));
        if existing.map_or(0, |p| p.open()) + net > ch.derived.wallet_cap {
            return Err(v(RuleCode::RCapAccount, "wallet total", net.to_string(), format!("<= {}", ch.derived.wallet_cap)));
        }
        if existing.is_none() && st.holder_count >= ch.derived.max_holders {
            return Err(v(RuleCode::RCapHolders, "holders", st.holder_count.to_string(), format!("< {}", ch.derived.max_holders)));
        }
        if st.total_active + net > ch.derived.max_total_held {
            return Err(v(
                RuleCode::RCapLaunch,
                "launch total",
                (st.total_active + net).to_string(),
                format!("<= {}", ch.derived.max_total_held),
            ));
        }
        if self.cfg.global_held + net > self.cfg.global_cap {
            return Err(v(
                RuleCode::RCapGlobal,
                "global held",
                (self.cfg.global_held + net).to_string(),
                format!("<= {}", self.cfg.global_cap),
            ));
        }
        Ok(net)
    }

    /// Single choke point that credits money. All checks first, then every mutation. No promises inside.
    pub(crate) fn try_commit(
        &mut self,
        id: u64,
        holder: HolderId,
        custody: Custody,
        gross: u128,
        fee: u128,
        referrer: Option<AccountId>,
    ) -> Result<(), RuleViolation> {
        let net = self.check_commit(id, &holder, custody, gross, fee)?;
        let mut st = self.state(id);
        let key = (id, holder.clone());
        let mut pos = match self.positions.get(&key).cloned() {
            Some(p) => p,
            None => {
                st.holder_count += 1;
                st.positions_live += 1;
                self.seq_index.insert((id, st.holder_count - 1), holder.clone());
                Position {
                    seq: st.holder_count - 1,
                    deliver: holder.clone(),
                    referrer,
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
                    settled: false,
                }
            }
        };
        if pos.open() == 0 {
            st.active_funders += 1;
        }
        pos.contributed += net;
        match custody {
            Custody::Native => {
                pos.open_native += net;
                st.ledger.open_native += net;
            }
            Custody::Intents => {
                pos.open_intents += net;
                st.ledger.open_intents += net;
            }
        }
        st.ledger.credited += net;
        st.ledger.relay_fee_total += fee;
        st.total_active += net;
        self.cfg.global_held += net;
        st.book_hash = book_next(&st.book_hash, 1, holder.key().as_bytes(), net, st.total_active, st.active_funders);
        emit(
            "contributed",
            json!({ "launch_id": id.to_string(), "holder": holder.key(), "net": net.to_string(), "relay_fee": fee.to_string(), "custody": format!("{:?}", custody), "total_active": st.total_active.to_string(), "funders": st.active_funders, "book_hash": hex(&st.book_hash) }),
        );
        self.positions.insert(key, pos);
        self.save_state(id, st);
        Ok(())
    }

    /// Step 1 is synchronous and atomic: the verdict inputs shrink and the money becomes `due`. Step 2 pays it out (retryable).
    pub(crate) fn walk_inner(&mut self, id: u64, holder: HolderId) -> PromiseOrValue<bool> {
        let (mut st, ch) = (self.state(id), self.charter(id));
        let now = env::block_timestamp();
        if st.status != Status::Open || !walk_window_open(now, ch.opens_at, ch.walk_end) {
            fail(RuleCode::RWalkClosed, "Walk is open from opens_at until walk_end");
        }
        let key = (id, holder.clone());
        let mut pos = self.positions.get(&key).cloned().unwrap_or_else(|| fail(RuleCode::RNoPosition, "no position for this holder"));
        let (on, oi) = (pos.open_native, pos.open_intents);
        if on + oi == 0 {
            fail(RuleCode::RNoPosition, "position has nothing active");
        }
        pos.open_native = 0;
        pos.open_intents = 0;
        pos.due_native += on;
        pos.due_intents += oi;
        let l = &mut st.ledger;
        l.open_native -= on;
        l.open_intents -= oi;
        l.due_native += on;
        l.due_intents += oi;
        st.total_active -= on + oi;
        st.active_funders -= 1;
        st.book_hash = book_next(&st.book_hash, 2, holder.key().as_bytes(), on + oi, st.total_active, st.active_funders);
        emit(
            "walked",
            json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": (on + oi).to_string(), "total_active": st.total_active.to_string(), "funders": st.active_funders, "book_hash": hex(&st.book_hash) }),
        );
        self.positions.insert(key, pos);
        self.save_state(id, st);
        self.pay_due(id, &holder);
        PromiseOrValue::Value(true)
    }
}
