//! Solana-buyer paths against the mock Verifier: S3 (signed transfer with flat msg, primary), S4 (parse-and-forward fallback),
//! relay fee carve-out, Intents-custody refunds, consolidation, and walk_signed.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);

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
async fn s3_credits_net_of_relay_fee_and_rejects_by_refunding_the_signer() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SOLX")).await?;
    let h = sol_holder(7);
    env.fund_intents(&h.hex, 500 * USDC).await?;
    let ok = env.commit_s3(&h, id, 50 * USDC, 300_000).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
    assert_eq!((pos["open_intents"].as_str(), pos["contributed"].as_str()), (Some("49700000"), Some("49700000")));
    assert_eq!(env.intents_balance(&h.hex).await, 450 * USDC, "the signer paid exactly the signed amount");
    assert_eq!(env.view("get_ledger", lid(id)).await["relay_fee_total"], "300000");
    // relay fee above the cap, net below min_buy, wrong deliver key, and a hex signer delivering to NEAR are all refunded
    let other = sol_holder(8);
    for (amount, fee, deliver, code) in [
        (50 * USDC, 600_000u128, h.key(), "R_RELAY_FEE"),
        (20 * USDC, 400_000, h.key(), "R_MIN_CONTRIBUTION"),
        (50 * USDC, 0, other.key(), "R_DELIVER"),
        (50 * USDC, 0, "near:alice.near".to_string(), "R_DELIVER"),
    ] {
        let before = env.intents_balance(&h.hex).await;
        let r = env.s3_payload(&h.hex, id, amount, Some(msg(id, Some(&deliver), Some(fee)))).await;
        assert!(has_code(&r, code), "expected {code}: {:?}", r.logs());
        assert_eq!(env.intents_balance(&h.hex).await, before, "{code}: balance returns automatically");
    }
    // relay fees are paid out of core's Intents balance to the relay-fees account
    env.call(&env.creator, "pay_relay_fees", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.intents_balance(env.relay_fees.id().as_str()).await, 300_000);
    Ok(())
}

#[tokio::test]
async fn solana_walk_refunds_to_intents_and_walk_signed_checks_signature_nonce_and_deadline() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SWLK")).await?;
    let h = sol_holder(9);
    env.fund_intents(&h.hex, 100 * USDC).await?;
    assert!(env.commit_s3(&h, id, 60 * USDC, 0).await.is_success());
    let call = |nonce: u64, deadline: u64, sig: String| {
        let (a, core) = (env.creator.clone(), env.core.id().clone());
        let key = h.key();
        async move {
            a.call(&core, "walk_signed").args_json(json!({ "launch_id": id.to_string(), "holder": key, "nonce": nonce.to_string(), "deadline": deadline.to_string(), "signature": sig })).gas(GAS).transact().await.unwrap()
        }
    };
    let far = u64::MAX / 2;
    let preimage = |n: u64, d: u64| format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env.core.id(), id, h.key(), n, d);
    assert!(has_code(&call(1, far, sol_holder(10).sign(&preimage(1, far))).await, "R_SIG"), "signature by another key");
    assert!(has_code(&call(1, 5, h.sign(&preimage(1, 5))).await, "R_DEADLINE"));
    assert!(has_code(&call(0, far, h.sign(&preimage(0, far))).await, "R_NONCE"));
    let ok = call(1, far, h.sign(&preimage(1, far))).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(env.intents_balance(&h.hex).await, 100 * USDC, "Walk refunds to the signer's own Intents account");
    assert!(has_code(&call(1, far, h.sign(&preimage(1, far))).await, "R_NONCE"), "replay is refused");
    Ok(())
}

#[tokio::test]
async fn s4_forwards_only_strictly_shaped_payloads() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SFOR")).await?;
    let h = sol_holder(11);
    env.fund_intents(&h.hex, 200 * USDC).await?;
    let submit = |signed: serde_json::Value| {
        let (a, core) = (env.creator.clone(), env.core.id().clone());
        async move { a.call(&core, "contribute_via_intents").args_json(json!({ "signed": signed })).gas(GAS).transact().await.unwrap() }
    };
    let good = env.s4_signed(&h, id, 50 * USDC, 100_000);
    let mut wrong_signer = good.clone();
    wrong_signer["public_key"] = json!(format!("ed25519:{}", sol_holder(12).b58));
    let mut extra_msg: serde_json::Value = serde_json::from_str(good["payload"].as_str().unwrap())?;
    extra_msg["intents"][0]["msg"] = json!("sneaky");
    let mut with_msg = good.clone();
    with_msg["payload"] = json!(extra_msg.to_string());
    let mut other_standard = good.clone();
    other_standard["standard"] = json!("nep413");
    for (bad, why) in [
        (wrong_signer, "signer_id != hex(key)"),
        (with_msg, "unknown field msg"),
        (other_standard, "wrong standard"),
        (env.s4_signed(&h, id, 50 * USDC, 900_000), "fee above cap"),
    ] {
        let r = submit(bad).await;
        assert!(r.is_failure(), "{why} must be refused before anything is forwarded");
        assert_eq!(env.intents_balance(&h.hex).await, 200 * USDC, "{why}: nothing moved");
    }
    let r = submit(good).await;
    assert!(r.is_success(), "{:?}", r.failures());
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
    assert_eq!(pos["open_intents"], "49900000");
    assert_eq!(env.intents_balance(&h.hex).await, 150 * USDC);
    Ok(())
}

#[tokio::test]
async fn pass_with_intents_buyers_consolidates_and_pays_the_stream() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("CONS")).await?;
    for i in 0..12u8 {
        let h = sol_holder(20 + i);
        env.fund_intents(&h.hex, 40 * USDC).await?;
        assert!(env.commit_s3(&h, id, 30 * USDC, 0).await.is_success());
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    assert!(
        has_code(&env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await, "R_NOTHING_FREE"),
        "fee cannot be paid before consolidation"
    );
    env.call(&env.creator, "consolidate", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.core.id()).await, 360 * USDC, "all settled Intents proceeds are now native");
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    Ok(())
}
