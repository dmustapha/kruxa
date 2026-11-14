//! Core hardening: the guardian freeze barrier (a freeze cannot be re-armed until 7 days after the last one ended) and the private `new`.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);
const WINDOW_NS: u64 = 7 * 86_400 * 1_000_000_000;

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

async fn barrier(env: &Env) -> u64 {
    env.view("freeze_barrier", json!({})).await.as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn guardian_cannot_rearm_a_freeze_inside_the_barrier_but_can_after_it() -> anyhow::Result<()> {
    let env = Env::new().await?;
    assert_eq!(barrier(&env).await, 0, "no freeze yet: nothing blocks");
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    let now = env.worker.view_block().await?.timestamp();
    let b = barrier(&env).await;
    assert!(
        b > now + 2 * WINDOW_NS - 3_600_000_000_000 && b <= now + 2 * WINDOW_NS,
        "barrier = freeze end + 7 days = start + 14 days: {b} vs {now}"
    );
    // still frozen: re-arming (which would restart the 7 days) is refused
    assert!(has_code(&env.call(&env.guardian, "freeze", json!({}), ZERO).await, "R_NOT_YET"), "no re-arm while frozen");
    // the owner lifts it early; the barrier does not move, so the guardian still cannot freeze again
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.guardian, "freeze", json!({}), ZERO).await, "R_NOT_YET"), "no re-arm after a lift");
    assert_eq!(barrier(&env).await, b, "a refused freeze changes nothing");
    // time passes the barrier (patched, the real wait is 14 days): the guardian may freeze again
    env.worker.patch_state(env.core.id(), b"x:fbar", &1u64.to_le_bytes()).await?;
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(barrier(&env).await > b, "the new freeze pushed the barrier out again");
    Ok(())
}

#[tokio::test]
async fn owner_freeze_is_not_held_back_and_a_creator_still_cannot_freeze() -> anyhow::Result<()> {
    let env = Env::new().await?;
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.owner, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.creator, "freeze", json!({}), ZERO).await, "R_NOT_AUTHORIZED"));
    Ok(())
}

#[tokio::test]
async fn exits_are_closed_only_while_frozen_and_open_in_the_window_between_freezes() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FRZB")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&u, "walk", lid(id), ONE).await, "R_FROZEN"), "exits close while frozen, as before");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.guardian, "freeze", json!({}), ZERO).await, "R_NOT_YET"), "the guardian cannot close them again yet");
    env.call(&u, "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "the Walk went through inside the barrier window");
    Ok(())
}

#[tokio::test]
async fn new_is_private_and_runs_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let root = env.worker.root_account()?;
    let acct = root.create_subaccount("core2").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
    let core2 = acct.deploy(&core_wasm_bytes()).await?.into_result()?;
    let args = json!({ "owner": env.owner.id(), "guardian": env.guardian.id(), "treasury": env.treasury.id(), "relay_fees": env.relay_fees.id(),
                       "usdc": env.usdc.id(), "intents": env.intents.id(), "factory": env.factory.id(), "profile": "demo" });
    let front_run = env.creator.call(core2.id(), "new").args_json(args.clone()).transact().await?;
    assert!(front_run.is_failure(), "a stranger must not initialise a deployed core");
    assert!(format!("{:?}", front_run.failures()).contains("private"), "{:?}", front_run.failures());
    core2.call("new").args_json(args.clone()).transact().await?.into_result()?;
    let again = core2.call("new").args_json(args.clone()).transact().await?;
    assert!(again.is_failure(), "a second init is refused");
    let by_stranger = env.creator.call(core2.id(), "new").args_json(args).transact().await?;
    assert!(by_stranger.is_failure(), "and a stranger still cannot call it");
    let cfg: Value = core2.view("get_config").await?.json()?;
    assert_eq!(cfg["owner"], env.owner.id().to_string(), "the first init by the contract account stands: {cfg}");
    Ok(())
}
