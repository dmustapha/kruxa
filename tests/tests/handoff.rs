//! D-3 (W1-DC-16, GR-15): the `open_market` handoff against the stub market (docs/interfaces/HANDOFF.md).
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

/// A PASSED launch with everything the handoff needs: positions settled, residue swept, launch fee paid. Returns (env, id, stub market).
async fn passed_launch(symbol: &str) -> anyhow::Result<(Env, u64, near_workspaces::Contract)> {
    let env = Env::new().await?;
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    let id = env.create_launch(&p).await?;
    for i in 0..12 {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    let market = env.deploy_stub_market().await?;
    env.register_on_token(symbol, market.id()).await?;
    Ok((env, id, market))
}

async fn legs(market: &near_workspaces::Contract) -> Vec<Value> {
    market.view("get_legs").await.unwrap().json().unwrap()
}

#[tokio::test]
async fn open_market_moves_lp_seed_and_recredits_on_failure() -> anyhow::Result<()> {
    let (env, id, market) = passed_launch("HAND").await?;
    let seed = num(&env.view("get_ledger", lid(id)).await, "lp_seed_due");
    let n_lp = num(&env.view("get_charter", lid(id)).await["derived"], "n_lp");
    assert!(seed > 0 && n_lp > 0);
    // 1) the market refuses the seed leg and consumes the token leg: the seed is re-credited, the tokens stay sent.
    market.call("set_mode").args_json(json!({ "mode": "refuse_seed" })).transact().await?.into_result()?;
    let core_usdc = env.usdc_balance(env.core.id()).await;
    let r = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert_eq!(r.json::<u8>()?, 2, "both legs sent");
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "lp_seed_due"), num(&led, "lp_seed_inflight"), num(&led, "lp_seed_sent")), (seed, 0, 0), "seed re-credited");
    assert_eq!(env.usdc_balance(env.core.id()).await, core_usdc, "no USDC left core");
    let link = env.view("get_market_link", lid(id)).await;
    assert_eq!((num(&link, "lp_tokens_sent"), link["opened"].as_bool()), (n_lp, Some(false)));
    // 2) the market accepts: a retry sends only the missing seed leg.
    market.call("set_mode").args_json(json!({ "mode": "accept" })).transact().await?.into_result()?;
    let r = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert_eq!(r.json::<u8>()?, 1, "only the seed leg is retried");
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "lp_seed_due"), num(&led, "lp_seed_inflight"), num(&led, "lp_seed_sent")), (0, 0, seed));
    assert_eq!(env.usdc_balance(market.id()).await, seed, "the market holds the seed");
    assert_eq!(env.token_balance("HAND", market.id()).await, n_lp, "the market holds the LP bucket");
    assert_eq!(env.view("get_market_link", lid(id)).await["opened"], true);
    assert_eq!(env.view("get_invariants", lid(id)).await["all_ok"], true);
    let seen = legs(&market).await;
    let seed_leg = seen.iter().rev().find(|l| l["msg"]["op"] == "seed_quote" && l["refused"] == false).expect("accepted seed leg");
    let m = &seed_leg["msg"];
    let charter = env.view("get_charter", lid(id)).await;
    assert_eq!(seed_leg["token_contract"], json!(env.usdc.id()));
    assert_eq!(seed_leg["sender"], json!(env.core.id()));
    assert_eq!(seed_leg["amount"], seed.to_string());
    assert_eq!((m["v"].clone(), m["launch_id"].clone()), (json!(1), json!(id.to_string())));
    assert_eq!(m["token"], json!(env.token_id("HAND")));
    assert_eq!((m["mint_authority"].clone(), m["freeze_authority"].clone()), (Value::Null, Value::Null), "authorities are revoked");
    assert_eq!(m["payout_recipient"], charter["payout_recipient"]);
    assert_eq!(m["total_supply"], charter["derived"]["n_total"]);
    assert_eq!(m["charter_hash"], env.state(id).await["charter_hash"]);
    assert_eq!(m["terms"], charter["params"]["fees"], "terms are the Charter snapshot");
    let token_leg = seen.iter().find(|l| l["msg"]["op"] == "open_pool_token").expect("token leg");
    assert_eq!((token_leg["token_contract"].clone(), token_leg["amount"].clone()), (json!(env.token_id("HAND")), json!(n_lp.to_string())));
    // 3) done: nothing left to send.
    let again = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert!(has_code(&again, "R_NOTHING"), "{:?}", again.failures());
    Ok(())
}

