//! End-to-end lifecycle against the sandbox: create, commit, Walk, settle PASS (under- and oversubscribed), settle FAIL, refunds, claims.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

async fn fill(env: &Env, id: u64, n: usize, each: u128) -> Vec<Account> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await.unwrap();
        let r = env.commit_native(&u, id, each, None).await;
        assert!(r.is_success(), "commit {i} failed: {:?}", r.failures());
        users.push(u);
    }
    users
}

async fn settle_all(env: &Env, id: u64) {
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result().unwrap();
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()
        .unwrap();
}

#[tokio::test]
async fn create_trial_opens_after_token_verification() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    let st = env.state(id).await;
    assert_eq!((st["status"].as_str(), st["phase"].as_str()), (Some("Open"), Some("Open")));
    assert_eq!(st["token"], format!("abcd.{}", env.factory.id()));
    Ok(())
}

#[tokio::test]
async fn pass_undersubscribed_full_money_path() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    fill(&env, id, 12, 30 * USDC).await; // 360 USDC >= soft cap 350, 12 funders >= 10
    assert_eq!(env.state(id).await["total_active"], (360 * USDC).to_string());
    let early = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(has_code(&early, "R_TOO_EARLY"), "settle before walk_end must fail");
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?, "settle must PASS");
    let again = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(again.json::<bool>()?, "settle is idempotent");
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "launch_fee_due"), num(&led, "excess_pool")), (10 * USDC, 0));
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    let all = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": led["stream_total"] }), ZERO).await;
    assert!(has_code(&all, "STREAM_CAP"), "withdraw-all must hit STREAM_CAP");
    Ok(())
}

#[tokio::test]
async fn pass_oversubscribed_four_buckets_refunds_and_claims() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("OVER")).await?;
    let users = fill(&env, id, 14, 100 * USDC).await; // 1,400 > hard cap 1,000
    settle_all(&env, id).await;
    let st = env.view("get_settlement", lid(id)).await;
    assert_eq!((num(&st, "accepted"), num(&st, "excess_pool")), (1_000 * USDC, 400 * USDC));
    let (spend, refund) = (71_428_572u128, 28_571_428u128); // S1-B rounding rules: spend ceil, refund floor
    let before = env.usdc_balance(users[0].id()).await;
    env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) }), ZERO)
        .await
        .into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await - before, refund, "anyone may push a refund; destination is fixed");
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) })).await;
    assert_eq!((num(&pos, "spent"), pos["conserved"].as_bool()), (spend, Some(true)));
    let noop = env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(noop.is_success() && !noop.json::<bool>()?, "second refund call is a harmless no-op");
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    // tokens: the holder registers on the launch token first, then claims sale tokens (+ the tiny vested bonus)
    env.register_on_token("OVER", users[2].id()).await?;
    env.call(&users[2], "claim_tokens", lid(id), ONE).await.into_result()?;
    let got = env.token_balance("OVER", users[2].id()).await;
    let expected = 42_857_142_857_142u128; // floor(100e6 * 600e12 / 1400e6)
    assert!(got >= expected && got < expected + 1_000_000_000, "got {got}");
    Ok(())
}

#[tokio::test]
async fn fail_below_soft_cap_refunds_everyone_then_dissolves_and_returns_bond() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FAIL")).await?;
    let users = fill(&env, id, 5, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    assert_eq!(env.state(id).await["status"], "Failed(3)");
    for u in &users {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    }
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    let bal = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(id), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > bal, "bond returned");
    assert_eq!(env.state(id).await["status"], "Dissolved");
    Ok(())
}

#[tokio::test]
async fn cancel_trial_makes_everyone_refundable_at_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("CNCL")).await?;
    let users = fill(&env, id, 3, 50 * USDC).await;
    assert!(has_code(&env.call(&users[0], "cancel_trial", lid(id), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.creator, "cancel_trial", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.state(id).await["status"], "Failed(4)");
    env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);
    Ok(())
}

#[tokio::test]
async fn walk_shrinks_the_book_refunds_and_closes_at_walk_end() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("WALK")).await?;
    let users = fill(&env, id, 2, 40 * USDC).await;
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    let st = env.state(id).await;
    assert_eq!((st["total_active"].as_str(), st["active_funders"].as_u64()), (Some("40000000"), Some(1)));
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC, "principal returned in full, no fee");
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_NO_POSITION"));
    assert!(env.commit_native(&users[0], id, 20 * USDC, None).await.is_success(), "a walker may commit again while Open");
    env.advance_to(id, "Closing").await;
    env.call(&users[1], "walk", lid(id), ONE).await.into_result()?;
    env.advance_to(id, "Ready").await;
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_WALK_CLOSED"));
    Ok(())
}
