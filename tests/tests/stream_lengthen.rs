//! `lengthen_stream`: the creator may only push the end of the stream later. The cap stays continuous at the change and is never
//! higher afterwards than the original schedule; STREAM_CAP on `draw` keeps holding against the new line.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const DAY_NS: u128 = 86_400_000_000_000;

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

/// 12 buyers x 30 USDC = 360 USDC: PASS, every position settled, residue swept, so `draw` is open.
async fn passed_and_swept(
    env: &Env,
    creator: &Account,
    recipient: Option<&near_workspaces::AccountId>,
    symbol: &str,
) -> anyhow::Result<u64> {
    let id = env.create_launch_to(creator, &params(symbol), recipient).await?;
    for i in 0..12 {
        let u = env.user(&format!("s{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
    }
    env.advance_to(id, "Ready").await;
    env.call(creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    Ok(id)
}

async fn lengthen(env: &Env, who: &Account, id: u64, days: u32) -> near_workspaces::result::ExecutionFinalResult {
    env.call(who, "lengthen_stream", json!({ "launch_id": id.to_string(), "new_duration_days": days }), ZERO).await
}

/// What the ORIGINAL 30 day schedule would have unlocked by now (an upper bound: the clock is read just after the view).
async fn original_cap(env: &Env, id: u64, total: u128) -> u128 {
    let settled_at: u128 = env.view("get_settlement", lid(id)).await["settled_at"].as_str().unwrap().parse().unwrap();
    let now = u128::from(env.worker.view_block().await.unwrap().timestamp());
    total * (now - settled_at) / (30 * DAY_NS)
}

#[tokio::test]
async fn lengthen_stream_refusals_creator_only_after_pass_longer_only_and_at_most_365_days() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let c0 = env.user("c0", 0).await?;
    let early = env.create_launch_as(&c0, &params("LENO")).await?;
    assert!(has_code(&lengthen(&env, &c0, early, 60).await, "R_WRONG_PHASE"), "no stream before PASS");
    let id = passed_and_swept(&env, &env.creator, None, "LENG").await?;
    let stranger = env.user("stranger", 0).await?;
    assert!(has_code(&lengthen(&env, &stranger, id, 60).await, "R_NOT_AUTHORIZED"));
    assert!(has_code(&lengthen(&env, &env.owner, id, 60).await, "R_NOT_AUTHORIZED"), "not even the owner");
    for days in [0u32, 1, 29, 30] {
        assert!(has_code(&lengthen(&env, &env.creator, id, days).await, "R_LENGTHEN_ONLY"), "{days} days is not longer than 30");
    }
    assert!(has_code(&lengthen(&env, &env.creator, id, 366).await, "R_STREAM"), "at most 365 days");
    assert!(has_code(&lengthen(&env, &env.creator, 99, 60).await, "R_NO_LAUNCH"));
    let ends_before = num(&env.view("stream_status", lid(id)).await, "ends_at");
    lengthen(&env, &env.creator, id, 60).await.into_result()?;
    let ends_after = num(&env.view("stream_status", lid(id)).await, "ends_at");
    assert_eq!(ends_after - ends_before, 30 * DAY_NS, "the end moved from day 30 to day 60");
    assert!(has_code(&lengthen(&env, &env.creator, id, 60).await, "R_LENGTHEN_ONLY"), "same length again");
    assert!(has_code(&lengthen(&env, &env.creator, id, 45).await, "R_LENGTHEN_ONLY"), "no shortening back");
    lengthen(&env, &env.creator, id, 365).await.into_result()?;
    // a failed launch has no stream at all
    let c2 = env.user("c2", 0).await?;
    let fail_id = env.create_launch_as(&c2, &params("LENF")).await?;
    env.advance_to(fail_id, "Ready").await;
    env.call(&c2, "settle", lid(fail_id), ZERO).await.into_result()?;
    assert!(has_code(&lengthen(&env, &c2, fail_id, 60).await, "R_WRONG_PHASE"), "a failed launch has no stream");
    Ok(())
}

#[tokio::test]
async fn lengthen_keeps_the_cap_continuous_and_never_above_the_original_schedule() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = passed_and_swept(&env, &env.creator, None, "LENC").await?;
    let total = num(&env.view("get_ledger", lid(id)).await, "stream_total");
    env.worker.fast_forward(200).await?;
    let cap_before = num(&env.view("stream_status", lid(id)).await, "cap");
    assert!(cap_before > 0);
    lengthen(&env, &env.creator, id, 90).await.into_result()?;
    let cap_at = num(&env.view("stream_status", lid(id)).await, "cap");
    assert!(cap_at >= cap_before, "the cap never drops at the change: {cap_before} -> {cap_at}");
    let slack = total / (30 * 86_400) * 10; // ten seconds of the original rate covers the blocks between the two views
    assert!(cap_at - cap_before <= slack, "and it does not jump: +{} (slack {slack})", cap_at - cap_before);
    let mut last = cap_at;
    for _ in 0..4 {
        env.worker.fast_forward(150).await?;
        let cap = num(&env.view("stream_status", lid(id)).await, "cap");
        let old = original_cap(&env, id, total).await;
        assert!(cap >= last, "the cap is monotone");
        assert!(cap <= old, "never faster than the original line: new {cap} vs original {old}");
        last = cap;
    }
    let old = original_cap(&env, id, total).await;
    assert!(old - last > old / 10, "and clearly slower: original {old}, now {last}");
    Ok(())
}

#[tokio::test]
async fn adversarial_lengthen_cannot_speed_the_stream_unlock_more_than_the_new_cap_or_move_the_total() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = env.user("payee", 0).await?;
    let id = passed_and_swept(&env, &env.creator, Some(payee.id()), "LENA").await?;
    let led = env.view("get_ledger", lid(id)).await;
    let total = num(&led, "stream_total");
    lengthen(&env, &env.creator, id, 120).await.into_result()?;
    assert_eq!(num(&env.view("get_ledger", lid(id)).await, "stream_total"), total, "lengthening never changes the total");
    // the payee (not the creator) may not touch the schedule, in either direction
    assert!(has_code(&lengthen(&env, &payee, id, 365).await, "R_NOT_AUTHORIZED"));
    assert!(has_code(&lengthen(&env, &payee, id, 40).await, "R_NOT_AUTHORIZED"));
    env.worker.fast_forward(300).await?;
    // withdraw-all and the ORIGINAL line's amount are both refused: STREAM_CAP is enforced against the new line
    let draw = |amount: u128| {
        let (c, p) = (env.core.id().clone(), payee.clone());
        let id = id.to_string();
        async move { p.call(&c, "draw").args_json(json!({ "launch_id": id, "amount": amount.to_string() })).gas(GAS).transact().await.unwrap() }
    };
    assert!(has_code(&draw(total).await, "STREAM_CAP"), "withdraw-all");
    let old = original_cap(&env, id, total).await;
    let new_cap = num(&env.view("stream_status", lid(id)).await, "cap");
    assert!(old > new_cap + 10, "the two lines have diverged: original {old}, new {new_cap}");
    assert!(has_code(&draw(old).await, "STREAM_CAP"), "the original schedule's amount is no longer unlocked");
    // the new line's own amount is paid, to the payee, not to the creator
    let drawable = num(&env.view("stream_status", lid(id)).await, "drawable");
    let before = env.usdc_balance(payee.id()).await;
    let r = draw(drawable).await;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(env.usdc_balance(payee.id()).await - before, drawable);
    assert_eq!(env.usdc_balance(env.creator.id()).await, 0, "the creator who lengthened gained nothing");
    // pause never blocks a lengthening (it only slows the creator), and a pause does not stop the clock
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    lengthen(&env, &env.creator, id, 200).await.into_result()?;
    Ok(())
}
