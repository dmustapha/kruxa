//! Native tests for the token deliveries: the PASSED-launch sweep window (30 days of bonus vest, not reachable in the sandbox), the
//! counters behind it, every callback branch, and the L7 view. The sandbox suite `tests/tests/token_claims.rs` covers the real chain.
use super::*;
use crate::TOKEN_REG_YOCTO as REG;
use kruxa_logic::{validate_params, Rules, TrialParams};
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const DAY: u64 = 86_400_000_000_000;
const SETTLED: u64 = 1_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, deposit: u128, now: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("core.test"))
        .predecessor_account_id(acct(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now);
    b
}

fn with_result(who: &str, deposit: u128, now: u64, result: PromiseResult) {
    testing_env!(ctx(who, deposit, now).build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn ledger_of(c: &Contract) -> Ledger {
    c.states.get(&1).unwrap().ledger.clone()
}

fn alice_pos(c: &Contract) -> Option<Position> {
    c.positions.get(&(1, HolderId::Near(acct("alice.test")))).cloned()
}

fn claim_op(amount: u128) -> PayoutOp {
    PayoutOp { kind: PayoutKind::Claim, launch_id: 1, holder: Some("near:alice.test".into()), amount }
}

/// Launch 1, PASSED at `SETTLED`, every position settled: one NEAR buyer (1,000 sale tokens + 400 bonus) and 300 tokens locked for Solana.
fn passed_contract() -> Contract {
    testing_env!(ctx("owner.test", 0, SETTLED).build());
    let mut c = Contract::new(
        acct("owner.test"),
        acct("guardian.test"),
        acct("treasury.test"),
        acct("relay.test"),
        acct("usdc.test"),
        acct("intents.test"),
        acct("factory.test"),
        "demo".into(),
    );
    let rules = Rules::demo_clock();
    let params = TrialParams::example("UNIT");
    let derived = validate_params(&params, &rules, 3_000_000_000, true).unwrap();
    let charter = Charter {
        launch_id: 1,
        creator: acct("creator.test"),
        stream_recipient: acct("payee.test"),
        created_at: 0,
        params,
        derived,
        rules,
        opens_at: 0,
        commit_end: 0,
        walk_end: 0,
        route: TokenRoute::FactoryPrimitives,
        genesis: crate::genesis::plan_from_input(None),
    };
    let settlement = Settlement {
        pass: true,
        reasons: 0,
        settled_at: SETTLED,
        total_active: 360,
        accepted: 360,
        launch_fee: 0,
        lp_quote: 0,
        stream: 0,
        excess_pool: 0,
        inputs_hash: [0; 32],
        book_hash: [0; 32],
    };
    let st = LaunchState {
        charter_hash: [0; 32],
        status: Status::Passed,
        halted: false,
        cancelled: false,
        token: Some(acct("unit.factory.test")),
        total_active: 360,
        active_funders: 2,
        holder_count: 1,
        positions_live: 1,
        positions_unsettled: 0,
        residue_swept: true,
        bond: 0,
        bond_reclaimed: false,
        book_hash: [0; 32],
        ledger: Ledger { unclaimed_sale_total: 1_000, solana_locked_total: 300, ..Ledger::default() },
        settlement: Some(settlement),
        genesis: GenesisState::default(),
    };
    let pos = Position {
        seq: 0,
        deliver: HolderId::Near(acct("alice.test")),
        referrer: None,
        contributed: 30,
        open_native: 0,
        open_intents: 0,
        due_native: 0,
        due_intents: 0,
        inflight_native: 0,
        inflight_intents: 0,
        refunded: 0,
        spent: 30,
        tokens_entitled: 1_000,
        bonus_entitled: 400,
        claimed: 0,
        claim_inflight: 0,
        settled: true,
    };
    c.charters.insert(1, charter);
    c.states.insert(1, st);
    c.seq_index.insert((1, 0), pos.deliver.clone());
    c.positions.insert((1, pos.deliver.clone()), pos);
    c
}

fn sweep_at(c: &Contract) -> u64 {
    bonus_sweep_at(&c.charter(1), c.state(1).settlement.as_ref().unwrap())
}

/// alice claims at `now` attaching `deposit`; the debit is applied and the delivery chain is started.
fn alice_claims(c: &mut Contract, deposit: u128, now: u64) {
    testing_env!(ctx("alice.test", deposit, now).build());
    let _ = c.claim_tokens(U64(1));
}

#[test]
fn sweepable_is_the_pool_minus_everything_still_owed_and_zero_before_the_window() {
    let c = passed_contract();
    let (ch, st) = (c.charter(1), c.state(1));
    let pool = ch.derived.n_sale + ch.derived.n_backer;
    let at = sweep_at(&c);
    assert_eq!(at, SETTLED + 30 * DAY + 30_000_000_000, "30 day bonus vest plus the demo 30 s window");
    assert_eq!(Contract::sweepable(&ch, &st, at - 1), 0, "the bonus is still vesting");
    assert_eq!(Contract::sweepable(&ch, &st, at), pool - 1_000 - 300, "unclaimed sale tokens and the Solana copy stay");
    let mut unsettled = st.clone();
    unsettled.positions_unsettled = 1;
    assert_eq!(Contract::sweepable(&ch, &unsettled, at), 0, "entitlement totals are not final");
    let mut claimed = st.clone();
    claimed.ledger.claimed_total = 700;
    claimed.ledger.swept = 50;
    assert_eq!(Contract::sweepable(&ch, &claimed, at), pool - 1_000 - 300 - 700 - 50);
    let mut open = st;
    open.status = Status::Open;
    assert_eq!(Contract::sweepable(&ch, &open, at), 0);
}

#[test]
fn claim_after_the_window_pays_sale_tokens_only_and_debits_every_counter() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 1, at);
    let l = ledger_of(&c);
    assert_eq!((l.claimed_total, l.unclaimed_sale_total), (1_000, 0), "no bonus past the window, sale tokens only");
    let pos = alice_pos(&c).unwrap();
    assert_eq!((pos.claimed, pos.claim_inflight), (1_000, 1_000));
}

