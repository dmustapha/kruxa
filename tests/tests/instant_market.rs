//! The launcher against the REAL market wasm at ABI 1.1.0 (second handoff sender, instant mode, seed caps, sub-cap, self-buy).
//! Build the market first: `MARKET_DIR=<checkout of ws/market2> ./scripts/instant-build.sh`.
mod instant_common;
use instant_common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const MS: u64 = 1_000_000;

async fn pool(ix: &Ix, id: &str) -> Value {
    ix.market.view("get_pool").args_json(lid(id)).await.unwrap().json().unwrap()
}

async fn market_view(ix: &Ix, m: &str, a: Value) -> Value {
    ix.market.view(m).args_json(a).await.unwrap().json().unwrap()
}

async fn buy(ix: &Ix, who: &Account, id: &str, amount: u128, receiver: Option<&Account>) -> near_workspaces::result::ExecutionFinalResult {
    let msg = json!({ "v": 1, "op": "buy", "launch_id": id, "min_out": "1", "receiver": receiver.map(|r| r.id()) }).to_string();
    who.call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.market.id(), "amount": amount.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await
        .unwrap()
}

async fn trader(ix: &Ix, name: &str, symbol: &str, usdc: u128) -> anyhow::Result<Account> {
    let t = ix.user(name, usdc).await?;
    ix.register_on_token(&ix.token_id(symbol), t.id()).await?;
    Ok(t)
}

#[tokio::test]
async fn the_whole_flow_opens_an_instant_pool_at_the_real_market_and_trades() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, params("REAL")).await?;
    assert_eq!(ix.status(&id).await, "Open");
    let p = pool(&ix, &id).await;
    assert_eq!((p["mode"].clone(), p["state"].clone(), p["creator"].clone()), (json!("instant"), json!("Open"), json!(ix.creator.id())));
    assert_eq!((n(&p["q"]), n(&p["t"])), (250 * USDC, N_TOTAL / 20 * 19));
    assert_eq!(p["payout_recipient"], json!(ix.creator.id()));
    assert_eq!(p["token"], json!(ix.token_id("REAL")));
    assert_eq!(market_view(&ix, "get_config", json!({})).await["launcher"], json!(ix.launcher.id()));
    assert_eq!(market_view(&ix, "get_invariants", json!({})).await["parked_count"], 0, "sequential legs: nothing is ever parked");
    // the opening fee is high at open and a buyer gets tokens
    let q = market_view(&ix, "quote_buy", json!({ "launch_id": id, "amount_in": "20000000" })).await;
    assert_eq!(q["ok"], true, "{q}");
    assert!(n(&q["fee_bps"]) >= 400, "opening decay applies: {q}");
    let bob = trader(&ix, "bob", "REAL", 100 * USDC).await?;
    buy(&ix, &bob, &id, 20 * USDC, None).await.into_result()?;
    assert!(ix.bal(&ix.token_id("REAL"), bob.id()).await > 0);
    let st = market_view(&ix, "creator_status", lid(&id)).await;
    assert!(n(&st["accrued"]) > 0, "the creator fee share accrues: {st}");
    assert_eq!(st["recipient"], json!(ix.creator.id()));
    assert_eq!(market_view(&ix, "get_invariants", json!({})).await["usdc_custody_identity"], true);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn declared_wallets_cannot_buy_their_own_instant_pool() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let rec = ix.user("recipient", 100 * USDC).await?;
    let id = {
        let id = ix.create_ready(&ix.creator, params("SELF"), Some(rec.id())).await?;
        ix.mint_usdc(ix.creator.id(), 350 * USDC).await?;
        ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
        ix.open(&ix.creator, &id).await?.into_result()?;
        id
    };
    let tok = ix.token_id("SELF");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    ix.register_on_token(&tok, rec.id()).await?;
    let bob = trader(&ix, "bob", "SELF", 100 * USDC).await?;
    for (who, receiver) in [(&ix.creator, None), (&rec, None), (&bob, Some(&ix.creator)), (&bob, Some(&rec))] {
        let before = ix.usdc_bal(who.id()).await;
        let r = buy(&ix, who, &id, 20 * USDC, receiver).await;
        assert!(has_code(&r, "R_SELF_BUY"), "{:?}", r.logs());
        assert_eq!(ix.usdc_bal(who.id()).await, before, "refused in full");
    }
    buy(&ix, &bob, &id, 20 * USDC, None).await.into_result()?;
    assert!(ix.bal(&tok, bob.id()).await > 0, "an undeclared buyer trades (the honest limit: a second wallet is not stopped)");
    Ok(())
}

