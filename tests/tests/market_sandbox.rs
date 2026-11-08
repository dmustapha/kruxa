//! M-2 sandbox suite: handoff, swaps, claims, pause, caps, owed payouts. Run: scripts/market-build.sh first.
mod market_common;
use market_common::*;
use serde_json::json;

const ID: u64 = 1;

#[tokio::test]
async fn handoff_opens_pool_seed_first() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    mk.mint(&mk.token, mk.core.id(), SEED_T).await?;
    let r = mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(ID, mk.token.id())).await?;
    assert_eq!(mk.view("get_pool", json!({ "launch_id": "1" })).await["state"], "AwaitToken", "{:?}", r.logs());
    let r = mk.send(&mk.core, &mk.token, SEED_T, Mk::leg_msg(ID)).await?;
    let opened = events(&r, "pool_opened");
    assert_eq!(opened.len(), 1);
    for k in ["fee_bps", "creator_bps", "mint_authority", "freeze_authority", "q", "t"] {
        assert!(opened[0].get(k).is_some(), "pool_opened lacks {k}");
    }
    let p = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    assert_eq!((p["state"].as_str(), n(&p["q"]), n(&p["t"])), (Some("Open"), SEED_Q, SEED_T));
    assert_eq!(p["payout_recipient"], mk.creator.id().as_str());
    assert_eq!(mk.bal(&mk.usdc, mk.core.id()).await, 0, "core keeps nothing: both legs consumed");
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn handoff_opens_pool_token_first() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    mk.mint(&mk.token, mk.core.id(), SEED_T).await?;
    mk.send(&mk.core, &mk.token, SEED_T, Mk::leg_msg(ID)).await?.into_result()?;
    assert!(mk.view("get_pool", json!({ "launch_id": "1" })).await.is_null());
    let r = mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(ID, mk.token.id())).await?;
    assert_eq!(events(&r, "pool_opened").len(), 1);
    assert_eq!(mk.view("get_pool", json!({ "launch_id": "1" })).await["state"], "Open");
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn bad_terms_refuse_the_seed_and_return_it() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    let mut m: serde_json::Value = serde_json::from_str(&mk.seed_msg(ID, mk.token.id()))?;
    m["terms"]["creator_bps"] = json!(6001);
    let r = mk.send(&mk.core, &mk.usdc, SEED_Q, m.to_string()).await?;
    assert!(has_code(&r, "R_FEE_TERMS"));
    assert_eq!(mk.bal(&mk.usdc, mk.core.id()).await, SEED_Q, "refunded");
    assert!(mk.view("get_pool", json!({ "launch_id": "1" })).await.is_null());
    Ok(())
}

#[tokio::test]
async fn buy_and_sell_slices_sum_and_custody_holds() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 500 * USDC).await?;
    let q = mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (100 * USDC).to_string() })).await;
    assert_eq!(q["ok"], true);
    let min_out = n(&q["out"]);
    let r = mk.buy(&alice, ID, 100 * USDC, min_out.saturating_sub(min_out / 100)).await?;
    let ev = events(&r, "swap");
    assert_eq!(ev.len(), 1);
    let e = &ev[0];
    let sum: u128 = ["creator", "platform", "holders", "lp", "referral"].iter().map(|k| n(&e[*k])).sum();
    assert_eq!(sum, n(&e["fee_total"]));
    assert!((101..=500).contains(&n(&e["fee_bps"])), "inside the opening window the rate is above base");
    assert_eq!(e["creator_bps"].as_u64(), Some(5000));
    assert_eq!(n(&e["holders"]) + n(&e["referral"]), 0, "M-A redirects holders and referral to LP");
    assert_eq!(n(&e["red_holders"]) + n(&e["red_referral"]) + n(&e["surcharge"]) <= n(&e["lp"]), true);
    assert_eq!(mk.bal(&mk.token, alice.id()).await, n(&e["amount_out"]));
    assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 400 * USDC);
    mk.assert_solvent(&[ID]).await;
    // sell everything back: must lose money to fees
    let held = mk.bal(&mk.token, alice.id()).await;
    let r = mk.sell(&alice, ID, held, 1).await?;
    let ev = events(&r, "swap");
    assert_eq!(ev[0]["side"], "sell");
    assert!(mk.bal(&mk.usdc, alice.id()).await < 500 * USDC);
    assert_eq!(mk.bal(&mk.token, alice.id()).await, 0);
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn opening_fee_is_higher_than_base_and_decays() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let opened: u64 = mk.view("get_pool", json!({ "launch_id": "1" })).await["opened_ns"].as_str().unwrap().parse()?;
    let at = |ns: u64| json!({ "launch_id": "1", "amount_in": (100 * USDC).to_string(), "now_ns": (opened + ns).to_string() });
    let early = mk.view("quote_buy", at(0)).await;
    let late = mk.view("quote_buy", at(61 * 60 * 1_000_000_000)).await;
    assert_eq!((n(&early["fee_total"]), n(&late["fee_total"])), (5 * USDC, USDC));
    assert_eq!(early["creator"], late["creator"], "surcharge never feeds the creator");
    Ok(())
}

