//! W1-DC-8 / Task 2.3: the S3 path and its guards against the REAL `intents.near` wasm (code hash pinned in scripts/fetch-intents-wasm.sh),
//! with real ed25519 signatures. `cargo test -p kruxa-tests --test real_intents real_verifier`.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
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

async fn setup(symbol: &str, seed: u8) -> anyhow::Result<(Env, u64, SolHolder)> {
    let env = Env::new_real_intents().await?;
    let id = env.create_launch(&params(symbol)).await?;
    let h = sol_holder(seed);
    env.deposit_real_intents(&h.hex, 500 * USDC).await?;
    assert_eq!(env.intents_balance(&h.hex).await, 500 * USDC, "the real Verifier credited the deposit");
    Ok((env, id, h))
}

#[tokio::test]
async fn real_verifier_s3_accept_credits_net_of_relay_fee() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVA", 7).await?;
    let usdc = env.usdc.id().clone();
    let ok = env.s3_real(&h, &usdc, 50 * USDC, Some(msg(id, Some(&h.key()), Some(300_000))), 1).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
    assert_eq!((pos["open_intents"].as_str(), pos["contributed"].as_str()), (Some("49700000"), Some("49700000")));
    assert_eq!(env.intents_balance(&h.hex).await, 450 * USDC, "the signer paid exactly the signed amount, nothing came back");
    assert_eq!(env.intents_balance(env.core.id().as_str()).await, 50 * USDC, "core holds the credit inside Intents");
    assert_eq!(env.view("get_ledger", lid(id)).await["relay_fee_total"], "300000");
    Ok(())
}

#[tokio::test]
async fn real_verifier_rejects_refund_the_signer() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVB", 8).await?;
    let usdc = env.usdc.id().clone();
    let other = sol_holder(9);
    let cases = [
        (50 * USDC, 600_000u128, h.key(), "R_RELAY_FEE"),
        (20 * USDC, 400_000, h.key(), "R_MIN_CONTRIBUTION"),
        (50 * USDC, 0, other.key(), "R_DELIVER"),
        (50 * USDC, 0, "near:alice.near".to_string(), "R_DELIVER"),
    ];
    for (i, (amount, fee, deliver, code)) in cases.into_iter().enumerate() {
        let r = env.s3_real(&h, &usdc, amount, Some(msg(id, Some(&deliver), Some(fee))), 10 + i as u8).await;
        assert!(has_code(&r, code), "expected {code}: {:?}", r.logs());
        assert_eq!(env.intents_balance(&h.hex).await, 500 * USDC, "{code}: the balance returns to the signer");
    }
    assert_eq!(env.intents_balance(env.core.id().as_str()).await, 0);
    Ok(())
}

#[tokio::test]
async fn real_verifier_fake_token_is_refused_and_refunded() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVC", 11).await?;
    let root = env.worker.root_account()?;
    let fake = root.create_subaccount("fake").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
    let fake =
        fake.deploy(&std::fs::read(format!("{}/../target/near/mock_ft/mock_ft.wasm", env!("CARGO_MANIFEST_DIR")))?).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": env.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    env.register(&fake, env.intents.id()).await?;
    fake.call("mint")
        .args_json(json!({ "account_id": env.owner.id(), "amount": (100 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    env.owner
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": env.intents.id(), "amount": (100 * USDC).to_string(), "msg": h.hex }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await?
        .into_result()?;
    let r = env.s3_real(&h, fake.id(), 60 * USDC, Some(msg(id, Some(&h.key()), None)), 21).await;
    let back: String = env
        .intents
        .view("mt_balance_of")
        .args_json(json!({ "account_id": h.hex, "token_id": format!("nep141:{}", fake.id()) }))
        .await?
        .json()?;
    assert_eq!(back, (100 * USDC).to_string(), "the fake token went back to the signer: {:?}", r.logs());
    assert_eq!(env.state(id).await["total_active"], "0", "nothing was credited");
    Ok(())
}

#[tokio::test]
async fn real_verifier_only_intents_near_may_call_mt_on_transfer() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVD", 12).await?;
    let stranger = env.user("stranger", 0).await?;
    let args = json!({ "sender_id": h.hex, "previous_owner_ids": [h.hex], "token_ids": [format!("nep141:{}", env.usdc.id())],
                       "amounts": [(50 * USDC).to_string()], "msg": msg(id, Some(&h.key()), None) });
    let r = env.call(&stranger, "mt_on_transfer", args, ZERO).await;
    assert!(has_code(&r, "R_NOT_AUTHORIZED"), "{:?}", r.failures());
    assert_eq!(env.state(id).await["total_active"], "0");
    Ok(())
}

#[tokio::test]
async fn real_verifier_replayed_signature_is_refused_by_the_nonce() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVE", 13).await?;
    let usdc = env.usdc.id().clone();
    let m = Some(msg(id, Some(&h.key()), None));
    assert!(env.s3_real(&h, &usdc, 30 * USDC, m.clone(), 31).await.is_success());
    let again = env.s3_real(&h, &usdc, 30 * USDC, m, 31).await;
    assert!(again.is_failure(), "same nonce twice must fail inside the Verifier");
    assert_eq!(env.intents_balance(&h.hex).await, 470 * USDC, "charged once");
    Ok(())
}

#[tokio::test]
async fn real_verifier_paused_refuses_commits_and_exits_stay_open() -> anyhow::Result<()> {
    let (env, id, h) = setup("RVF", 14).await?;
    let usdc = env.usdc.id().clone();
    let m = Some(msg(id, Some(&h.key()), None));
    assert!(env.s3_real(&h, &usdc, 40 * USDC, m.clone(), 41).await.is_success());
    let pause = env.owner.call(env.intents.id(), "pa_pause_feature").args_json(json!({ "key": "intents" })).transact().await?;
    assert!(pause.is_success(), "{:?}", pause.failures());
    let blocked = env.s3_real(&h, &usdc, 40 * USDC, m, 42).await;
    assert!(blocked.is_failure(), "execute_intents is paused");
    assert_eq!(env.intents_balance(&h.hex).await, 460 * USDC, "nothing moved while paused");
    Ok(())
}
