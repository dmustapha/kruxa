//! Negative paths the audit (AUDIT-ARCH-CHAIN gap 2, AUDIT-ARCH-SERVICES B3) found untested in the sandbox:
//! `finalize_creation` (too early, recovery, wrong supply, not in Creating), `R_TOO_LATE`, and the FROZEN 7 day expiry.
//! The sandbox always runs callbacks and cannot wait 7 days, so the stuck states are made by patching core state:
//! a launch is put back to `Creating` (status byte), and `frozen_until` is rewritten to the past (found by value, the
//! freeze event prints it).
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);
/// `charter_hash` ([u8; 32]) comes first in a stored `LaunchState`, so the `Status` tag is the next byte (Creating = 0).
const STATUS_AT: usize = 32;

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

async fn wait_secs(env: &Env, secs: u64) {
    let start = env.worker.view_block().await.unwrap().timestamp();
    while env.worker.view_block().await.unwrap().timestamp() - start < secs * 1_000_000_000 {
        env.worker.fast_forward(20).await.unwrap();
    }
}

/// Puts an Open launch back to Creating, as if the factory callback never ran. Returns once the patch is in.
async fn force_creating(env: &Env, id: u64) -> anyhow::Result<()> {
    let state = env.worker.view_state(env.core.id()).await?;
    let mut key = vec![1u8];
    key.extend_from_slice(&id.to_le_bytes());
    let mut value = state.get(&key).expect("launch state").clone();
    assert_eq!(value[STATUS_AT], 2, "status is Open before the patch");
    value[STATUS_AT] = 0;
    env.worker.patch_state(env.core.id(), &key, &value).await?;
    assert_eq!(env.state(id).await["status"], "Creating");
    Ok(())
}

/// Direct call, no harness invariant check: the harness would reject the patched Open -> Creating move.
async fn direct(env: &Env, who: &Account, method: &str, args: Value) -> near_workspaces::result::ExecutionFinalResult {
    who.call(env.core.id(), method).args_json(args).gas(GAS).transact().await.unwrap()
}

#[tokio::test]
async fn finalize_creation_refuses_before_ten_minutes_then_recovers_a_stuck_creation_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("NPFC")).await?;
    let stranger = env.user("stranger", 0).await?;
    let open = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(has_code(&open, "R_WRONG_PHASE"), "an Open launch is not in Creating: {:?}", open.failures());
    force_creating(&env, id).await?;
    let early = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(has_code(&early, "R_TOO_EARLY"), "{:?}", early.failures());
    assert_eq!(env.state(id).await["status"], "Creating", "an early call changes nothing");
    wait_secs(&env, 601).await;
    let done = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(done.is_success(), "any account may finalize after the timeout: {:?}", done.failures());
    assert_eq!(env.state(id).await["status"], "Open", "the supply is at core, so the launch opens");
    let again = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(has_code(&again, "R_WRONG_PHASE"), "recovery is single use: {:?}", again.failures());
    env.assert_invariants().await;
    Ok(())
}

#[tokio::test]
async fn finalize_creation_with_the_wrong_token_supply_fails_the_creation_and_frees_the_creator() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("NPFD")).await?;
    // the token loses supply at core, so the re-query cannot confirm it
    env.owner
        .call(&env.token_id("NPFD"), "burn")
        .args_json(json!({ "account_id": env.core.id(), "amount": "1" }))
        .transact()
        .await?
        .into_result()?;
    force_creating(&env, id).await?;
    wait_secs(&env, 601).await;
    let stranger = env.user("stranger", 0).await?;
    let r = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(env.state(id).await["status"], "CreationFailed");
    let retry = direct(&env, &stranger, "finalize_creation", lid(id)).await;
    assert!(has_code(&retry, "R_WRONG_PHASE"), "a failed creation is final: {:?}", retry.failures());
    env.last_status.borrow_mut().remove(&id); // the harness never saw Creating, so Open -> CreationFailed would read as illegal
                                              // the creator is free again: a second create with another symbol is accepted
    let second = env.create_launch(&params("NPFE")).await;
    assert!(second.is_ok(), "the active-trial slot was released: {:?}", second.err());
    Ok(())
}

#[tokio::test]
async fn cancel_trial_after_the_commit_window_is_too_late() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("NPTL")).await?;
    let u = env.user("buyer", 1_000 * USDC).await?;
    env.commit_native(&u, id, 40 * USDC, None).await.into_result()?;
    env.advance_to(id, "Closing").await;
    let late = env.call(&env.creator, "cancel_trial", lid(id), ZERO).await;
    assert!(has_code(&late, "R_TOO_LATE"), "{:?}", late.failures());
    assert_eq!(env.state(id).await["status"], "Open", "a late cancel changes nothing");
    Ok(())
}

