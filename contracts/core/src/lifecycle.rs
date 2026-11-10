use crate::ContractExt;
use kruxa_logic::{
    allocate, bond_required, check_pass_conservation, inputs_hash, phase_at, settle_position, validate_params, verdict, Buckets, Outcome,
    Phase, RuleCode, TrialParams,
};
use kruxa_math::{mul_div_floor, secs_to_ns};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Promise, PromiseOrValue};

/// Least prepaid gas `create_trial` accepts. Measured on testnet: 150 Tgas left a launch stuck in Creating, 300 works.
const MIN_CREATE_GAS_TGAS: u64 = 250;

use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::token::{FactoryPrimitives, TokenProvider};
use crate::{fail, Contract, GAS_CB, GAS_OUT};

fn math<T>(r: Result<T, kruxa_math::MathError>) -> T {
    r.unwrap_or_else(|e| fail(RuleCode::RMath, &format!("{:?}", e)))
}

#[near]
impl Contract {
    /// Creator attaches `required_deposit` (position-storage bond + factory deposit). Everything above the factory deposit is the bond.
    #[payable]
    pub fn create_trial(
        &mut self,
        params: TrialParams,
        stream_recipient: Option<AccountId>,
        genesis: Option<crate::genesis::GenesisPlanInput>,
    ) -> Promise {
        self.require_live();
        // create_trial starts the factory call (110 Tgas) and its callback; with 150 Tgas on testnet the launch stuck in Creating and locked the
        // creator for 10 minutes. Refuse before any state change. The app attaches 300 Tgas; unused gas is refunded.
        if env::prepaid_gas() < near_sdk::Gas::from_tgas(MIN_CREATE_GAS_TGAS) {
            fail(RuleCode::RGas, &format!("attach at least {MIN_CREATE_GAS_TGAS} Tgas to create_trial"));
        }
        let creator = env::predecessor_account_id();
        if self.cfg.creator_gate && creator != self.cfg.owner {
            fail(RuleCode::RCreatorGate, "creation is limited to the owner until open_beta");
        }
        if self.active_by_creator.contains_key(&creator) {
            fail(RuleCode::RActiveTrial, "one active trial per account");
        }
        if self.symbols.contains(&params.symbol) {
            fail(RuleCode::RSymbol, "symbol already used");
        }
        let headroom = self.cfg.global_cap.saturating_sub(self.cfg.global_held);
        let derived =
            validate_params(&params, &self.cfg.rules, headroom, creator == self.cfg.owner).unwrap_or_else(|v| env::panic_str(&v.message()));
        if params.creator_bps > 0 {
            self.cfg.rules.check_alloc_vest().unwrap_or_else(|v| env::panic_str(&v.message()));
        }
        let attached = env::attached_deposit().as_yoctonear();
        let need = bond_required(derived.max_holders) + self.cfg.factory_deposit + crate::TOKEN_REG_YOCTO;
        if attached < need {
            fail(RuleCode::RDeposit, &format!("attach at least {} yocto, got {}", need, attached));
        }
        let id = self.next_launch_id;
        self.next_launch_id += 1;
        let now = env::block_timestamp();
        let opens_at = now + math(secs_to_ns(params.open_delay_secs).ok_or(kruxa_math::MathError::Overflow));
        let commit_end = opens_at + math(secs_to_ns(params.commit_secs).ok_or(kruxa_math::MathError::Overflow));
        let walk_end = commit_end + math(secs_to_ns(params.tail_secs).ok_or(kruxa_math::MathError::Overflow));
        let plan = crate::genesis::plan_from_input(genesis);
        let stream_recipient_out = stream_recipient.unwrap_or_else(|| creator.clone());
        let provider = FactoryPrimitives { factory: self.cfg.factory.clone() };
        let charter = Charter {
            launch_id: id,
            stream_recipient: stream_recipient_out.clone(),
            creator: creator.clone(),
            created_at: now,
            derived: derived.clone(),
            rules: self.cfg.rules.clone(),
            opens_at,
            commit_end,
            walk_end,
            route: provider.route(),
            genesis: plan,
            params: params.clone(),
        };
        let charter_hash = env::sha256_array(near_sdk::borsh::to_vec(&charter).expect("charter serializes"));
        let state = LaunchState {
            charter_hash,
            status: Status::Creating,
            halted: false,
            cancelled: false,
            token: None,
            total_active: 0,
            active_funders: 0,
            holder_count: 0,
            positions_live: 0,
            positions_unsettled: 0,
            residue_swept: false,
            bond: attached - self.cfg.factory_deposit - crate::TOKEN_REG_YOCTO,
            bond_reclaimed: false,
            book_hash: [0; 32],
            ledger: Ledger::default(),
            settlement: None,
            genesis: GenesisState::default(),
        };
        self.charters.insert(id, charter);
        self.states.insert(id, state);
        self.active_by_creator.insert(creator.clone(), id);
        self.symbols.insert(params.symbol.clone());
        emit(
            "charter_created",
            json!({ "launch_id": id.to_string(), "creator": creator, "symbol": params.symbol, "charter_hash": kruxa_logic::hex(&charter_hash),
                    "soft_cap": params.soft_cap.to_string(), "min_funders": params.min_funders, "stream_days": params.stream_days,
                    "payout_recipient": stream_recipient_out, "token_decimals": self.cfg.rules.decimals,
                    "name": params.name, "total_supply": derived.n_total.to_string() }),
        );
        provider
            .create(&params, derived.n_total, &env::current_account_id(), self.cfg.factory_deposit)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_token_created(U64(id)))
    }

    #[private]
    pub fn on_token_created(&mut self, launch_id: U64) -> PromiseOrValue<bool> {
        let id = launch_id.0;
        if self.state(id).status != Status::Creating {
            return PromiseOrValue::Value(false);
        }
        if env::promise_result_checked(0, 4096).is_err() {
            self.fail_creation(id, "factory call failed");
            return PromiseOrValue::Value(false);
        }
        PromiseOrValue::Promise(self.verify_token(id))
    }

    #[private]
    pub fn on_token_verified(&mut self, launch_id: U64) -> bool {
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.status != Status::Creating {
            return false;
        }
        let ch = self.charter(id);
        let supply_ok = match env::promise_result_checked(0, 128) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).map(|u| u.0 == ch.derived.n_total).unwrap_or(false),
            Err(_) => false,
        };
        if !supply_ok {
            self.fail_creation(id, "token supply is not at core");
            return false;
        }
        st.token = Some(self.provider().token_account(&ch.params));
        st.status = Status::Open;
        self.save_state(id, st);
        emit(
            "trial_opened",
            json!({ "launch_id": id.to_string(), "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string() }),
        );
        true
    }

    /// Permissionless recovery if a creation callback never ran or failed: re-query the supply after 10 minutes.
    pub fn finalize_creation(&mut self, launch_id: U64) -> Promise {
        let (st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if st.status != Status::Creating {
            fail(RuleCode::RWrongPhase, "launch is not in Creating");
        }
        if env::block_timestamp() < ch.created_at + crate::CREATION_TIMEOUT_NS {
            fail(RuleCode::RTooEarly, "wait 10 minutes after create_trial");
        }
        self.verify_token(launch_id.0)
    }

    /// Creator-only, before commit_end. Every position becomes refundable at once; launch fee is zero.
    pub fn cancel_trial(&mut self, launch_id: U64) {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if env::predecessor_account_id() != ch.creator {
            fail(RuleCode::RNotAuthorized, "creator only");
        }
        if st.status != Status::Open {
            fail(RuleCode::RWrongPhase, "launch is not Open");
        }
        if env::block_timestamp() >= ch.commit_end {
            fail(RuleCode::RTooLate, "commit window is over");
        }
        st.cancelled = true;
        self.finish_fail(&ch, &mut st, kruxa_logic::verdict::CANCELLED);
        self.save_state(launch_id.0, st);
    }

    /// Permissionless. Pure function of frozen state: no promises, no yield/resume, cannot be blocked by an outage.
    pub fn settle(&mut self, launch_id: U64) -> bool {
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        match (&st.status, &st.settlement) {
            (Status::Open, _) => {}
            (_, Some(s)) => return s.pass,
            _ => fail(RuleCode::RWrongPhase, "launch is not Open"),
        }
        // A PAUSE must not hold the verdict hostage (it has no expiry); only a FROZEN state, which auto-expires, stops it.
        self.require_exit_open();
        let now = env::block_timestamp();
        if phase_at(now, ch.opens_at, ch.commit_end, ch.walk_end) != Phase::Ready {
            fail(RuleCode::RTooEarly, "walk tail is still running");
        }
        let inputs = st.verdict_inputs(&ch);
        match verdict(&inputs) {
            Outcome::Fail(reasons) => self.finish_fail(&ch, &mut st, reasons),
            Outcome::Pass => {
                let a = math(allocate(st.total_active, ch.params.hard_cap, ch.params.sale_bps, ch.params.lp_bps, &ch.rules));
                let l = &mut st.ledger;
                l.excess_pool = a.excess_pool;
                l.launch_fee_due = a.launch_fee;
                l.lp_seed_due = a.lp_quote;
                l.stream_total = a.stream;
                let dur = kruxa_math::days_to_ns(ch.params.stream_days as u64).unwrap_or(0);
                let initial = kruxa_math::linear_unlocked(a.stream, now, dur, now).unwrap_or(0);
                kruxa_logic::check_stream_init(initial).unwrap_or_else(|v| env::panic_str(&v.message()));
                let buckets =
                    Buckets { launch_fee_due: a.launch_fee, lp_seed_due: a.lp_quote, stream_total: a.stream, excess_pool: a.excess_pool };
                if check_pass_conservation(&buckets, st.total_active, 0).is_err() {
                    fail(RuleCode::RSolvency, "bucket conservation broken at settle");
                }
                st.settlement = Some(Settlement {
                    pass: true,
                    reasons: 0,
                    settled_at: now,
                    total_active: st.total_active,
                    accepted: a.accepted,
                    launch_fee: a.launch_fee,
                    lp_quote: a.lp_quote,
                    stream: a.stream,
                    excess_pool: a.excess_pool,
                    inputs_hash: inputs_hash(&inputs),
                    book_hash: st.book_hash,
                });
                st.status = Status::Passed;
                st.positions_unsettled = st.active_funders;
                self.active_by_creator.remove(&ch.creator);
                emit(
                    "verdict",
                    json!({ "launch_id": id.to_string(), "outcome": "PASS", "inputs_hash": kruxa_logic::hex(&inputs_hash(&inputs)), "total_active": st.total_active.to_string(), "funders": st.active_funders }),
                );
                emit(
                    "pass_allocated",
                    json!({ "launch_id": id.to_string(), "accepted": a.accepted.to_string(), "launch_fee": a.launch_fee.to_string(), "lp_quote": a.lp_quote.to_string(), "stream": a.stream.to_string(), "excess_pool": a.excess_pool.to_string() }),
                );
            }
        }
        let pass = st.status == Status::Passed;
        self.save_state(id, st);
        pass
    }

    /// Lazily settles up to 25 positions in sequence order. Required before consolidation and payouts.
    pub fn settle_positions_page(&mut self, launch_id: U64, from_seq: u32, limit: u32) -> u32 {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if !matches!(st.status, Status::Passed | Status::Failed(_)) {
            fail(RuleCode::RWrongPhase, "launch has no verdict yet");
        }
        let end = from_seq.saturating_add(limit.min(25));
        for seq in from_seq..end {
            if let Some(holder) = self.seq_index.get(&(launch_id.0, seq)).cloned() {
                self.settle_position_inner(&ch, &mut st, &holder);
            }
        }
        self.save_state(launch_id.0, st);
        end
    }

    /// Moves oversubscription rounding residue to the LP bucket once every position is settled. Never to creator or platform.
    pub fn sweep_residue(&mut self, launch_id: U64) {
        let mut st = self.state(launch_id.0);
        if st.status != Status::Passed || st.positions_unsettled != 0 || st.residue_swept {
            fail(RuleCode::RNotClear, "needs Passed, all positions settled, not yet swept");
        }
        let residue = st.ledger.excess_pool;
        st.ledger.lp_seed_due += residue;
        st.ledger.excess_pool = 0;
        st.residue_swept = true;
        emit("residue_swept", json!({ "launch_id": launch_id.0.to_string(), "amount": residue.to_string() }));
        self.save_state(launch_id.0, st);
    }

    /// FAIL path terminal state, once every refund is cleared and every position deleted.
    pub fn dissolve(&mut self, launch_id: U64) {
        let mut st = self.state(launch_id.0);
        let l = &st.ledger;
        let clear = l.due_native + l.due_intents + l.inflight_native + l.inflight_intents + l.open_native + l.open_intents == 0;
        if !matches!(st.status, Status::Failed(_)) || !clear || st.positions_unsettled != 0 || st.positions_live != 0 {
            fail(RuleCode::RNotClear, "refunds are not all cleared");
        }
        st.status = Status::Dissolved;
        emit("dissolved", json!({ "launch_id": launch_id.0.to_string() }));
        self.save_state(launch_id.0, st);
    }

    /// Returns the creator's position-storage bond once no position records remain.
    pub fn reclaim_bond(&mut self, launch_id: U64) -> Promise {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if env::predecessor_account_id() != ch.creator {
            fail(RuleCode::RNotAuthorized, "creator only");
        }
        let done = matches!(st.status, Status::Dissolved | Status::CreationFailed | Status::Passed);
        if !done || st.bond_reclaimed || st.positions_live != 0 || (st.status == Status::Passed && !st.residue_swept) {
            fail(RuleCode::RNotClear, "bond is not reclaimable yet");
        }
        st.bond_reclaimed = true;
        let reg = if st.status == Status::Passed { 0 } else { crate::TOKEN_REG_YOCTO };
        let amount = st.bond + reg + if st.status == Status::CreationFailed { self.cfg.factory_deposit } else { 0 };
        self.save_state(launch_id.0, st);
        emit("bond_reclaimed", json!({ "launch_id": launch_id.0.to_string(), "amount": amount.to_string() }));
        self.push_near(ch.creator, amount)
    }
}

impl Contract {
    pub(crate) fn provider(&self) -> FactoryPrimitives {
        FactoryPrimitives { factory: self.cfg.factory.clone() }
    }

    fn verify_token(&self, id: u64) -> Promise {
        let token = self.provider().token_account(&self.charter(id).params);
        ext_ft::ext(token)
            .with_static_gas(GAS_OUT)
            .ft_balance_of(env::current_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_token_verified(U64(id)))
    }

    fn fail_creation(&mut self, id: u64, reason: &str) {
        let (mut st, ch) = (self.state(id), self.charter(id));
        st.status = Status::CreationFailed;
        self.active_by_creator.remove(&ch.creator);
        self.symbols.remove(&ch.params.symbol);
        self.save_state(id, st);
        emit("token_creation_failed", json!({ "launch_id": id.to_string(), "code": RuleCode::RTokenCreate.as_str(), "reason": reason }));
    }

    fn finish_fail(&mut self, ch: &Charter, st: &mut LaunchState, reasons: u8) {
        st.status = Status::Failed(reasons);
        st.positions_unsettled = st.active_funders;
        st.settlement = Some(Settlement {
            pass: false,
            reasons,
            settled_at: env::block_timestamp(),
            total_active: st.total_active,
            accepted: 0,
            launch_fee: 0,
            lp_quote: 0,
            stream: 0,
            excess_pool: 0,
            inputs_hash: inputs_hash(&st.verdict_inputs(ch)),
            book_hash: st.book_hash,
        });
        self.active_by_creator.remove(&ch.creator);
        emit(
            "verdict",
            json!({ "launch_id": ch.launch_id.to_string(), "outcome": "FAIL", "reasons": reasons, "total_active": st.total_active.to_string(), "funders": st.active_funders }),
        );
    }

    /// Idempotent, O(1). Turns an Active position into its final spend/refund/entitlement (PASS) or into a full refund (FAIL).
    pub(crate) fn settle_position_inner(&mut self, ch: &Charter, st: &mut LaunchState, holder: &HolderId) {
        let key = (ch.launch_id, holder.clone());
        let Some(mut pos) = self.positions.get(&key).cloned() else { return };
        if pos.settled {
            return;
        }
        let (on, oi) = (pos.open_native, pos.open_intents);
        let c = on + oi;
        let l = &mut st.ledger;
        match st.status {
            Status::Failed(_) => {
                l.open_native -= on;
                l.open_intents -= oi;
                l.due_native += on;
                l.due_intents += oi;
                pos.due_native += on;
                pos.due_intents += oi;
            }
            Status::Passed if c > 0 => {
                let s = st.settlement.clone().expect("Passed always has a settlement");
                let r = math(settle_position(c, s.total_active, s.accepted, ch.derived.n_sale, ch.derived.n_backer));
                let refund_native = math(mul_div_floor(r.refund, on, c));
                let refund_intents = r.refund - refund_native;
                l.open_native -= on;
                l.open_intents -= oi;
                l.due_native += refund_native;
                l.due_intents += refund_intents;
                l.spent_native += on - refund_native;
                l.spent_intents += oi - refund_intents;
                l.excess_pool -= r.refund;
                pos.due_native += refund_native;
                pos.due_intents += refund_intents;
                pos.spent = r.spend;
                pos.tokens_entitled = r.tokens;
                pos.bonus_entitled = r.bonus;
                match pos.deliver {
                    HolderId::Near(_) => l.unclaimed_sale_total += r.tokens,
                    HolderId::Solana(_) => l.solana_locked_total += r.tokens + r.bonus,
                }
            }
            Status::Passed => {}
            _ => return,
        }
        pos.open_native = 0;
        pos.open_intents = 0;
        pos.settled = true;
        if c > 0 {
            st.positions_unsettled -= 1;
        }
        self.positions.insert(key, pos);
    }

    /// Removes a position record once nothing is owed either way. Frees storage so the creator bond becomes reclaimable.
    pub(crate) fn try_delete_position(&mut self, st: &mut LaunchState, launch_id: u64, holder: &HolderId) {
        let key = (launch_id, holder.clone());
        let Some(pos) = self.positions.get(&key) else { return };
        let tokens_done = match st.status {
            Status::Passed => {
                let sweep_at =
                    self.charters.get(&launch_id).zip(st.settlement.as_ref()).map(|(c, s)| crate::token_claims::bonus_sweep_at(c, s));
                let bonus_closed = sweep_at.is_some_and(|t| env::block_timestamp() >= t);
                let paid = pos.claimed == pos.tokens_entitled + pos.bonus_entitled || (bonus_closed && pos.claimed >= pos.tokens_entitled);
                paid && pos.claim_inflight == 0 && matches!(holder, HolderId::Near(_))
            }
            _ => true,
        };
        if !pos.settled || pos.owed() + pos.inflight() + pos.open() != 0 || !tokens_done {
            return;
        }
        let seq = pos.seq;
        self.positions.remove(&key);
        self.seq_index.remove(&(launch_id, seq));
        st.positions_live -= 1;
    }
}
