//! Adversarial cases: one failing case per R_* code reachable through the public API, plus pause/freeze,
//! callback re-credit, fake-token and direct-callback attacks, and creation failures.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::result::ValueOrReceiptId;
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
    let before = env.creator.view_account().await?.balance.as_yoctonear();
    assert!(has_code(&attempt(p.clone(), req - 1).await, "R_DEPOSIT"));
    assert!(has_code(&attempt(TrialParams { soft_cap: 100 * USDC, ..p.clone() }, req).await, "R_SOFT_CAP"));
    // DC-3: a refused create_trial returns the attached deposit; the creator is out gas only (two refused calls, far below one deposit)
    let spent = before - env.creator.view_account().await?.balance.as_yoctonear();
    assert!(req > NearToken::from_millinear(400).as_yoctonear(), "the deposit under test is not trivial: {req}");
    assert!(spent < req / 4, "two refused calls cost {spent} yocto, the {req} deposit must have come back");
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

/// W1-DC-9 at the REAL $3,000 global cap, never lowered: launch A holds $2,000 (twice its $1,000 hard cap, 20 wallets at the $100
/// wallet cap), launch B by a second creator holds $1,000, and the next $20 is refused with R_CAP_GLOBAL although B itself is nowhere
/// near its own $2,000 limit. Slow (about 100 transactions): run with `cargo test -- --ignored`.
#[tokio::test]
#[ignore]
async fn global_cap_refuses_at_the_real_three_thousand_dollars() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("GLOA");
    p.commit_secs = 3_600; // the sandbox clock moves with every block; keep both windows open for ~100 transactions
    let a = env.create_launch(&p).await?; // hard cap 1,000: wallet cap 100, max_total_held 2,000
    let second_creator = env
        .worker
        .root_account()?
        .create_subaccount("creator2")
        .initial_balance(NearToken::from_near(100))
        .transact()
        .await?
        .into_result()?;
    let mut next_seed = 1u8;
    let mut fill = |launch: u64, wallets: u8| {
        let seeds: Vec<u8> = (next_seed..next_seed + wallets).collect();
        next_seed += wallets;
        (launch, seeds)
    };
    let (launch, seeds) = fill(a, 20);
    for seed in seeds {
        let h = sol_holder(seed);
        env.fund_intents(&h.hex, 100 * USDC).await?;
        assert!(env.commit_s3(&h, launch, 100 * USDC, 0).await.is_success(), "launch A wallet {seed}");
    }
    let cfg = env.view("get_config", json!({})).await;
    assert_eq!((cfg["global_cap"].as_str(), cfg["global_held"].as_str()), (Some("3000000000"), Some("2000000000")), "real cap, A full");
    let mut q = params("GLOB");
    q.commit_secs = 3_600;
    let b = env.create_launch_as(&second_creator, &q).await?; // hard cap 1,000 equals the remaining $1,000 of headroom
    let (launch, seeds) = fill(b, 10);
    for seed in seeds {
        let h = sol_holder(seed);
        env.fund_intents(&h.hex, 100 * USDC).await?;
        assert!(env.commit_s3(&h, launch, 100 * USDC, 0).await.is_success(), "launch B wallet {seed}");
    }
    assert_eq!(env.view("get_config", json!({})).await["global_held"], "3000000000", "exactly at the $3,000 global cap");
    let late = sol_holder(200);
    env.fund_intents(&late.hex, 20 * USDC).await?;
    let r = env.commit_s3(&late, b, 20 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_GLOBAL"), "{:?}", r.logs());
    assert!(!has_code(&r, "R_CAP_LAUNCH"), "launch B alone would have accepted it: {:?}", r.logs());
    assert_eq!(env.intents_balance(&late.hex).await, 20 * USDC, "the refused $20 went back to the signer's Intents balance");
    assert_eq!(env.state(b).await["total_active"], (1_000 * USDC).to_string());
    assert_eq!(env.view("get_config", json!({})).await["global_held"], "3000000000");
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

/// W-REFUND-PARTIAL: a holder with a native leg and an Intents leg; the Intents leg is refused. Only that leg is re-credited.
#[tokio::test]
async fn refund_partial_native_ok_intents_fails_recredits_only_the_failed_leg() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PART")).await?;
    let alice = env.user("alice", 1_000 * USDC).await?;
    env.fund_intents(alice.id().as_str(), 40 * USDC).await?;
    assert!(env.commit_native(&alice, id, 40 * USDC, None).await.is_success());
    let s3 = env.s3_payload(alice.id().as_str(), id, 40 * USDC, Some(msg(id, None, None))).await;
    assert!(s3.is_success(), "{:?}", s3.failures());
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", alice.id()) });
    let pos = env.view("get_position", key.clone()).await;
    assert_eq!((pos["open_native"].as_str(), pos["open_intents"].as_str()), (Some("40000000"), Some("40000000")));
    env.intents.call("set_fail_transfers").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    env.call(&alice, "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(alice.id()).await, 1_000 * USDC - 40 * USDC + 40 * USDC, "the native leg paid");
    let pos = env.view("get_position", key.clone()).await;
    assert_eq!(
        (
            pos["due_native"].as_str(),
            pos["due_intents"].as_str(),
            pos["inflight"].as_str(),
            pos["refunded"].as_str(),
            pos["conserved"].as_bool()
        ),
        (Some("0"), Some("40000000"), Some("0"), Some("40000000"), Some(true)),
        "only the Intents leg is owed again"
    );
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!(
        (led["due_intents"].as_str(), led["refunded"].as_str(), led["inflight_intents"].as_str()),
        (Some("40000000"), Some("40000000"), Some("0"))
    );
    env.intents.call("set_fail_transfers").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    env.call(&env.creator, "claim_refund", key.clone(), ZERO).await.into_result()?;
    assert_eq!(env.intents_balance(alice.id().as_str()).await, 40 * USDC, "the retry paid the Intents leg once");
    assert_eq!(env.usdc_balance(alice.id()).await, 1_000 * USDC, "and did not pay the native leg again");
    assert!(!env.call(&alice, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.json::<bool>()?);
    Ok(())
}

async fn failed_launch_with_five_buyers(env: &Env, symbol: &str) -> anyhow::Result<(u64, Vec<near_workspaces::Account>)> {
    let id = env.create_launch(&params(symbol)).await?;
    let mut users = Vec::new();
    for i in 0..5 {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
        users.push(u);
    }
    env.advance_to(id, "Ready").await;
    assert!(!env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?, "150 USDC is below the soft cap");
    Ok((id, users))
}

/// A-REENTRANCY-REFUND: the token calls claim_refund again from inside ft_transfer, before core's callback runs.
#[tokio::test]
async fn reentrant_refund_cannot_pay_twice() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch_with_five_buyers(&env, "REEN").await?;
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) });
    env.usdc
        .call("set_reenter")
        .args_json(json!({ "account": env.core.id(), "method": "claim_refund", "args": key.to_string() }))
        .transact()
        .await?
        .into_result()?;
    let r = env.call(&users[1], "claim_refund", key.clone(), ZERO).await;
    // Every value core returned in this transaction tree, in order: the outer claim paid (true), then the reentrant claim_refund
    // that the token fired from inside ft_transfer ran and was refused (false). Callbacks return nothing.
    let core_bools: Vec<bool> = r
        .outcomes()
        .into_iter()
        .filter(|o| o.executor_id == *env.core.id())
        .filter_map(|o| match o.clone().into_result() {
            Ok(ValueOrReceiptId::Value(v)) => v.json::<bool>().ok(),
            _ => None,
        })
        .collect();
    assert_eq!(core_bools, vec![true, false], "the outer claim paid once and the reentrant claim ran and paid nothing");
    assert!(r.failures().is_empty(), "the reentrant call is refused by returning false, not by crashing: {:?}", r.failures());
    r.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC, "refunded exactly once, not twice");
    assert_eq!(env.view("get_position", key).await, serde_json::Value::Null, "a fully paid position record is deleted");
    assert_eq!(env.view("get_ledger", lid(id)).await["refunded"], "30000000", "the ledger shows one refund of 30 USDC, not two");
    Ok(())
}