#[test]
fn claim_inside_the_window_includes_the_vested_bonus() {
    let mut c = passed_contract();
    alice_claims(&mut c, 1, SETTLED + 15 * DAY);
    assert_eq!(ledger_of(&c).claimed_total, 1_200, "tokens 1000 plus half of the 400 bonus after 15 of 30 days");
}

#[test]
fn a_failed_position_claim_restores_the_counters() {
    let mut c = passed_contract();
    alice_claims(&mut c, 1, SETTLED + 15 * DAY);
    with_result("core.test", 0, SETTLED + 16 * DAY, PromiseResult::Failed);
    c.on_payout(claim_op(1_200));
    let l = ledger_of(&c);
    assert_eq!((l.claimed_total, l.unclaimed_sale_total), (0, 1_000), "back to the pre-claim state");
    let pos = alice_pos(&c).unwrap();
    assert_eq!((pos.claimed, pos.claim_inflight), (0, 0));
}

#[test]
fn a_confirmed_claim_clears_only_the_inflight_marker_and_the_position_survives_while_bonus_vests() {
    let mut c = passed_contract();
    alice_claims(&mut c, 1, SETTLED + 15 * DAY);
    with_result("core.test", 0, SETTLED + 16 * DAY, PromiseResult::Successful(vec![]));
    c.on_payout(claim_op(1_200));
    let pos = alice_pos(&c).expect("200 of the bonus is still vesting");
    assert_eq!((pos.claimed, pos.claim_inflight), (1_200, 0));
}

#[test]
fn a_position_is_deleted_once_the_window_closed_and_the_sale_tokens_are_out() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 1, at);
    with_result("core.test", 0, at + 1, PromiseResult::Successful(vec![]));
    c.on_payout(claim_op(1_000));
    assert!(alice_pos(&c).is_none(), "nothing more can ever be claimed");
    assert_eq!(c.state(1).positions_live, 0);
}

#[test]
fn a_position_with_a_claim_in_flight_is_never_deleted_by_another_callback() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 1, at);
    let mut st = c.state(1);
    c.try_delete_position(&mut st, 1, &HolderId::Near(acct("alice.test")));
    assert!(alice_pos(&c).is_some(), "the transfer has not resolved: a failure must still find the position to re-credit");
    assert_eq!(st.positions_live, 1);
}

