//! D-3: the `open_market` handoff (docs/interfaces/HANDOFF.md). Debit first, two `ft_transfer_call` legs, a callback that re-credits.
use crate::ContractExt;
use kruxa_logic::{hex, RuleCode};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, Gas, NearToken};

use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::{fail, Contract, GAS_CB, ONE_YOCTO};

const GAS_LEG: Gas = Gas::from_tgas(90);
const GAS_REG: Gas = Gas::from_tgas(15);

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketLeg {
    Seed,
    Token,
}

/// `null` = revoked (the plan only accepts revoked authorities, R_GENESIS_AUTH), anything else would name the holder. Describes the Solana mint.
fn authority(revoked: bool) -> Option<&'static str> {
    if revoked {
        None
    } else {
        Some("unrevoked")
    }
}

impl Contract {
    fn seed_msg(&self, ch: &Charter, st: &LaunchState, token: &AccountId) -> String {
        json!({ "v": 1, "op": "seed_quote", "launch_id": ch.launch_id.to_string(), "token": token, "payout_recipient": ch.stream_recipient,
                "total_supply": ch.derived.n_total.to_string(), "charter_hash": hex(&st.charter_hash), "mint_authority": authority(ch.genesis.mint_authority_none),
                "freeze_authority": authority(ch.genesis.freeze_authority_none), "terms": ch.params.fees })
        .to_string()
    }

    fn require_handoff_ready(&self, st: &LaunchState) {
        self.require_buckets_ready(st);
        let l = &st.ledger;
        let fee_done = l.launch_fee_paid == l.launch_fee_due && l.launch_fee_inflight == 0;
        if !fee_done || l.consolidated != l.spent_intents || l.consolidating != 0 {
            fail(RuleCode::RNotClear, "pay_launch_fee and consolidate must be finished before open_market");
        }
    }

    fn market_link_json(&self, st: &LaunchState, ch: &Charter) -> Value {
        let l = &st.ledger;
        let opened = l.lp_seed_sent > 0 && l.lp_seed_due == 0 && l.lp_seed_inflight == 0 && l.lp_tokens_sent == ch.derived.n_lp;
        json!({ "opened": opened,
                "lp_seed_due": l.lp_seed_due.to_string(), "lp_seed_inflight": l.lp_seed_inflight.to_string(), "lp_seed_sent": l.lp_seed_sent.to_string(),
                "lp_tokens_inflight": l.lp_tokens_inflight.to_string(), "lp_tokens_sent": l.lp_tokens_sent.to_string(), "lp_tokens_total": ch.derived.n_lp.to_string() })
    }
}