/// W-DOUBLE-REFUND: a second claim, by the holder or by a keeper, is a harmless no-op.
#[tokio::test]
async fn double_refund_pays_exactly_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch_with_five_buyers(&env, "DBLE").await?;
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) });
    assert!(env.call(&users[0], "claim_refund", key.clone(), ZERO).await.json::<bool>()?);
    assert!(!env.call(&users[0], "claim_refund", key.clone(), ZERO).await.json::<bool>()?);
    assert!(!env.call(&env.creator, "claim_refund", key, ZERO).await.json::<bool>()?);
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);
    assert_eq!(env.view("get_ledger", lid(id)).await["refunded"], "30000000");
    Ok(())
}

async fn settle_and_sweep(env: &Env, id: u64, settler: &near_workspaces::Account) -> anyhow::Result<()> {
    env.advance_to(id, "Ready").await;
    env.call(settler, "settle", lid(id), ZERO).await.into_result()?;
    env.call(settler, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(settler, "sweep_residue", lid(id), ZERO).await.into_result()?;
    Ok(())
}

/// A-DUST: dust-sized commits are refused and refunded; odd-sized commits settle with the rounding residue going to the LP bucket only.
#[tokio::test]
async fn a_dust() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("DUST")).await?;
    let dust = env.user("dusty", 1_000 * USDC).await?;
    for amount in [1u128, 1_000, 19_999_999] {
        let r = env.commit_native(&dust, id, amount, None).await;
        assert!(has_code(&r, "R_MIN_CONTRIBUTION"), "{amount}: {:?}", r.logs());
    }
    assert_eq!(env.usdc_balance(dust.id()).await, 1_000 * USDC, "every dust attempt came back whole");
    let state = env.state(id).await;
    assert_eq!(
        (state["total_active"].as_str(), state["active_funders"].as_u64(), state["holder_count"].as_u64()),
        (Some("0"), Some(0), Some(0))
    );
    // 11 buyers of 99.999999 USDC: 1,099.999989 against a 1,000 cap, every division inexact
    for i in 0..11 {
        let u = env.user(&format!("d{i}"), 200 * USDC).await?;
        assert!(env.commit_native(&u, id, 99_999_999, None).await.is_success());
    }
    settle_and_sweep(&env, id, &env.creator).await?;
    let (st, led) = (env.view("get_settlement", lid(id)).await, env.view("get_ledger", lid(id)).await);
    let get = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap().parse::<u128>().unwrap();
    let spent = get(&led, "spent_native");
    let residue = spent - get(&st, "accepted");
    assert!(residue < 11, "rounding residue is under one micro-USDC per buyer, got {residue}");
    assert_eq!(get(&led, "lp_seed_due"), get(&st, "lp_quote") + residue, "the residue went to the LP bucket");
    assert_eq!(
        (get(&led, "excess_pool"), get(&led, "stream_total")),
        (0, get(&st, "stream")),
        "creator stream and platform fee are unchanged by dust"
    );
    assert_eq!(get(&led, "launch_fee_due"), get(&st, "launch_fee"));
    Ok(())
}