#[test]
fn sweep_in_hold_mode_marks_the_supply_held_locks_the_mode_and_a_second_sweep_finds_nothing() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    let expected = Contract::sweepable(&c.charter(1), &c.state(1), at);
    testing_env!(ctx("keeper.test", 5, at).build());
    let out = c.sweep_tokens(U64(1));
    assert!(matches!(out, PromiseOrValue::Value(v) if v.0 == expected));
    assert_eq!(ledger_of(&c).swept, expected);
    assert!(c.cfg.burn_mode_locked && c.cfg.burn_mode == BurnMode::Hold);
    assert!(get_logs().iter().any(|l| l.contains("tokens_swept")));
    assert_eq!(Contract::sweepable(&c.charter(1), &c.state(1), at), 0);
}

#[test]
#[should_panic(expected = "R_NOTHING")]
fn sweep_before_the_window_panics_with_r_nothing() {
    let mut c = passed_contract();
    testing_env!(ctx("keeper.test", 0, sweep_at(&c) - 1).build());
    let _ = c.sweep_tokens(U64(1));
}

#[test]
#[should_panic(expected = "R_DEPOSIT")]
fn sweep_to_a_sink_without_a_deposit_panics() {
    let mut c = passed_contract();
    c.cfg.burn_mode = BurnMode::Sink(acct("grave.test"));
    testing_env!(ctx("keeper.test", 0, sweep_at(&c)).build());
    let _ = c.sweep_tokens(U64(1));
}

#[test]
#[should_panic(expected = "R_BURN_UNSUPPORTED")]
fn sweep_with_burn_mode_burn_is_refused_even_if_state_somehow_holds_it() {
    let mut c = passed_contract();
    c.cfg.burn_mode = BurnMode::Burn;
    testing_env!(ctx("keeper.test", 1, sweep_at(&c)).build());
    let _ = c.sweep_tokens(U64(1));
}

#[test]
fn failed_alloc_and_sweep_legs_restore_their_counters_and_confirmed_ones_keep_them() {
    let mut c = passed_contract();
    let mut st = c.state(1);
    st.ledger.alloc_claimed = 70;
    st.ledger.swept = 90;
    c.save_state(1, st);
    for (kind, amount, ok, alloc, swept) in [
        (PayoutKind::AllocClaim, 20, false, 50, 90),
        (PayoutKind::AllocClaim, 20, true, 50, 90),
        (PayoutKind::Sweep, 40, false, 50, 50),
        (PayoutKind::Sweep, 40, true, 50, 50),
    ] {
        c.settle_token_leg(PayoutOp { kind, launch_id: 1, holder: None, amount }, ok);
        let l = ledger_of(&c);
        assert_eq!((l.alloc_claimed, l.swept), (alloc, swept), "{kind:?} ok={ok}");
    }
}

#[test]
fn step_zero_with_an_absent_receiver_and_too_little_deposit_refuses_and_recredits() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 1, at);
    with_result("core.test", 0, at, PromiseResult::Successful(b"null".to_vec()));
    c.on_token_step(claim_op(1_000), acct("alice.test"), acct("alice.test"), U128(1), 0);
    assert_eq!(ledger_of(&c).claimed_total, 0, "re-credited, not panicked");
    assert!(get_logs().iter().any(|l| l.contains("token_delivery_refused")));
    assert!(get_created_receipts().iter().any(|r| r.receiver_id.as_str() == "alice.test"), "the deposit went back to the payer");
}

#[test]
fn step_zero_with_a_registered_receiver_sends_and_refunds_the_excess_only() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 5, at);
    with_result("core.test", 0, at, PromiseResult::Successful(br#"{"total":"1","available":"0"}"#.to_vec()));
    c.on_token_step(claim_op(1_000), acct("alice.test"), acct("alice.test"), U128(5), 0);
    assert_eq!(ledger_of(&c).claimed_total, 1_000, "the claim stands");
    assert!(get_created_receipts().iter().any(|r| r.receiver_id.as_str() == "unit.factory.test"), "ft_transfer scheduled");
    assert!(!get_logs().iter().any(|l| l.contains("token_delivery_refused")));
}

#[test]
fn step_zero_when_the_balance_call_itself_failed_still_tries_the_transfer() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, 1, at);
    with_result("core.test", 0, at, PromiseResult::Failed);
    c.on_token_step(claim_op(1_000), acct("alice.test"), acct("alice.test"), U128(1), 0);
    assert_eq!(ledger_of(&c).claimed_total, 1_000, "a token without NEP-145 is not a reason to refuse");
}

