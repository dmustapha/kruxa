//! Adversarial cases: one failing case per R_* code reachable through the public API, plus pause/freeze,
//! callback re-credit, fake-token and direct-callback attacks, and creation failures.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> serde_json::Value {
    json!({ "launch_id": id.to_string() })
}

#[tokio::test]
async fn commits_that_break_a_rule_are_rejected_and_the_money_comes_back() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("RULE")).await?;
    let u = env.user("buyer", 1_000 * USDC).await?;
    let cases: Vec<(&str, u128, Option<&str>, &str)> = vec![
        ("R_MIN_CONTRIBUTION", 19 * USDC, None, "below min_buy"),
        ("R_CAP_ACCOUNT", 101 * USDC, None, "above wallet cap"),
        ("R_DELIVER", 30 * USDC, Some("sol:11111111111111111111111111111111"), "native payer may not deliver to Solana"),
    ];
    for (code, amount, deliver, why) in cases {
        let r = env.commit_native(&u, id, amount, deliver).await;
        assert!(has_code(&r, code), "{why}: expected {code}, logs {:?}", r.logs());
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "{why}: nothing may be kept");
    }
    // malformed and unknown-field messages
    for bad in [
        "{}",
        "not json",
        &json!({"v":1,"op":"contribute","launch_id":"1","evil":true}).to_string(),
        &json!({"v":1,"op":"contribute","launch_id":"1","relay_fee":"1"}).to_string(),
    ] {
        let r = u
            .call(env.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": env.core.id(), "amount": (30 * USDC).to_string(), "msg": bad }))
            .deposit(ONE)
            .gas(GAS)
            .transact()
            .await?;
        assert!(has_code(&r, "R_SIGNED_MSG") || has_code(&r, "R_RELAY_FEE"), "msg {bad}: {:?}", r.logs());
    }
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    // creator self-buy
    env.usdc
        .call("mint")
        .args_json(json!({ "account_id": env.creator.id(), "amount": (50 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    let r = env.commit_native(&env.creator, id, 30 * USDC, None).await;
    assert!(has_code(&r, "R_SELF_BUY"));
    assert_eq!(env.state(id).await["total_active"], "0");
    // after commit_end the window is closed
    env.advance_to(id, "Closing").await;
    assert!(has_code(&env.commit_native(&u, id, 30 * USDC, None).await, "R_WRONG_PHASE"));
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    Ok(())
}

#[tokio::test]
async fn fake_tokens_and_direct_callbacks_cannot_credit_anything() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FAKE")).await?;
    let fake =
        env.worker.root_account()?.create_subaccount("fake").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let fake =
        fake.deploy(&std::fs::read(format!("{}/../target/near/mock_ft/mock_ft.wasm", env!("CARGO_MANIFEST_DIR")))?).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": env.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    let attacker = env
        .worker
        .root_account()?
        .create_subaccount("attacker")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    fake.call("mint")
        .args_json(json!({ "account_id": attacker.id(), "amount": (500 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    env.owner
        .call(fake.id(), "storage_deposit")
        .args_json(json!({ "account_id": env.core.id() }))
        .deposit(NearToken::from_millinear(2))
        .transact()
        .await?
        .into_result()?;
    let r = attacker
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": env.core.id(), "amount": (50 * USDC).to_string(), "msg": msg(id, None, None) }))
        .deposit(ONE)
        .gas(GAS)
        .transact()
        .await?;
    assert!(r.is_success());
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"), "{:?}", r.logs());
    assert_eq!(env.state(id).await["total_active"], "0", "a different token must never credit a position");
    let direct = env.worker_call(&attacker, env.core.id(), "mt_on_transfer", json!({ "sender_id": attacker.id(), "previous_owner_ids": [attacker.id()], "token_ids": [format!("nep141:{}", env.usdc.id())], "amounts": ["30000000"], "msg": msg(id, None, None) })).await;
    assert!(has_code(&direct, "R_NOT_AUTHORIZED"));
    let cb = env
        .worker_call(
            &attacker,
            env.core.id(),
            "on_payout",
            json!({ "op": { "kind": "Stream", "launch_id": id.to_string(), "holder": null, "amount": "1" } }),
        )
        .await;
    assert!(cb.is_failure(), "private callbacks reject outside callers");
    Ok(())
}

#[tokio::test]
async fn create_trial_rejects_bad_params_deposit_duplicates_and_recovers_from_factory_failure() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let p = params("GOOD");
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
    let attempt = |p: TrialParams, dep: u128| {
        let (creator, core) = (env.creator.clone(), env.core.id().clone());
        async move {
            creator
                .call(&core, "create_trial")
                .args_json(json!({ "params": p, "stream_recipient": null }))
                .deposit(NearToken::from_yoctonear(dep))
                .gas(GAS)
                .transact()
                .await
                .unwrap()
        }
    };
    let req: u128 = required.parse()?;
    assert!(has_code(&attempt(p.clone(), req - 1).await, "R_DEPOSIT"));
    assert!(has_code(&attempt(TrialParams { soft_cap: 100 * USDC, ..p.clone() }, req).await, "R_SOFT_CAP"));
    assert!(has_code(&attempt(TrialParams { symbol: "good".into(), ..p.clone() }, req).await, "R_SYMBOL"));
    let mut greedy = p.clone();
    greedy.fees.total_fee_bps = 200;
    greedy.fees.creator_bps = 5_100; // 200 x 5,100 = 1,020,000 > 100 x 10,000: the creator would take more than 1.00% of volume
    assert!(has_code(&attempt(greedy, req).await, "R_CREATOR_TAKE"));
    assert!(
        has_code(&attempt(TrialParams { symbol: "KRUXA".into(), ..p.clone() }, req).await, "R_SYMBOL"),
        "brand symbol is reserved for the owner"
    );
    // factory failure: launch ends CreationFailed, symbol is freed, bond + factory deposit come back
    env.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let r = attempt(p.clone(), req).await;
    assert!(r.is_success());
    assert_eq!(env.state(1).await["status"], "CreationFailed");
    assert!(has_code(&r, "R_TOKEN_CREATE"), "{:?}", r.logs());
    let before = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(1), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > before);
    env.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    // a healthy launch reusing the freed symbol (launch id 1 was the failed one), then a second one from the same creator is refused
    env.next_id.set(2);
    let id = env.create_launch(&p).await?;
    assert_eq!(env.state(id).await["status"], "Open");
    assert!(has_code(&attempt(params("SECOND"), req).await, "R_ACTIVE_TRIAL"));
    Ok(())
}

#[tokio::test]
async fn pause_blocks_new_risk_but_not_exits_and_freeze_blocks_exits() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PAUS")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    assert!(has_code(&env.call(&env.creator, "pause", json!({}), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.commit_native(&u, id, 40 * USDC, None).await, "R_PAUSED"), "new commits are refused while paused");
    assert_eq!(env.usdc_balance(u.id()).await, 960 * USDC);
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&u, "walk", lid(id), ONE).await, "R_FROZEN"), "exits close only while frozen");
    assert!(has_code(&env.call(&env.guardian, "unpause", json!({}), ZERO).await, "R_NOT_AUTHORIZED"), "only the owner unpauses");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    env.call(&u, "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "Walk works while paused");
    Ok(())
}

#[tokio::test]
async fn failed_refund_leg_recredits_and_a_retry_pays_exactly_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("RECR")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    env.usdc.call("unregister").args_json(json!({ "account_id": u.id() })).transact().await?.into_result()?;
    let _ = env.call(&u, "walk", lid(id), ONE).await; // refund leg fails inside ft_transfer, callback re-credits
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) })).await;
    assert_eq!(
        (pos["due_native"].as_str(), pos["inflight"].as_str(), pos["conserved"].as_bool()),
        (Some("40000000"), Some("0"), Some(true))
    );
    assert_eq!(env.view("get_invariants", lid(id)).await["l1_ok"], true);
    env.register(&env.usdc, u.id()).await?;
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) }), ZERO)
        .await
        .into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    let again = env.call(&u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(!again.json::<bool>()?);
    Ok(())
}