/// A-TIMESTAMP-BOUNDARY (sandbox side; the exact-equality side is the pure test `a_timestamp_boundary_walk_and_settle_never_both_open`).
#[tokio::test]
async fn a_timestamp_boundary() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("TIME")).await?;
    let mut users = Vec::new();
    for i in 0..12 {
        let u = env.user(&format!("t{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
        users.push(u);
    }
    env.advance_to(id, "Closing").await;
    let early = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(has_code(&early, "R_TOO_EARLY"), "settle is closed while the Walk tail runs");
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    env.advance_to(id, "Ready").await;
    assert!(has_code(&env.call(&users[1], "walk", lid(id), ONE).await, "R_WALK_CLOSED"), "Walk is closed once settle is open");
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.json::<bool>()?, "11 buyers and 440 USDC left: still PASS");
    assert_eq!(env.state(id).await["active_funders"], 11, "the one Walk inside the tail counted; the one after it did not");
    Ok(())
}

/// A-DONATION: USDC sent straight to core (no commit message) credits nothing and cannot rescue a failing book.
#[tokio::test]
async fn a_donation() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("DONA")).await?;
    let mut buyers = Vec::new();
    for i in 0..5 {
        let u = env.user(&format!("b{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
        buyers.push(u);
    }
    let rich = env.user("whale", 5_000 * USDC).await?;
    let inputs_before = env.view("get_verdict_inputs", lid(id)).await;
    let ledger_before = env.view("get_ledger", lid(id)).await;
    rich.call(env.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": env.core.id(), "amount": (2_000 * USDC).to_string() }))
        .deposit(ONE)
        .transact()
        .await?
        .into_result()?;
    assert_eq!(env.usdc_balance(env.core.id()).await, (150 + 2_000) * USDC, "the donation really arrived");
    assert_eq!(env.view("get_verdict_inputs", lid(id)).await, inputs_before, "verdict inputs unchanged by a donation");
    assert_eq!(env.view("get_ledger", lid(id)).await, ledger_before, "credited, open and bucket counters unchanged");
    env.advance_to(id, "Ready").await;
    assert!(!env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?, "2,150 USDC held, 150 committed: still FAIL");
    for u in &buyers {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "refunds are exactly the commits");
    }
    Ok(())
}

/// A-SLOT-SPAM: minimum-size positions can fill the holder slots (each costs the attacker a refundable $20), never more than the bond covers.
#[tokio::test]
async fn a_slot_spam() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("SLOT");
    p.hard_cap = 500 * USDC; // max_holders = min(500, ceil(2 * 500 / 20)) = 50
    p.commit_secs = 3_600;
    let id = env.create_launch(&p).await?;
    let max_holders = env.view("get_charter", lid(id)).await["derived"]["max_holders"].as_u64().unwrap();
    assert_eq!(max_holders, 50);
    for i in 0..max_holders {
        let h = sol_holder(i as u8 + 1);
        env.fund_intents(&h.hex, 20 * USDC).await?;
        assert!(env.commit_s3(&h, id, 20 * USDC, 0).await.is_success(), "slot {i}");
    }
    let extra = sol_holder(200);
    env.fund_intents(&extra.hex, 20 * USDC).await?;
    let r = env.commit_s3(&extra, id, 20 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_HOLDERS"), "{:?}", r.logs());
    assert_eq!(env.intents_balance(&extra.hex).await, 20 * USDC, "the 51st attempt is refunded in full");
    let st = env.state(id).await;
    assert_eq!(
        (st["positions_live"].as_u64(), st["holder_count"].as_u64()),
        (Some(max_holders), Some(max_holders)),
        "records never exceed the cap"
    );
    assert!(
        st["bond"].as_str().unwrap().parse::<u128>()? >= kruxa_logic::bond_required(max_holders as u32),
        "the creator bond covers every slot"
    );
    Ok(())
}

/// What a launch ends with, independent of who called what and in which order.
async fn final_book(env: &Env, id: u64, users: &[near_workspaces::Account]) -> (serde_json::Value, Vec<(String, String, String, String)>) {
    let mut st = env.view("get_settlement", lid(id)).await;
    let obj = st.as_object_mut().unwrap();
    obj.remove("settled_at");
    obj.remove("book_hash"); // the rolling hash is order-dependent BY DESIGN; the verdict and the money are not
    let mut rows = Vec::new();
    for u in users {
        let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) })).await;
        let f = |k: &str| p[k].as_str().unwrap_or("-").to_string();
        rows.push((
            u.id().to_string(),
            f("spent"),
            f("tokens_entitled"),
            (f("due_native").parse::<u128>().unwrap_or(0) + f("refunded").parse::<u128>().unwrap_or(0)).to_string(),
        ));
    }
    (st, rows)
}

