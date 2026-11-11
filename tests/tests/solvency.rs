//! The on-chain solvency anchor (ARCHITECTURE 5.6): counters vs real balances on every money path, a short Intents balance,
//! a short native balance, an unreadable Verifier, the cooldown, and "never blocks an exit".
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Contract;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

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

async fn report(env: &Env) -> Value {
    env.view("solvency_report", json!({})).await
}

/// Quiescent state, no donations: the counters equal the recomputation AND the real balances (exact, not just >=).
/// `get_invariants` (called by the harness after every step) already asserts counters == recomputation; this ties both to reality.
async fn exact(env: &Env, step: &str) {
    let r = report(env).await;
    assert_eq!(r["counters_ok"], true, "{step}: counters drifted from the recomputation: {r}");
    assert_eq!(env.usdc_balance(env.core.id()).await, num(&r, "held_native"), "{step}: native balance != native liability: {r}");
    assert_eq!(
        env.intents_balance(env.core.id().as_str()).await,
        num(&r, "held_intents"),
        "{step}: intents balance != intents liability: {r}"
    );
}

async fn check(env: &Env, caller: &near_workspaces::Account) -> near_workspaces::result::ExecutionFinalResult {
    caller.call(env.core.id(), "check_solvency").gas(GAS).transact().await.unwrap()
}

async fn set_intents_balance(env: &Env, amount: u128) {
    env.intents
        .call("mt_force_set")
        .args_json(json!({ "account_id": env.core.id(), "token_id": format!("nep141:{}", env.usdc.id()), "amount": amount.to_string() }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
}

/// Lets the 30 second cooldown pass.
async fn wait_cooldown(env: &Env) {
    env.worker.fast_forward(100).await.unwrap();
}

struct Mixed {
    id: u64,
    natives: Vec<near_workspaces::Account>,
    sols: Vec<SolHolder>,
}

/// 8 NEAR buyers and 6 Solana buyers (relay fee on each) into one oversubscribed launch.
async fn mixed_launch(env: &Env, symbol: &str) -> anyhow::Result<Mixed> {
    let id = env.create_launch(&params(symbol)).await?;
    exact(env, "created").await;
    let mut natives = Vec::new();
    for i in 0..8 {
        let u = env.user(&format!("n{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 100 * USDC, None).await.into_result()?;
        natives.push(u);
    }
    exact(env, "native commits").await;
    let mut sols = Vec::new();
    for i in 0..6u8 {
        let h = sol_holder(40 + i);
        env.fund_intents(&h.hex, 200 * USDC).await?;
        env.commit_s3(&h, id, 100 * USDC, 300_000).await.into_result()?;
        sols.push(h);
    }
    exact(env, "intents commits with relay fees").await;
    Ok(Mixed { id, natives, sols })
}

#[tokio::test]
async fn counters_equal_recomputed_liabilities_and_real_balances_on_every_money_path_pass() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let Mixed { id, natives, sols } = mixed_launch(&env, "SOLV").await?;
    // Walk, both custodies
    env.call(&natives[0], "walk", lid(id), ONE).await.into_result()?;
    exact(&env, "native walk").await;
    let far = u64::MAX / 2;
    let preimage = format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env.core.id(), id, sols[0].key(), 1, far);
    let args = json!({ "launch_id": id.to_string(), "holder": sols[0].key(), "nonce": "1", "deadline": far.to_string(), "signature": sols[0].sign(&preimage) });
    env.worker_call(&env.creator, env.core.id(), "walk_signed", args).await.into_result()?;
    exact(&env, "signed walk (Intents refund)").await;
    // settle, per-position settle, refund push
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    exact(&env, "settle PASS").await;
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    exact(&env, "settle_positions_page").await;
    let holder = format!("near:{}", natives[1].id());
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": holder }), ZERO).await.into_result()?;
    exact(&env, "native refund").await;
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": sols[1].key() }), ZERO).await.into_result()?;
    exact(&env, "Intents refund").await;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    exact(&env, "sweep_residue").await;
    env.call(&env.creator, "consolidate", lid(id), ZERO).await.into_result()?;
    exact(&env, "consolidate").await;
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    exact(&env, "pay_launch_fee").await;
    env.call(&env.creator, "pay_relay_fees", lid(id), ZERO).await.into_result()?;
    exact(&env, "pay_relay_fees").await;
    for u in natives.iter().skip(1) {
        let holder = format!("near:{}", u.id());
        env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": holder }), ZERO).await.into_result()?;
    }
    exact(&env, "all native refunds").await;
    let r = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": null }), ZERO).await;
    r.into_result()?;
    exact(&env, "stream draw").await;
    env.register_on_token("SOLV", natives[2].id()).await?;
    env.call(&natives[2], "claim_tokens", lid(id), ONE).await.into_result()?;
    exact(&env, "claim_tokens").await;
    let market = env.deploy_stub_market().await?;
    market.call("set_mode").args_json(json!({ "mode": "accept" })).transact().await?.into_result()?;
    assert_eq!(env.call(&env.creator, "open_market", lid(id), ZERO).await.json::<u8>()?, 2);
    exact(&env, "open_market (LP seed leaves core)").await;
    // the periodic check agrees with everything above
    let res = check(&env, &env.creator).await;
    assert!(res.is_success(), "{:?}", res.failures());
    let last = report(&env).await["last_check"].clone();
    assert_eq!((last["ok"].clone(), last["intents_alert"].clone()), (json!(true), json!(false)), "{last}");
    Ok(())
}

#[tokio::test]
async fn counters_equal_real_balances_on_the_fail_path_and_a_failed_refund_leg() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SFAI")).await?;
    let mut users = Vec::new();
    for i in 0..3 {
        let u = env.user(&format!("f{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 50 * USDC, None).await.into_result()?;
        users.push(u);
    }
    let h = sol_holder(77);
    env.fund_intents(&h.hex, 100 * USDC).await?;
    env.commit_s3(&h, id, 60 * USDC, 100_000).await.into_result()?;
    exact(&env, "commits").await;
    env.advance_to(id, "Ready").await;
    assert_eq!(env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?, false);
    exact(&env, "settle FAIL").await;
    // the Verifier refuses the refund leg: the debit is re-credited and stays a liability
    env.intents.call("set_fail_transfers").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": h.key() }), ZERO).await.into_result()?;
    exact(&env, "failed Intents refund leg re-credited").await;
    env.intents.call("set_fail_transfers").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": h.key() }), ZERO).await.into_result()?;
    for u in &users {
        env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) }), ZERO)
            .await
            .into_result()?;
    }
    exact(&env, "all refunds").await;
    env.call(&env.creator, "pay_relay_fees", lid(id), ZERO).await.into_result()?;
    exact(&env, "relay fee paid out").await;
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    let r = report(&env).await;
    assert_eq!((num(&r, "held_native"), num(&r, "held_intents")), (0, 0), "a dissolved launch owes nothing");
    Ok(())
}

