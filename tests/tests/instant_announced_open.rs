//! Announced open (CO-7 2.7) against the REAL market wasm: `trade_delay_secs` at create, `trade_from_ns` on the pool, buys refused
//! `R_NOT_YET_TRADING` before it, the opening-fee clock starting at it, delay 0 as before, bad input refused `R_TRADE_DELAY`.
//! Build first: `scripts/instant-build.sh`.
mod instant_common;
use instant_common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const SEC: u64 = 1_000_000_000;

async fn pool(ix: &Ix, id: &str) -> Value {
    ix.market.view("get_pool").args_json(lid(id)).await.unwrap().json().unwrap()
}

async fn market_view(ix: &Ix, m: &str, a: Value) -> Value {
    ix.market.view(m).args_json(a).await.unwrap().json().unwrap()
}

async fn buy(ix: &Ix, who: &Account, id: &str, amount: u128) -> ExecutionFinalResult {
    let msg = json!({ "v": 1, "op": "buy", "launch_id": id, "min_out": "1" }).to_string();
    who.call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.market.id(), "amount": amount.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await
        .unwrap()
}

async fn trader(ix: &Ix, symbol: &str) -> anyhow::Result<Account> {
    let t = ix.user("bob", 200 * USDC).await?;
    ix.register_on_token(&ix.token_id(symbol), t.id()).await?;
    Ok(t)
}

/// Params that leave `trade_delay_secs` out, the way a caller written before the field existed does.
fn params_without_delay(symbol: &str) -> Value {
    json!({ "name": format!("{symbol} Coin"), "symbol": symbol })
}

fn trade_from(v: &Value) -> u64 {
    n(&v["trade_from_ns"]) as u64
}

#[tokio::test]
async fn an_omitted_delay_is_ten_minutes_and_every_surface_agrees_on_trade_from() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let created = ix.create_ready(&ix.creator, params_without_delay("ANNA"), None).await?;
    assert_eq!(ix.inst(&created).await["trade_delay_secs"], 600, "the default of CO-7 2.7");
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &created, 250 * USDC).await?.into_result()?;
    let sent = ix.now().await;
    let r = ix.open(&ix.creator, &created).await?;
    r.clone().into_result()?;
    assert_eq!(ix.status(&created).await, "Open");
    let (from_market, from_launcher) = (trade_from(&pool(&ix, &created).await), trade_from(&ix.inst(&created).await));
    assert_eq!(from_market, from_launcher, "market pool and launcher record name the same instant");
    let opened = events(&r, "instant_opened");
    assert_eq!(trade_from(&opened[0]), from_market, "instant_opened names it too");
    let pool_opened = events(&r, "pool_opened");
    assert_eq!(trade_from(&pool_opened[0]), from_market, "and so does the market's pool_opened");
    let after_send = from_market - sent;
    assert!((600 * SEC..650 * SEC).contains(&after_send), "600 s after the seed leg was sent, got {after_send} ns");
    Ok(())
}