#[tokio::test]
async fn caps_global_launch_and_holder_limits_hold() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("CAPS");
    p.hard_cap = 500 * USDC; // max_total_held 1,000; max_holders min(500, ceil(2*500/20)) = 50
    let id = env.create_launch(&p).await?;
    env.call(&env.owner, "lower_global_cap", json!({ "value": (150 * USDC).to_string() }), ZERO).await.into_result()?;
    let (a, b) = (sol_holder(1), sol_holder(2));
    for h in [&a, &b] {
        env.fund_intents(&h.hex, 100 * USDC).await?;
    }
    assert!(env.commit_s3(&a, id, 100 * USDC, 0).await.is_success());
    let r = env.commit_s3(&b, id, 100 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_GLOBAL"), "{:?}", r.logs());
    assert_eq!(env.intents_balance(&b.hex).await, 100 * USDC, "rejected S3 commit refunds to the signer's Intents balance");
    env.call(&env.owner, "queue_global_cap", json!({ "value": (3_000 * USDC).to_string() }), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.owner, "apply_global_cap", json!({}), ZERO).await, "R_NOT_YET"), "raising a cap is timelocked");
    Ok(())
}

#[tokio::test]
async fn launch_total_cap_stops_oversubscription_at_twice_the_hard_cap() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("LCAP");
    p.hard_cap = 500 * USDC; // max_total_held = 1,000
    let id = env.create_launch(&p).await?;
    for i in 0..10u8 {
        let h = sol_holder(100 + i);
        env.fund_intents(&h.hex, 100 * USDC).await?;
        assert!(env.commit_s3(&h, id, 100 * USDC, 0).await.is_success());
    }
    let late = sol_holder(120);
    env.fund_intents(&late.hex, 100 * USDC).await?;
    let r = env.commit_s3(&late, id, 100 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_LAUNCH"), "{:?}", r.logs());
    assert_eq!(env.state(id).await["total_active"], (1_000 * USDC).to_string());
    Ok(())
}