#[tokio::test]
async fn short_intents_balance_raises_the_alert_refuses_new_intents_commits_and_never_blocks_exits() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SSHT")).await?;
    let native = env.user("native1", 1_000 * USDC).await?;
    env.commit_native(&native, id, 50 * USDC, None).await.into_result()?;
    let a = sol_holder(60);
    let b = sol_holder(61);
    for h in [&a, &b] {
        env.fund_intents(&h.hex, 200 * USDC).await?;
    }
    env.commit_s3(&a, id, 100 * USDC, 0).await.into_result()?;
    exact(&env, "before the loss").await;
    // healthy check first: ok, no alert
    let first = check(&env, &env.creator).await;
    assert!(first.is_success(), "{:?}", first.failures());
    assert_eq!(report(&env).await["last_check"]["ok"], true);
    // the Verifier loses 40 USDC of core's balance (DAO force withdraw)
    set_intents_balance(&env, 60 * USDC).await;
    wait_cooldown(&env).await;
    let res = env.core.call("reconcile_intents").gas(GAS).transact().await?;
    assert!(res.is_success(), "reconcile_intents must report, never fail: {:?}", res.failures());
    assert!(res.logs().iter().any(|l| l.contains("solvency_report")), "{:?}", res.logs());
    let r = report(&env).await;
    assert_eq!(r["intents_alert"], true);
    assert_eq!(r["last_check"]["intents"]["ok"], false);
    assert_eq!(num(&r["last_check"]["intents"], "liability"), 100 * USDC);
    assert_eq!(num(&r["last_check"]["intents"], "balance"), 60 * USDC);
    assert!(r["last_check"]["native"].is_null(), "the Intents-only check does not read the native side");
    assert_eq!(env.view("get_invariants", lid(id)).await["intents_alert"], true);
    // new Intents commits are refused (refunded to the signer), previews say why
    let before = env.intents_balance(&b.hex).await;
    let refused = env.commit_s3(&b, id, 50 * USDC, 0).await;
    assert!(has_code(&refused, "R_SOLVENCY"), "{:?}", refused.logs());
    assert_eq!(env.intents_balance(&b.hex).await, before, "the refused commit returned to the signer");
    let prev = env
        .view(
            "preview_contribution",
            json!({ "launch_id": id.to_string(), "holder": b.key(), "amount": (50 * USDC).to_string(), "relay_fee": null }),
        )
        .await;
    assert_eq!((prev["ok"].clone(), prev["code"].clone()), (json!(false), json!("R_SOLVENCY")));
    // native commits, walks and refunds are not touched by the alert
    let late = env.user("native2", 1_000 * USDC).await?;
    assert!(env.commit_native(&late, id, 50 * USDC, None).await.is_success());
    assert_eq!(
        env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", late.id()) })).await["open_native"],
        (50 * USDC).to_string()
    );
    env.call(&late, "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(late.id()).await, 1_000 * USDC, "the native Walk paid out in full while the alert was up");
    // the loss is made good: the next check clears the alert and commits resume
    set_intents_balance(&env, 100 * USDC).await;
    wait_cooldown(&env).await;
    check(&env, &env.creator).await.into_result()?;
    assert_eq!(report(&env).await["intents_alert"], false);
    assert!(env.commit_s3(&b, id, 50 * USDC, 0).await.is_success());
    Ok(())
}