#[tokio::test]
async fn the_frozen_state_ends_by_itself_after_seven_days_so_exits_open_and_new_risk_stays_paused() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("NPFZ")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    env.commit_native(&u, id, 40 * USDC, None).await.into_result()?;
    let freeze = env.call(&env.guardian, "freeze", json!({}), ZERO).await;
    freeze.clone().into_result()?;
    let until: u64 = freeze
        .logs()
        .iter()
        .find_map(|l| l.strip_prefix("EVENT_JSON:").and_then(|j| serde_json::from_str::<Value>(j).ok()).filter(|e| e["event"] == "frozen"))
        .and_then(|e| e["data"][0]["until"].as_str().and_then(|s| s.parse().ok()))
        .expect("the frozen event carries the end time");
    let now = env.worker.view_block().await?.timestamp();
    assert!(until > now + 6 * 86_400 * 1_000_000_000, "the freeze lasts about 7 days, ends {until}, now {now}");
    assert!(has_code(&env.call(&u, "walk", lid(id), ONE).await, "R_FROZEN"), "exits are closed while FROZEN");
    // The sandbox cannot wait 7 days: move the stored end into the past (found by its 8 byte value in the contract state).
    let state = env.worker.view_state(env.core.id()).await?;
    let mut blob = state.get(b"STATE".as_slice()).expect("contract state").clone();
    let needle = until.to_le_bytes();
    let hits: Vec<usize> = blob.windows(8).enumerate().filter(|(_, w)| *w == needle).map(|(i, _)| i).collect();
    assert_eq!(hits.len(), 1, "frozen_until appears exactly once in the stored config");
    blob[hits[0]..hits[0] + 8].copy_from_slice(&1u64.to_le_bytes());
    env.worker.patch_state(env.core.id(), b"STATE", &blob).await?;
    // After expiry the stored level is still Frozen but the effective level is Paused: no transaction was needed.
    let walk = env.call(&u, "walk", lid(id), ONE).await;
    assert!(walk.is_success(), "an expired freeze no longer blocks Walk: {:?}", walk.failures());
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "the holder exited with the full commit");
    let newcomer = env.user("newcomer", 1_000 * USDC).await?;
    let r = env.commit_native(&newcomer, id, 40 * USDC, None).await;
    assert!(has_code(&r, "R_PAUSED"), "new risk stays blocked at the Paused level, not Frozen: {:?}", r.logs());
    assert_eq!(env.usdc_balance(newcomer.id()).await, 1_000 * USDC, "the refused commit went straight back");
    Ok(())
}

/// AUDIT-ARCH-SERVICES B3 named six rule codes with no triggering sandbox test. Four fire here in one line each; `R_SOLVENCY` is
/// triggered in tests/solvency.rs (the Intents alert refuses a new Intents commit); `R_MATH` is a defensive guard behind
/// `validate_params`, whose windows keep every `secs_to_ns` input far below overflow, so no external call reaches it.
#[tokio::test]
async fn each_rule_code_the_audit_listed_as_untriggered_fires_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("NPRC")).await?;
    let no_launch = env.call(&env.creator, "cancel_trial", lid(99), ZERO).await;
    assert!(has_code(&no_launch, "R_NO_LAUNCH"), "{:?}", no_launch.failures());
    let not_clear = env.call(&env.creator, "dissolve", lid(id), ZERO).await;
    assert!(has_code(&not_clear, "R_NOT_CLEAR"), "an Open launch cannot be dissolved: {:?}", not_clear.failures());
    let nothing = env.call(&env.guardian, "cancel_upgrade", json!({}), ZERO).await;
    assert!(has_code(&nothing, "R_NOTHING"), "{:?}", nothing.failures());
    env.advance_to(id, "Closing").await;
    let late = env.call(&env.creator, "cancel_trial", lid(id), ZERO).await;
    assert!(has_code(&late, "R_TOO_LATE"), "{:?}", late.failures());
    Ok(())
}

/// `create_trial` refuses a call with too little prepaid gas before any state change (testnet: 150 Tgas left a launch stuck in
/// Creating and locked the creator). With enough gas the same call works, so the creator is not locked by the refused call.
#[tokio::test]
async fn create_trial_with_too_little_prepaid_gas_is_refused_and_leaves_the_creator_free() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let p = params("GASR");
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": &p })).await?.json()?;
    let res = env
        .creator
        .call(env.core.id(), "create_trial")
        .args_json(json!({ "params": &p, "stream_recipient": Value::Null, "genesis": Value::Null }))
        .deposit(NearToken::from_yoctonear(required.parse()?))
        .gas(near_workspaces::types::Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(has_code(&res, "R_GAS"), "150 Tgas must be refused with R_GAS");
    let id = env.create_launch(&p).await?;
    assert_eq!(id, 1, "the refused call did not take a launch id or lock the creator");
    Ok(())
}