#[tokio::test]
async fn a_market_without_the_launcher_refuses_the_leg_and_a_retry_works_once_it_is_named() -> anyhow::Result<()> {
    let ix = Ix::real("demo", None, false).await?;
    let id = ix.create_ready(&ix.creator, params("NOLA"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let r = ix.open(&ix.creator, &id).await?;
    r.clone().into_result()?;
    assert!(has_code(&r, "R_NOT_AUTHORIZED"), "{:?}", r.logs());
    let i = ix.inst(&id).await;
    assert_eq!((i["status"].clone(), n(&i["seed_due"]), n(&i["seed_sent"])), (json!("Handoff"), 250 * USDC, 0));
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 250 * USDC);
    assert!(pool(&ix, &id).await.is_null());
    ix.owner.call(ix.market.id(), "set_launcher").args_json(json!({ "account": ix.launcher.id() })).transact().await?.into_result()?;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.status(&id).await, "Open");
    assert_eq!(pool(&ix, &id).await["mode"], "instant");
    // the launcher is now locked at the market
    let again = ix.owner.call(ix.market.id(), "set_launcher").args_json(json!({ "account": ix.treasury.id() })).transact().await?;
    assert!(has_code(&again, "R_LAUNCHER_LOCKED"), "{:?}", again.failures());
    Ok(())
}

#[tokio::test]
async fn the_market_per_pool_cap_refuses_the_seed_and_the_creator_can_abort() -> anyhow::Result<()> {
    let ix = Ix::real("demo", Some((200 * USDC, 15_000 * USDC, 5_000 * USDC)), true).await?;
    let id = ix.create_ready(&ix.creator, params("CAPD"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let r = ix.open(&ix.creator, &id).await?;
    assert!(has_code(&r, "R_MARKET_CAP"), "{:?}", r.logs());
    assert_eq!(n(&ix.inst(&id).await["seed_due"]), 250 * USDC);
    assert!(pool(&ix, &id).await.is_null());
    let seeded = n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded + 31_000 * MS).await;
    ix.call(&ix.creator, "abort_instant", lid(&id)).await?.into_result()?;
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, 250 * USDC, "nothing was consumed, so the whole seed is back");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn the_instant_sub_cap_stops_instant_launches_from_crowding_out_trial_pools() -> anyhow::Result<()> {
    let ix = Ix::real("demo", Some((5_000 * USDC, 15_000 * USDC, 300 * USDC)), true).await?;
    let a = ix.launch_to_open(&ix.creator, params("SUBA")).await?;
    let b_creator = ix.user("creatorb", 250 * USDC).await?;
    let b = ix.create_ready(&b_creator, params("SUBB"), None).await?;
    ix.seed(&b_creator, &b, 250 * USDC).await?.into_result()?;
    let r = ix.open(&b_creator, &b).await?;
    assert!(has_code(&r, "R_MARKET_CAP"), "the second seed would pass the $300 instant aggregate: {:?}", r.logs());
    assert_eq!(ix.status(&b).await, "Handoff");
    // M-01: the sub-cap limits seeds, not trading, so buying past it does not block anyone
    let bob = trader(&ix, "bob", "SUBA", 1_000 * USDC).await?;
    buy(&ix, &bob, &a, 100 * USDC, None).await.into_result()?;
    buy(&ix, &bob, &a, 40 * USDC, None).await.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_paused_market_never_parks_a_token_leg_and_the_retry_completes() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    ix.guardian.call(ix.market.id(), "pause").transact().await?.into_result()?;
    let id = ix.create_ready(&ix.creator, params("PMKT"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let r = ix.open(&ix.creator, &id).await?;
    assert!(has_code(&r, "R_PAUSED"));
    assert_eq!(market_view(&ix, "get_invariants", json!({})).await["parked_count"], 0);
    assert_eq!(ix.bal(&ix.token_id("PMKT"), ix.launcher.id()).await, N_TOTAL, "no token left the launcher");
    ix.owner.call(ix.market.id(), "unpause").transact().await?.into_result()?;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.status(&id).await, "Open");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn the_mainnet_fee_never_reaches_the_pool_and_the_pool_seed_is_the_net_amount() -> anyhow::Result<()> {
    let ix = Ix::new("mainnet", false).await?;
    ix.call(&ix.owner, "open_beta", json!({})).await?.into_result()?;
    let id = ix.launch_to_open(&ix.creator, params("NETP")).await?;
    let p = pool(&ix, &id).await;
    assert_eq!(n(&p["q"]), 240 * USDC);
    assert_eq!(n(&ix.view("get_config", json!({})).await["platform_unpaid"]), 10 * USDC);
    ix.call(&ix.treasury, "withdraw_platform", json!({})).await?.into_result()?;
    assert_eq!(ix.usdc_bal(ix.treasury.id()).await, 10 * USDC);
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 0);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}
