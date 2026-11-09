//! Refund conveniences: `claim_refund_batch` (anyone, at most 25 holders, one callback per leg) and `set_refund_route`
//! (the holder's own native refund, sent to an account on intents.near).
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

fn key(a: &Account) -> String {
    format!("near:{}", a.id())
}

async fn buyers(env: &Env, id: u64, n: usize) -> Vec<Account> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("b{i}"), 1_000 * USDC).await.unwrap();
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
        users.push(u);
    }
    users
}

/// Five buyers of 30 USDC: below the soft cap, so the launch FAILS and every position is refundable.
async fn failed_launch(env: &Env, symbol: &str, n: usize) -> (u64, Vec<Account>) {
    let id = env.create_launch(&params(symbol)).await.unwrap();
    let users = buyers(env, id, n).await;
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>().unwrap());
    (id, users)
}

async fn position(env: &Env, id: u64, a: &Account) -> Value {
    env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(a) })).await
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn batch_pays_each_holder_their_own_refund_and_resumes_where_gas_ran_out() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "BTCH", 8).await;
    let keeper = env.user("keeper", 0).await?;
    let (mut rounds, mut first_handled) = (0, 0);
    loop {
        // everyone still unpaid, plus a holder without a position and a duplicate (both harmless)
        let mut holders = Vec::new();
        for u in &users {
            if !position(&env, id, u).await.is_null() {
                holders.push(key(u)); // a fully refunded position is deleted
            }
        }
        if holders.is_empty() {
            break;
        }
        holders.push("near:nobody.test.near".to_string());
        holders.push(holders[0].clone());
        let r = env.call(&keeper, "claim_refund_batch", json!({ "launch_id": id.to_string(), "holders": holders }), ZERO).await;
        assert!(r.is_success(), "{:?}", r.failures());
        let out: Value = r.json()?;
        if rounds == 0 {
            first_handled = out["handled"].as_u64().unwrap();
            assert!(first_handled >= 1, "at least one holder per call: {out}");
        }
        rounds += 1;
        assert!(rounds < 12, "the batch must make progress every call");
    }
    for u in &users {
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "each holder got their own 30 USDC back");
    }
    assert_eq!(env.usdc_balance(keeper.id()).await, 0, "the caller of a batch receives nothing");
    assert_eq!(env.view("get_ledger", lid(id)).await["refunded"], (8 * 30 * USDC).to_string());
    println!("batch of 10 entries: first call handled {first_handled}, finished in {rounds} call(s)");
    Ok(())
}

#[tokio::test]
async fn batch_refusals_size_input_launch_and_frozen() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "BREF", 2).await;
    let call = |holders: Vec<String>, launch: u64| {
        let (c, who) = (env.core.id().clone(), env.creator.clone());
        async move {
            who.call(&c, "claim_refund_batch")
                .args_json(json!({ "launch_id": launch.to_string(), "holders": holders }))
                .gas(GAS)
                .transact()
                .await
                .unwrap()
        }
    };
    assert!(has_code(&call(vec![], id).await, "R_BATCH_SIZE"), "empty batch");
    assert!(has_code(&call(vec![key(&users[0]); 26], id).await, "R_BATCH_SIZE"), "26 holders is one too many");
    assert!(has_code(&call(vec!["alice.near".to_string()], id).await, "R_NO_POSITION"), "malformed holder key");
    assert!(has_code(&call(vec![key(&users[0])], 99).await, "R_NO_LAUNCH"));
    let ok = call(vec![key(&users[0]); 25], id).await;
    assert!(ok.is_success(), "exactly 25 is allowed: {:?}", ok.failures());
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&call(vec![key(&users[1])], id).await, "R_FROZEN"), "FROZEN closes exits, batch included");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    assert!(call(vec![key(&users[1])], id).await.is_success(), "PAUSED keeps refunds open");
    Ok(())
}

#[tokio::test]
async fn adversarial_batch_cannot_walk_anyone_out_redirect_a_refund_or_pay_twice() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("BADV")).await?;
    let users = buyers(&env, id, 3).await;
    let attacker = env.user("attacker", 0).await?;
    let holders: Vec<String> = users.iter().map(key).collect();
    // while the launch is Open nobody has anything due: the batch moves nothing and does not touch an open position
    let r = env.call(&attacker, "claim_refund_batch", json!({ "launch_id": id.to_string(), "holders": holders }), ZERO).await;
    assert_eq!(r.json::<Value>()?["paid"], 0);
    for u in &users {
        assert_eq!(num(&position(&env, id, u).await, "open_native"), 30 * USDC, "an open position is not exited by a stranger");
    }
    assert_eq!(env.state(id).await["total_active"], (90 * USDC).to_string(), "the verdict inputs are untouched");
    // after the verdict (FAIL: 90 < soft cap) the attacker can push, but only to the holders
    env.advance_to(id, "Ready").await;
    env.call(&attacker, "settle", lid(id), ZERO).await.into_result()?;
    let holders: Vec<String> = users.iter().map(key).collect();
    for _ in 0..4 {
        env.call(&attacker, "claim_refund_batch", json!({ "launch_id": id.to_string(), "holders": holders }), ZERO).await.into_result()?;
    }
    assert_eq!(env.usdc_balance(attacker.id()).await, 0, "the attacker gained nothing");
    for u in &users {
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "paid exactly once, to the holder");
    }
    assert_eq!(env.view("get_ledger", lid(id)).await["refunded"], (90 * USDC).to_string(), "repeat batches never pay twice");
    Ok(())
}