#[test]
fn step_zero_with_an_absent_receiver_and_enough_deposit_registers_before_sending() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, REG + 1, at);
    with_result("core.test", 0, at, PromiseResult::Successful(b"null".to_vec()));
    c.on_token_step(claim_op(1_000), acct("alice.test"), acct("alice.test"), U128(REG + 1), 0);
    assert_eq!(ledger_of(&c).claimed_total, 1_000);
    let calls = get_created_receipts();
    assert!(calls.iter().any(|r| r.receiver_id.as_str() == "unit.factory.test"), "storage_deposit scheduled on the token");
    assert!(!calls.iter().any(|r| r.receiver_id.as_str() == "alice.test"), "nothing to refund: exactly the registration + 1 yocto");
}

#[test]
fn step_one_failure_recredits_and_refunds_the_registration_deposit() {
    let mut c = passed_contract();
    let at = sweep_at(&c);
    alice_claims(&mut c, REG + 1, at);
    with_result("core.test", 0, at, PromiseResult::Failed);
    c.on_token_step(claim_op(1_000), acct("alice.test"), acct("alice.test"), U128(REG + 1), 1);
    assert_eq!(ledger_of(&c).claimed_total, 0);
    assert!(get_logs().iter().any(|l| l.contains("token registration failed")));
    assert!(get_created_receipts().iter().any(|r| r.receiver_id.as_str() == "alice.test"));
}

#[test]
fn set_burn_mode_unit_rules() {
    let mut c = passed_contract();
    testing_env!(ctx("owner.test", 0, 5).build());
    c.set_burn_mode("sink:grave.test".into());
    assert_eq!(c.cfg.burn_mode, BurnMode::Sink(acct("grave.test")));
    assert!(c.cfg.burn_mode_locked);
    assert_eq!(BurnMode::parse(&c.cfg.burn_mode.label()), Some(c.cfg.burn_mode.clone()), "label and parse round-trip");
    assert_eq!(BurnMode::parse("nonsense"), None);
}

#[test]
#[should_panic(expected = "R_NOTHING: nothing vested yet")]
fn creator_allocation_refuses_before_the_cliff() {
    let mut c = passed_contract();
    testing_env!(ctx("payee.test", 1, SETTLED + 1).build());
    let _ = c.claim_creator_alloc(U64(1));
}

#[test]
fn creator_allocation_vests_linearly_after_the_cliff_and_stops_at_the_total() {
    let mut c = passed_contract();
    let (ch, st) = (c.charter(1), c.state(1));
    let total = ch.derived.n_creator;
    let cliff_end = alloc_cliff_ends(&ch, st.settlement.as_ref().unwrap());
    assert_eq!(cliff_end, SETTLED + 20_000_000_000, "demo cliff is 20 s");
    testing_env!(ctx("payee.test", 1, cliff_end + 20_000_000_000).build());
    let _ = c.claim_creator_alloc(U64(1));
    assert_eq!(ledger_of(&c).alloc_claimed, total / 2, "half of the 40 s linear part");
    testing_env!(ctx("payee.test", 1, cliff_end + 40_000_000_000).build());
    let _ = c.claim_creator_alloc(U64(1));
    assert_eq!(ledger_of(&c).alloc_claimed, total, "exactly the allocation, no more");
}

#[test]
#[should_panic(expected = "R_NOT_AUTHORIZED")]
fn creator_allocation_is_for_the_payout_recipient_only() {
    let mut c = passed_contract();
    testing_env!(ctx("creator.test", 1, SETTLED + 1_000_000_000_000).build());
    let _ = c.claim_creator_alloc(U64(1));
}

#[test]
fn l7_holds_with_no_genesis_and_fails_when_the_mint_supply_is_not_the_leaf_total() {
    let c = passed_contract();
    let (st, ch) = (c.state(1), c.charter(1));
    assert!(c.l7_lock_mirror(&st, &ch).is_ok(), "no genesis yet: vacuous");
    let mut g = st;
    g.genesis.root_ready = true;
    g.genesis.expected_total = 300;
    g.genesis.sol_mint_supply = 300;
    assert!(c.l7_lock_mirror(&g, &ch).is_ok());
    g.genesis.sol_mint_supply = 301;
    assert!(c.l7_lock_mirror(&g, &ch).is_err(), "mint supply must equal the leaf total");
}