#[tokio::test]
async fn a_buy_before_trade_from_is_refused_in_full_and_one_after_is_accepted_at_the_full_opening_fee() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, json!({ "name": "Delay Coin", "symbol": "DLAY", "trade_delay_secs": 600 })).await?;
    let bob = trader(&ix, "DLAY").await?;
    let tf = trade_from(&pool(&ix, &id).await);
    assert!(ix.now().await < tf);
    // the pool is visible and open, its price is readable, and the quote says why a buy would fail
    let p = pool(&ix, &id).await;
    assert_eq!((p["state"].clone(), n(&p["q"])), (json!("Open"), 250 * USDC));
    let q = market_view(&ix, "quote_buy", json!({ "launch_id": id, "amount_in": "20000000" })).await;
    assert_eq!((q["ok"].clone(), q["code"].clone()), (json!(false), json!("R_NOT_YET_TRADING")), "{q}");
    // a buy now is refused with the code and the money comes back, nothing moves
    let before = ix.usdc_bal(bob.id()).await;
    let r = buy(&ix, &bob, &id, 20 * USDC).await;
    assert!(has_code(&r, "R_NOT_YET_TRADING"), "{:?}", r.logs());
    assert_eq!(ix.usdc_bal(bob.id()).await, before, "refused in full");
    assert_eq!(n(&pool(&ix, &id).await["q"]), 250 * USDC);
    assert_eq!(ix.bal(&ix.token_id("DLAY"), bob.id()).await, 0);
    // self-buy block still ranks after the clock for a declared wallet; an undeclared buyer waits like everyone
    ix.wait_until(tf).await;
    let r = buy(&ix, &bob, &id, 20 * USDC).await;
    r.clone().into_result()?;
    assert!(!has_code(&r, "R_NOT_YET_TRADING"), "{:?}", r.logs());
    assert!(ix.bal(&ix.token_id("DLAY"), bob.id()).await > 0, "the buy after trade_from is accepted");
    let fee_bps = n(&Value::String(events(&r, "swap")[0]["fee_bps"].as_str().unwrap().to_string()));
    assert!(fee_bps >= 495, "the opening fee decays from trade_from, not from the pool opening ten minutes earlier: {fee_bps} bps");
    let inv = market_view(&ix, "get_invariants", json!({})).await;
    assert_eq!(inv["usdc_custody_identity"], true, "{inv}");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn the_fee_quote_follows_the_clock_from_trade_from() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, json!({ "name": "Clock Coin", "symbol": "CLCK", "trade_delay_secs": 300 })).await?;
    let tf = trade_from(&pool(&ix, &id).await);
    let at = |ns: u64| json!({ "launch_id": id, "amount_in": "20000000", "now_ns": ns.to_string() });
    let first = market_view(&ix, "quote_buy", at(tf)).await;
    let ten_min = market_view(&ix, "quote_buy", at(tf + 600 * SEC)).await;
    let early = market_view(&ix, "quote_buy", at(tf - 1)).await;
    assert_eq!(n(&first["fee_bps"]), 500, "{first}");
    let mid = n(&ten_min["fee_bps"]);
    assert!((430..=436).contains(&mid), "ten minutes in: 500 falling to 100 over 60 minutes is about 433 bps: {ten_min}");
    assert_eq!(early["code"], "R_NOT_YET_TRADING");
    Ok(())
}

#[tokio::test]
async fn delay_zero_trades_at_once_as_before() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, params("ZERO")).await?;
    assert_eq!(ix.inst(&id).await["trade_delay_secs"], 0);
    assert_eq!(trade_from(&ix.inst(&id).await), 0);
    assert_eq!(trade_from(&pool(&ix, &id).await), 0);
    let bob = trader(&ix, "ZERO").await?;
    let r = buy(&ix, &bob, &id, 20 * USDC).await;
    r.clone().into_result()?;
    assert!(ix.bal(&ix.token_id("ZERO"), bob.id()).await > 0);
    let q = market_view(&ix, "quote_buy", json!({ "launch_id": id, "amount_in": "20000000" })).await;
    assert_eq!(q["ok"], true, "{q}");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn an_invalid_delay_is_refused_with_its_rule_code_and_the_bounds_are_accepted() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    for (i, bad) in [3_601u64, 100_000, u32::MAX as u64].into_iter().enumerate() {
        let p = json!({ "name": "Bad Coin", "symbol": format!("BAD{i}"), "trade_delay_secs": bad });
        let r = ix.create_raw(&ix.creator, p.clone(), None).await?;
        assert!(has_code(&r, "R_TRADE_DELAY"), "{bad}: {:?}", r.failures());
        let v = ix.view("preview_instant", json!({ "params": p })).await;
        assert_eq!((v["ok"].clone(), v["violations"][0]["code"].clone()), (json!(false), json!("R_TRADE_DELAY")), "{v}");
    }
    for (i, bad) in [json!(-1), json!(1.5), json!("600")].into_iter().enumerate() {
        let p = json!({ "name": "Bad Coin", "symbol": format!("BAT{i}"), "trade_delay_secs": bad });
        assert!(!ix.create_raw(&ix.creator, p, None).await?.is_success(), "a non-integer delay does not parse");
    }
    assert_eq!(ix.view("get_config", json!({})).await["next_launch_id"], (ID0).to_string(), "refused creates consumed no id");
    for (i, ok) in [0u64, 1, 3_600].into_iter().enumerate() {
        let who = ix.user(&format!("c{i}"), 0).await?;
        let id = ix.create_ready(&who, json!({ "name": "Edge Coin", "symbol": format!("EDG{i}"), "trade_delay_secs": ok }), None).await?;
        assert_eq!(ix.inst(&id).await["trade_delay_secs"], ok);
    }
    Ok(())
}

#[tokio::test]
async fn instant_created_names_the_delay() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.predeploy_token("EVNT", N_TOTAL).await?;
    let r = ix.create_raw(&ix.creator, json!({ "name": "Event Coin", "symbol": "EVNT", "trade_delay_secs": 90 }), None).await?;
    r.clone().into_result()?;
    assert_eq!(events(&r, "instant_created")[0]["trade_delay_secs"], 90);
    Ok(())
}