/// A-FRONTRUN-FINALIZE: the same buyers and amounts, committed in the opposite order, settled by a stranger who also pokes the
/// lazy per-position settlement in a different order, end in the identical verdict, buckets and per-holder amounts.
#[tokio::test]
async fn a_frontrun_finalize() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut users = Vec::new();
    for i in 0..13 {
        users.push(env.user(&format!("f{i}"), 1_000 * USDC).await?);
    }
    let amount = |i: usize| (60 + 3 * i as u128) * USDC; // 60..96 USDC, 1,014 in total: oversubscribed, inexact shares
    let first = env.create_launch(&params("ONE")).await?;
    for (i, u) in users.iter().enumerate() {
        assert!(env.commit_native(u, first, amount(i), None).await.is_success());
    }
    settle_and_sweep(&env, first, &env.creator).await?;
    let a = final_book(&env, first, &users).await;
    let second = env.create_launch(&params("TWO")).await?;
    for (i, u) in users.iter().enumerate().rev() {
        assert!(env.commit_native(u, second, amount(i), None).await.is_success());
    }
    env.advance_to(second, "Ready").await;
    let stranger = &users[5];
    env.call(stranger, "settle", lid(second), ZERO).await.into_result()?;
    env.call(&users[9], "claim_refund", json!({ "launch_id": second.to_string(), "holder": null }), ZERO).await.into_result()?;
    for from in [10u32, 5, 0] {
        env.call(&users[3], "settle_positions_page", json!({ "launch_id": second.to_string(), "from_seq": from, "limit": 5 }), ZERO)
            .await
            .into_result()?;
    }
    env.call(stranger, "sweep_residue", lid(second), ZERO).await.into_result()?;
    let b = final_book(&env, second, &users).await;
    let strip = |mut v: serde_json::Value| {
        v.as_object_mut().unwrap().remove("inputs_hash"); // carries launch_id and charter_hash, which legitimately differ per launch
        v
    };
    assert_eq!(strip(a.0), strip(b.0), "verdict and the four buckets are identical");
    assert_eq!(a.1, b.1, "every holder gets the same spend, tokens and refund");
    Ok(())
}