#[tokio::test]
async fn a_panicking_market_gets_everything_back() -> anyhow::Result<()> {
    let (env, id, market) = passed_launch("HANB").await?;
    let seed = num(&env.view("get_ledger", lid(id)).await, "lp_seed_due");
    let n_lp = num(&env.view("get_charter", lid(id)).await["derived"], "n_lp");
    let (usdc_before, tok_before) = (env.usdc_balance(env.core.id()).await, env.token_balance("HANB", env.core.id()).await);
    market.call("set_mode").args_json(json!({ "mode": "panic" })).transact().await?.into_result()?;
    env.call(&env.creator, "open_market", lid(id), ZERO).await.into_result()?;
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "lp_seed_due"), num(&led, "lp_seed_inflight"), num(&led, "lp_seed_sent")), (seed, 0, 0));
    let link = env.view("get_market_link", lid(id)).await;
    assert_eq!((num(&link, "lp_tokens_inflight"), num(&link, "lp_tokens_sent")), (0, 0));
    assert_eq!(env.usdc_balance(env.core.id()).await, usdc_before);
    assert_eq!(env.token_balance("HANB", env.core.id()).await, tok_before, "tokens are back at core ({n_lp} were offered)");
    assert_eq!(env.view("get_invariants", lid(id)).await["all_ok"], true);
    Ok(())
}

#[tokio::test]
async fn open_market_is_refused_until_the_buckets_are_ready() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = TrialParams::example("HANC");
    p.commit_secs = 600;
    p.tail_secs = 60;
    let id = env.create_launch(&p).await?;
    for i in 0..12 {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
    }
    let market = env.deploy_stub_market().await?;
    env.register_on_token("HANC", market.id()).await?;
    let early = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert!(has_code(&early, "R_NOT_CLEAR"), "an Open launch has no seed: {:?}", early.failures());
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let no_fee = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert!(has_code(&no_fee, "R_NOT_CLEAR"), "the launch fee must be paid first: {:?}", no_fee.failures());
    assert!(legs(&market).await.is_empty(), "nothing reached the market");
    Ok(())
}

#[tokio::test]
async fn set_market_is_owner_only_required_and_locked_after_use() -> anyhow::Result<()> {
    let (env, id, market) = passed_launch("HAND2").await?;
    let by_creator = env.call(&env.creator, "set_market", json!({ "account": market.id() }), ZERO).await;
    assert!(has_code(&by_creator, "R_NOT_AUTHORIZED"));
    env.call(&env.creator, "open_market", lid(id), ZERO).await.into_result()?;
    let late = env.call(&env.owner, "set_market", json!({ "account": env.treasury.id() }), ZERO).await;
    assert!(has_code(&late, "R_NOTHING"), "the destination is locked once funds moved: {:?}", late.failures());
    assert_eq!(env.view("get_config", json!({})).await["market"], json!(market.id()));
    Ok(())
}

#[tokio::test]
async fn open_market_without_a_market_account_is_refused() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let r = env.call(&env.creator, "open_market", lid(1), ZERO).await;
    assert!(has_code(&r, "R_NOTHING") || has_code(&r, "R_NO_LAUNCH"), "{:?}", r.failures());
    Ok(())
}

#[tokio::test]
async fn pause_blocks_open_market() -> anyhow::Result<()> {
    let (env, id, _market) = passed_launch("HAND3").await?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    let r = env.call(&env.creator, "open_market", lid(id), ZERO).await;
    assert!(has_code(&r, "R_PAUSED"), "{:?}", r.failures());
    Ok(())
}