#[tokio::test]
async fn short_native_balance_is_reported_without_blocking_anything() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SNAT")).await?;
    let u = env.user("n1", 1_000 * USDC).await?;
    env.commit_native(&u, id, 80 * USDC, None).await.into_result()?;
    env.usdc
        .call("burn")
        .args_json(json!({ "account_id": env.core.id(), "amount": (30 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    let res = check(&env, &env.creator).await;
    assert!(res.is_success(), "{:?}", res.failures());
    let last = report(&env).await["last_check"].clone();
    assert_eq!(
        (last["ok"].clone(), last["native"]["ok"].clone(), last["intents"]["ok"].clone()),
        (json!(false), json!(false), json!(true)),
        "{last}"
    );
    assert_eq!(num(&last["native"], "balance"), 50 * USDC);
    assert_eq!(num(&last["native"], "liability"), 80 * USDC);
    assert_eq!(last["intents_alert"], false, "a native shortfall never gates Intents commits");
    let more = env.user("n2", 1_000 * USDC).await?;
    assert!(env.commit_native(&more, id, 50 * USDC, None).await.is_success(), "new native commits still work");
    Ok(())
}

#[tokio::test]
async fn unreadable_verifier_never_panics_the_callback_and_leaves_the_alert_alone() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let root = env.worker.root_account()?;
    let code = kruxa_tests::core_wasm_bytes();
    let acct = root.create_subaccount("core2").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
    let core2: Contract = acct.deploy(&code).await?.into_result()?;
    // intents account has no contract: mt_balance_of fails
    core2
        .call("new")
        .args_json(json!({ "owner": env.owner.id(), "guardian": env.guardian.id(), "treasury": env.treasury.id(), "relay_fees": env.relay_fees.id(),
                           "usdc": env.usdc.id(), "intents": "ghost.test.near", "factory": env.factory.id(), "profile": "demo" }))
        .transact()
        .await?
        .into_result()?;
    for method in ["check_solvency", "reconcile_intents"] {
        let res = env.creator.call(core2.id(), method).gas(GAS).transact().await?;
        assert!(res.is_success(), "{method} must finish even when the Verifier is unreadable: {:?}", res.failures());
        let view: Value = core2.view("solvency_report").await?.json()?;
        assert!(view["last_check"]["intents"].is_null(), "unknown is not reported as a number: {view}");
        assert_eq!(view["intents_alert"], false, "an outage is not a shortfall");
        env.worker.fast_forward(100).await?;
    }
    Ok(())
}

#[tokio::test]
async fn check_solvency_is_cheap_permissionless_rate_limited_and_works_while_paused() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let stranger = env.user("stranger", 0).await?;
    let ok = check(&env, &stranger).await;
    assert!(ok.is_success(), "any account may check, no deposit: {:?}", ok.failures());
    let again = check(&env, &stranger).await;
    assert!(has_code(&again, "R_TOO_EARLY"), "a second check inside the cooldown is refused: {:?}", again.failures());
    let other = env.core.call("reconcile_intents").gas(GAS).transact().await?;
    assert!(has_code(&other, "R_TOO_EARLY"), "the cooldown is shared by both entry points");
    let burnt = ok.total_gas_burnt.as_gas() / 1_000_000_000_000;
    assert!(burnt < 40, "a check is a constant, small cost: {burnt} Tgas");
    // a pause blocks new risk, never the check
    env.guardian.call(env.core.id(), "pause").transact().await?.into_result()?;
    wait_cooldown(&env).await;
    assert!(check(&env, &stranger).await.is_success());
    Ok(())
}