#[tokio::test]
async fn creator_claim_pays_recipient_only() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 900 * USDC, 1).await?.into_result()?;
    let status = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    let claimable = n(&status["claimable"]);
    assert!(claimable > 0 && claimable <= n(&status["accrued"]) / 2 + 1, "{status}");
    let bad = alice.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    assert!(has_code(&bad, "R_NOT_AUTHORIZED"));
    let before = mk.bal(&mk.usdc, mk.creator.id()).await;
    let ok = mk.creator.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(events(&ok, "creator_claimed").len(), 1);
    assert_eq!(mk.bal(&mk.usdc, mk.creator.id()).await - before, claimable);
    let again = mk.creator.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    assert!(has_code(&again, "R_NOTHING_TO_CLAIM"));
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn platform_withdraw_pays_treasury() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 900 * USDC, 1).await?.into_result()?;
    let rep = mk.view("ledger_report", json!({ "launch_id": "1" })).await;
    let due = n(&rep["acc_platform"]);
    assert!(due > USDC);
    let nope = alice.call(mk.market.id(), "withdraw_platform").gas(GAS).transact().await?;
    assert!(has_code(&nope, "R_NOT_AUTHORIZED"));
    let r = mk.treasury.call(mk.market.id(), "withdraw_platform").gas(GAS).transact().await?;
    assert!(r.is_success());
    assert_eq!(mk.bal(&mk.usdc, mk.treasury.id()).await, due);
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn pause_blocks_buys_never_exits() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 900 * USDC, 1).await?.into_result()?;
    let stranger = mk.user("eve", 0).await?;
    let no = stranger.call(mk.market.id(), "pause").transact().await?;
    assert!(has_code(&no, "R_NOT_AUTHORIZED"));
    mk.guardian.call(mk.market.id(), "pause").transact().await?.into_result()?;
    let r = mk.buy(&alice, ID, 10 * USDC, 1).await?;
    assert!(has_code(&r, "R_PAUSED"));
    assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 1_100 * USDC, "buy refunded in full");
    let held = mk.bal(&mk.token, alice.id()).await;
    let s = mk.sell(&alice, ID, held / 2, 1).await?;
    assert_eq!(events(&s, "swap").len(), 1, "sell works while paused");
    let c = mk.creator.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    assert!(c.is_success(), "creator claim works while paused");
    let g = mk.guardian.call(mk.market.id(), "unpause").transact().await?;
    assert!(has_code(&g, "R_NOT_AUTHORIZED"), "only the owner unpauses");
    mk.owner.call(mk.market.id(), "unpause").transact().await?.into_result()?;
    assert_eq!(mk.buy(&alice, ID, 10 * USDC, 1).await?.logs().iter().any(|l| l.contains("R_PAUSED")), false);
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn reserve_cap_refuses_and_returns_funds() -> anyhow::Result<()> {
    let mk = Mk::new(Some((1_200 * USDC, 5_000 * USDC))).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 1_000 * USDC).await?;
    let r = mk.buy(&alice, ID, 300 * USDC, 1).await?;
    assert!(has_code(&r, "R_MARKET_CAP"));
    assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 1_000 * USDC);
    assert_eq!(events(&mk.buy(&alice, ID, 150 * USDC, 1).await?, "swap").len(), 1, "under the cap still trades");
    Ok(())
}

#[tokio::test]
async fn failed_payout_becomes_owed_and_is_claimable() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 500 * USDC).await?;
    // receiver is not registered on the launch token: the outbound ft_transfer fails
    let ghost = format!("ghost.{}", mk.worker.root_account()?.id());
    let msg = json!({ "v": 1, "op": "buy", "launch_id": "1", "min_out": "1", "receiver": ghost }).to_string();
    let r = mk.send(&alice, &mk.usdc, 100 * USDC, msg).await?;
    let owed = events(&r, "owed_credited");
    assert_eq!(owed.len(), 1, "{:?}", r.logs());
    mk.assert_solvent(&[ID]).await;
    let ghost_acct = mk
        .worker
        .root_account()?
        .create_subaccount("ghost")
        .initial_balance(near_workspaces::types::NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    mk.mint(&mk.token, ghost_acct.id(), 0).await?;
    let c = ghost_acct.call(mk.market.id(), "claim_owed").args_json(json!({ "token_id": mk.token.id() })).gas(GAS).transact().await?;
    assert!(c.is_success(), "{:?}", c.failures());
    assert_eq!(mk.bal(&mk.token, ghost_acct.id()).await, n(&owed[0]["amount"]));
    mk.assert_solvent(&[ID]).await;
    Ok(())
}