/// Slow (about 200 transactions): run with `cargo test -- --ignored`.
#[tokio::test]
#[ignore]
async fn holder_cap_is_enforced_before_the_launch_total() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("HCAP");
    p.commit_secs = 3_600; // the sandbox clock moves with every block; keep the window open for ~200 transactions
    let id = env.create_launch(&p).await?; // hard cap 1,000, min_buy 20 => max_holders 100, max_total_held 2,000
    for i in 0..100u8 {
        let h = sol_holder(i.wrapping_add(1));
        env.fund_intents(&h.hex, 20 * USDC).await?;
        assert!(env.commit_s3(&h, id, 20 * USDC, 0).await.is_success(), "holder {i}");
    }
    let extra = sol_holder(200);
    env.fund_intents(&extra.hex, 20 * USDC).await?;
    let r = env.commit_s3(&extra, id, 20 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_HOLDERS"), "{:?}", r.logs());
    Ok(())
}

#[tokio::test]
async fn a_pause_cannot_hold_the_verdict_hostage_but_it_does_hold_creator_payouts() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("HOLD")).await?;
    for i in 0..12u8 {
        let h = sol_holder(60 + i);
        env.fund_intents(&h.hex, 30 * USDC).await?;
        assert!(env.commit_s3(&h, id, 30 * USDC, 0).await.is_success());
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?, "settle is a pure function and still runs while paused");
    for (method, args) in
        [("settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 })), ("sweep_residue", lid(id))]
    {
        env.call(&env.creator, method, args, ZERO).await.into_result()?;
    }
    assert!(has_code(&env.call(&env.creator, "consolidate", lid(id), ZERO).await, "R_PAUSED"), "outbound proceeds wait while paused");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.creator, "consolidate", lid(id), ZERO).await.into_result()?;
    Ok(())
}
