//! D-1 (W1-DC-15, GR-14): on the mainnet profile only the owner can `create_trial` until the owner calls the one-way `open_beta`.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);

async fn try_create(env: &Env, symbol: &str) -> near_workspaces::result::ExecutionFinalResult {
    let p = TrialParams::example(symbol);
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await.unwrap().json().unwrap();
    env.creator
        .call(env.core.id(), "create_trial")
        .args_json(json!({ "params": p, "stream_recipient": null }))
        .deposit(NearToken::from_yoctonear(required.parse().unwrap()))
        .gas(GAS)
        .transact()
        .await
        .unwrap()
}

#[tokio::test]
async fn mainnet_profile_refuses_non_owner_create_trial_with_creator_gate() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    assert_eq!(env.view("get_config", json!({})).await["creator_gate"], true);
    let res = try_create(&env, "GATEA").await;
    assert!(res.is_failure(), "a non-owner create_trial must fail on the mainnet profile");
    assert!(has_code(&res, "R_CREATOR_GATE"), "expected R_CREATOR_GATE, got {:?}", res.failures());
    assert!(env.view("get_state", json!({ "launch_id": "1" })).await.is_null(), "nothing was created");
    Ok(())
}

#[tokio::test]
async fn the_gate_is_checked_before_params_and_deposit() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    let res = env
        .creator
        .call(env.core.id(), "create_trial")
        .args_json(json!({ "params": TrialParams::example("GATEB"), "stream_recipient": null }))
        .deposit(ZERO)
        .gas(GAS)
        .transact()
        .await?;
    assert!(has_code(&res, "R_CREATOR_GATE"), "gate must come first, got {:?}", res.failures());
    Ok(())
}

#[tokio::test]
async fn the_owner_can_create_while_the_gate_is_closed() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    let id = env.create_launch_as(&env.owner, &TrialParams::example("KRUXA")).await?;
    assert_eq!(env.state(id).await["status"], "Open");
    Ok(())
}

#[tokio::test]
async fn only_the_owner_can_open_beta_and_it_is_one_way() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    for who in [&env.guardian, &env.creator] {
        let res = env.call(who, "open_beta", json!({}), ZERO).await;
        assert!(has_code(&res, "R_NOT_AUTHORIZED"), "{} must not open the beta: {:?}", who.id(), res.failures());
        assert_eq!(env.view("get_config", json!({})).await["creator_gate"], true);
    }
    let res = env.call(&env.owner, "open_beta", json!({}), ZERO).await;
    assert!(res.is_success(), "{:?}", res.failures());
    assert!(res.logs().iter().any(|l| l.contains("beta_opened")), "beta_opened event is emitted");
    assert_eq!(env.view("get_config", json!({})).await["creator_gate"], false);
    let again = env.call(&env.owner, "open_beta", json!({}), ZERO).await;
    assert!(has_code(&again, "R_NOTHING"), "a second open_beta has nothing to do: {:?}", again.failures());
    Ok(())
}

#[tokio::test]
async fn after_open_beta_a_non_owner_create_trial_passes() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    assert!(try_create(&env, "GATEC").await.is_failure());
    env.call(&env.owner, "open_beta", json!({}), ZERO).await.into_result()?;
    let id = env.create_launch(&TrialParams::example("GATED")).await?;
    assert_eq!(env.state(id).await["status"], "Open");
    Ok(())
}

#[tokio::test]
async fn demo_and_testnet_profiles_start_open_so_wave_1_is_unchanged() -> anyhow::Result<()> {
    for profile in ["demo", "testnet"] {
        let env = Env::new_with_profile(profile).await?;
        assert_eq!(env.view("get_config", json!({})).await["creator_gate"], false, "{profile}");
    }
    Ok(())
}

#[tokio::test]
async fn pause_does_not_bypass_or_reopen_the_gate() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&try_create(&env, "GATEE").await, "R_CREATOR_GATE"));
    Ok(())
}