async fn unregister(env: &Env, a: &Account) {
    env.usdc.call("unregister").args_json(json!({ "account_id": a.id() })).transact().await.unwrap().into_result().unwrap();
}

#[tokio::test]
async fn refund_route_sends_a_stuck_native_refund_to_the_holders_intents_account() -> anyhow::Result<()> {
    let env = Env::new_real_intents().await?;
    let id = env.create_launch(&params("ROUT")).await?;
    let users = buyers(&env, id, 3).await;
    let to = |a: &Account| json!({ "launch_id": id.to_string(), "intents_account": a.id() });
    assert!(has_code(&env.call(&users[1], "set_refund_route", to(&users[1]), ZERO).await, "R_NOTHING"), "an open position has nothing due");
    env.advance_to(id, "Ready").await;
    assert!(!env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?);
    unregister(&env, &users[0]).await;
    let stuck = env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(stuck.is_success(), "the callback absorbs the failed leg: {:?}", stuck.failures());
    let pos = position(&env, id, &users[0]).await;
    assert_eq!((num(&pos, "due_native"), num(&pos, "refunded")), (30 * USDC, 0), "the failed leg went back to due: {pos}");
    // a stranger and a holder with nothing due are refused
    let stranger = env.user("stranger", 0).await?;
    assert!(has_code(&env.call(&stranger, "set_refund_route", to(&stranger), ZERO).await, "R_NO_POSITION"));
    env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&users[1], "set_refund_route", to(&users[1]), ZERO).await, "R_NO_POSITION"), "already paid and deleted");
    // the holder routes their own refund to their own account inside the Verifier
    let before = env.intents_balance(users[0].id().as_str()).await;
    let r = env.call(&users[0], "set_refund_route", to(&users[0]), ZERO).await;
    assert!(r.is_success(), "{:?}", r.failures());
    assert_eq!(env.intents_balance(users[0].id().as_str()).await - before, 30 * USDC, "30 USDC arrived on intents.near");
    assert!(position(&env, id, &users[0]).await.is_null(), "a fully refunded position is deleted");
    assert_eq!(env.view("get_ledger", lid(id)).await["refunded"], (60 * USDC).to_string());
    assert!(has_code(&env.call(&users[0], "set_refund_route", to(&users[0]), ZERO).await, "R_NO_POSITION"), "no second payout");
    Ok(())
}

#[tokio::test]
async fn adversarial_refund_route_is_the_callers_own_money_and_a_failed_route_goes_back_to_due() -> anyhow::Result<()> {
    // the mock Verifier has no ft_on_transfer, so the route leg fails and the funds come back to core
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "RADV", 2).await;
    let attacker = env.user("attacker", 0).await?;
    let victim = &users[0];
    let steal = json!({ "launch_id": id.to_string(), "intents_account": attacker.id() });
    assert!(has_code(&env.call(&attacker, "set_refund_route", steal.clone(), ZERO).await, "R_NO_POSITION"), "no position, no route");
    let pos = position(&env, id, victim).await;
    assert_eq!(num(&pos, "open_native") + num(&pos, "due_native"), 30 * USDC, "the victim's refund is untouched");
    // a holder routing to an account that cannot take the deposit does not lose the money
    let own = json!({ "launch_id": id.to_string(), "intents_account": victim.id() });
    let r = env.call(victim, "set_refund_route", own, ZERO).await;
    assert!(r.is_success(), "{:?}", r.failures());
    let pos = position(&env, id, victim).await;
    assert_eq!(
        (num(&pos, "due_native"), num(&pos, "refunded"), pos["conserved"].as_bool()),
        (30 * USDC, 0, Some(true)),
        "back to due: {pos}"
    );
    assert_eq!(env.usdc_balance(attacker.id()).await, 0);
    // the ordinary refund still works afterwards
    env.call(victim, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(victim.id()).await, 1_000 * USDC);
    // FROZEN closes it like every exit
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(
        &env.call(&users[1], "set_refund_route", json!({ "launch_id": id.to_string(), "intents_account": users[1].id() }), ZERO).await,
        "R_FROZEN"
    ));
    Ok(())
}