#[near]
impl Contract {
    /// OWNER, before the first `open_market`: names the market contract that receives every LP seed.
    pub fn set_market(&mut self, account: AccountId) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
        if self.cfg.market_locked {
            fail(RuleCode::RNothing, "market is locked after the first open_market");
        }
        emit("market_set", json!({ "market": account }));
        self.cfg.market = Some(account);
    }

    /// ANY, after settle, every position settled, sweep_residue, consolidate and pay_launch_fee. Never called inside `settle`.
    /// Returns how many legs were sent. A retry sends only what is still missing.
    pub fn open_market(&mut self, launch_id: U64) -> u8 {
        self.require_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        let Some(market) = self.cfg.market.clone() else { fail(RuleCode::RNothing, "market account not set") };
        self.require_handoff_ready(&st);
        if ch.genesis.lp_mirror_to_solana {
            fail(RuleCode::RNotClear, "the LP bucket is mirrored to Solana; it cannot also go to the NEAR market");
        }
        let token = st.token.clone().expect("Passed launches have a token");
        let seed = st.ledger.lp_seed_due;
        let tokens = ch.derived.n_lp - st.ledger.lp_tokens_sent - st.ledger.lp_tokens_inflight;
        if seed == 0 && tokens == 0 {
            fail(RuleCode::RNothing, "nothing left to hand to the market");
        }
        let seed_msg = self.seed_msg(&ch, &st, &token);
        st.ledger.lp_seed_due = 0;
        st.ledger.lp_seed_inflight += seed;
        st.ledger.lp_tokens_inflight += tokens;
        self.save_state(id, st);
        self.cfg.market_locked = true;
        emit(
            "market_handoff",
            json!({ "launch_id": id.to_string(), "market": market, "lp_seed": seed.to_string(), "lp_tokens": tokens.to_string() }),
        );
        let mut sent = 0;
        if seed > 0 {
            self.send_leg(self.cfg.usdc.clone(), &market, seed, seed_msg, id, MarketLeg::Seed);
            sent += 1;
        }
        if tokens > 0 {
            let msg = json!({ "v": 1, "op": "open_pool_token", "launch_id": id.to_string() }).to_string();
            self.send_leg(token, &market, tokens, msg, id, MarketLeg::Token);
            sent += 1;
        }
        sent
    }

    /// Resolves one leg. `used` is what the market consumed (NEP-141 result); a failed promise means nothing moved.
    #[private]
    pub fn on_market_leg(&mut self, launch_id: U64, leg: MarketLeg, amount: U128) {
        let used = match env::promise_result_checked(0, 64) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).map_or(0, |u| u.0.min(amount.0)),
            Err(_) => 0,
        };
        let (a, id) = (amount.0, launch_id.0);
        let Some(mut st) = self.states.get(&id).cloned() else { return };
        let l = &mut st.ledger;
        match leg {
            MarketLeg::Seed => {
                l.lp_seed_inflight = l.lp_seed_inflight.saturating_sub(a);
                l.lp_seed_sent += used;
                l.lp_seed_due += a - used;
                self.cfg.global_held = self.cfg.global_held.saturating_sub(used);
            }
            MarketLeg::Token => {
                l.lp_tokens_inflight = l.lp_tokens_inflight.saturating_sub(a);
                l.lp_tokens_sent += used;
            }
        }
        let done = l.lp_seed_due == 0 && l.lp_seed_inflight == 0 && l.lp_tokens_inflight == 0;
        let (seed_total, tokens_sent) = (l.lp_seed_sent, l.lp_tokens_sent);
        emit(
            "market_leg_resolved",
            json!({ "launch_id": id.to_string(), "leg": format!("{:?}", leg), "amount": a.to_string(), "used": used.to_string(), "unused": (a - used).to_string() }),
        );
        let ch = self.charter(id);
        if done && tokens_sent == ch.derived.n_lp && seed_total > 0 {
            emit(
                "market_opened",
                json!({ "launch_id": id.to_string(), "lp_seed": seed_total.to_string(), "lp_tokens": tokens_sent.to_string(), "market": self.cfg.market }),
            );
        }
        self.save_state(id, st);
    }

    pub fn get_market_link(&self, launch_id: U64) -> Option<Value> {
        let (st, ch) = (self.states.get(&launch_id.0)?, self.charters.get(&launch_id.0)?);
        Some(self.market_link_json(st, ch))
    }
}

impl Contract {
    /// The token leg first registers the market on the launch token (NEP-145: a real token refuses `ft_transfer` to an unregistered
    /// account), paid from the reserve the creator attached at `create_trial`. If the market is already registered the token refunds
    /// the deposit to core. A failed registration is harmless: the transfer then fails too and the callback re-credits.
    fn send_leg(&self, contract: AccountId, market: &AccountId, amount: u128, msg: String, id: u64, leg: MarketLeg) {
        let transfer = ext_ft::ext(contract.clone()).with_attached_deposit(ONE_YOCTO).with_static_gas(GAS_LEG).ft_transfer_call(
            market.clone(),
            U128(amount),
            None,
            msg,
        );
        let steps = match leg {
            MarketLeg::Seed => transfer,
            MarketLeg::Token => ext_ft::ext(contract)
                .with_attached_deposit(NearToken::from_yoctonear(crate::TOKEN_REG_YOCTO))
                .with_static_gas(GAS_REG)
                .storage_deposit(Some(market.clone()), Some(true))
                .then(transfer),
        };
        let _ = steps.then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_market_leg(U64(id), leg, U128(amount)));
    }
}