/// W1-DC-9: the ruled caps are what the contract enforces, raising them waits 7 days, only the owner can queue a raise.
#[tokio::test]
async fn caps_are_the_ruled_values_and_raising_is_timelocked() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let cfg = env.view("get_config", json!({})).await;
    assert_eq!(
        (cfg["global_cap"].as_str(), cfg["rules"]["max_hard_cap"].as_str()),
        (Some("3000000000"), Some("1000000000")),
        "$3,000 global, $1,000 per launch"
    );
    let p = params("CAPA");
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
    let create = |p: TrialParams| {
        let (creator, core, dep) = (env.creator.clone(), env.core.id().clone(), required.parse::<u128>().unwrap());
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
    let over = create(TrialParams { hard_cap: 1_000 * USDC + 1, ..p.clone() }).await;
    assert!(has_code(&over, "R_HARD_CAP"), "$1,000 + 1 micro per launch is refused: {:?}", over.failures());
    env.call(&env.owner, "lower_global_cap", json!({ "value": (400 * USDC).to_string() }), ZERO).await.into_result()?;
    assert!(has_code(&create(p.clone()).await, "R_CAP_GLOBAL"), "a launch whose hard cap exceeds the global headroom is refused");
    assert!(has_code(
        &env.call(&env.guardian, "queue_global_cap", json!({ "value": (9_000 * USDC).to_string() }), ZERO).await,
        "R_NOT_AUTHORIZED"
    ));
    assert!(
        has_code(&env.call(&env.owner, "lower_global_cap", json!({ "value": (900 * USDC).to_string() }), ZERO).await, "R_CAP_GLOBAL"),
        "lowering cannot raise"
    );
    env.call(&env.owner, "queue_global_cap", json!({ "value": (3_000 * USDC).to_string() }), ZERO).await.into_result()?;
    let queued = env.view("get_config", json!({})).await["pending_global_cap"].clone();
    let effective: u128 = queued["effective_at"].as_str().unwrap().parse()?;
    let now = env.worker.view_block().await?.timestamp() as u128;
    let seven_days: u128 = 7 * 86_400 * 1_000_000_000;
    assert!(
        effective >= now && effective - now <= seven_days + 120 * 1_000_000_000 && effective + 120 * 1_000_000_000 >= now + seven_days,
        "applies in 7 days: {queued}"
    );
    assert!(has_code(&env.call(&env.owner, "apply_global_cap", json!({}), ZERO).await, "R_NOT_YET"));
    env.call(&env.owner, "queue_launch_cap", json!({ "value": (2_000 * USDC).to_string() }), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.owner, "apply_launch_cap", json!({}), ZERO).await, "R_NOT_YET"), "the per-launch cap raise waits too");
    Ok(())
}

/// W-WALK-FLIP and "a failed payout leaves verdict inputs unchanged": one Walk takes a passing book under the soft cap, the refund
/// leg fails, and the verdict inputs still reflect the Walk (the money is re-credited as owed, the book is not).
#[tokio::test]
async fn walk_flips_pass_to_fail_and_a_failed_payout_leaves_verdict_inputs_unchanged() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FLIP")).await?;
    let mut users = Vec::new();
    for i in 0..11 {
        let u = env.user(&format!("w{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 32 * USDC, None).await.is_success()); // 352 USDC, 11 funders: would PASS
        users.push(u);
    }
    let inputs = |v: &serde_json::Value| {
        (v["inputs"]["total_active"].as_str().unwrap().to_string(), v["inputs"]["active_funders"].as_u64().unwrap())
    };
    assert_eq!(inputs(&env.view("get_verdict_inputs", lid(id)).await), ("352000000".to_string(), 11));
    env.usdc.call("unregister").args_json(json!({ "account_id": users[0].id() })).transact().await?.into_result()?;
    let _ = env.call(&users[0], "walk", lid(id), ONE).await; // the Walk lands, the refund transfer fails, the callback re-credits
    let after = env.view("get_verdict_inputs", lid(id)).await;
    assert_eq!(inputs(&after), ("320000000".to_string(), 10), "the failed payout did not undo the Walk in the verdict inputs");
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) })).await;
    assert_eq!((pos["due_native"].as_str(), pos["inflight"].as_str()), (Some("32000000"), Some("0")), "the money is owed again, not lost");
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(!r.json::<bool>()?, "320 USDC is below the 350 soft cap: the Walk flipped PASS to FAIL");
    assert_eq!(env.state(id).await["status"], "Failed(1)");
    assert_eq!(env.view("get_verdict_inputs", lid(id)).await, after, "settle did not change the inputs either");
    Ok(())
}
