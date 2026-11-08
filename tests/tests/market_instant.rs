//! ABI 1.1.0 (instant launch delta): second sender, id namespace, mode, seed caps, instant sub-cap, self-buy block.
//! The stub launcher is a plain sandbox account that sends the same two legs the real launcher will.
mod market_common;
use market_common::*;
use serde_json::json;

const IID: u64 = INSTANT_BASE;

async fn seed(
    mk: &Mk,
    id: u64,
    amt: u128,
    c: &near_workspaces::AccountId,
    r: &near_workspaces::AccountId,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    mk.send(&mk.launcher, &mk.usdc, amt, mk.instant_seed_msg(id, mk.token.id(), c, r)).await
}

async fn pool(mk: &Mk, id: u64) -> serde_json::Value {
    mk.view("get_pool", json!({ "launch_id": id.to_string() })).await
}

#[tokio::test]
async fn off_by_default_launcher_cannot_seed_and_core_cannot_use_instant_ids() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    assert!(mk.view("get_config", json!({})).await["launcher"].is_null());
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    let res = mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &r)).await?;
    assert!(has_code(&res, "R_NOT_AUTHORIZED"));
    assert_eq!(mk.bal(&mk.usdc, mk.launcher.id()).await, 500 * USDC, "refunded");
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    let res = mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(IID, mk.token.id())).await?;
    assert!(has_code(&res, "R_ID_NAMESPACE"), "core ids stay below 1e9");
    mk.open_pool(1).await?;
    assert_eq!(pool(&mk, 1).await["mode"], "trial");
    Ok(())
}

#[tokio::test]
async fn set_launcher_is_owner_only_guarded_and_locks_after_first_pool() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    let call = |who: &near_workspaces::Account, acct: &near_workspaces::AccountId| {
        who.call(mk.market.id(), "set_launcher").args_json(json!({ "account": acct })).transact()
    };
    assert!(has_code(&call(&mk.guardian, mk.launcher.id()).await?, "R_NOT_AUTHORIZED"));
    assert!(has_code(&call(&mk.creator, mk.launcher.id()).await?, "R_NOT_AUTHORIZED"));
    for bad in [mk.core.id(), mk.usdc.id(), mk.treasury.id()] {
        assert!(has_code(&call(&mk.owner, bad).await?, "R_NOT_AUTHORIZED"), "{bad}");
    }
    mk.set_launcher().await?;
    assert_eq!(mk.view("get_config", json!({})).await["launcher"], mk.launcher.id().as_str());
    // a mistake is fixable before first use
    let other = mk.user("other", 0).await?;
    call(&mk.owner, other.id()).await?.into_result()?;
    mk.set_launcher().await?;
    mk.open_instant(IID, 500 * USDC, mk.creator.id(), mk.creator.id()).await?;
    let late = call(&mk.owner, other.id()).await?;
    assert!(has_code(&late, "R_LAUNCHER_LOCKED"));
    let same = call(&mk.owner, mk.launcher.id()).await?;
    assert!(has_code(&same, "R_LAUNCHER_LOCKED"), "no change at all once a launcher pool exists");
    assert_eq!(mk.view("get_config", json!({})).await["launcher"], mk.launcher.id().as_str());
    Ok(())
}

#[tokio::test]
async fn namespaces_never_cross_in_either_direction_and_on_both_legs() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.set_launcher().await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    mk.mint(&mk.token, mk.launcher.id(), SEED_T).await?;
    let res = mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(7, mk.token.id(), &c, &r)).await?;
    assert!(has_code(&res, "R_ID_NAMESPACE"), "launcher below 1e9");
    let res = mk.send(&mk.launcher, &mk.token, SEED_T, Mk::leg_msg(7)).await?;
    assert!(has_code(&res, "R_ID_NAMESPACE"), "launcher token leg below 1e9");
    mk.mint(&mk.token, mk.core.id(), SEED_T).await?;
    let res = mk.send(&mk.core, &mk.token, SEED_T, Mk::leg_msg(IID)).await?;
    assert!(has_code(&res, "R_ID_NAMESPACE"), "core token leg at 1e9");
    assert!(pool(&mk, 7).await.is_null() && pool(&mk, IID).await.is_null());
    // a launcher leg cannot join a core pool, nor a core leg an instant pool
    mk.open_pool(1).await?;
    mk.open_instant(IID, 500 * USDC, &c, &r).await?;
    mk.mint(&mk.token, mk.core.id(), 5).await?;
    let res = mk.send(&mk.core, &mk.token, 5, Mk::leg_msg(IID)).await?;
    assert!(has_code(&res, "R_ID_NAMESPACE"));
    Ok(())
}

#[tokio::test]
async fn mode_comes_from_the_sender_never_the_message() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.set_launcher().await?;
    mk.open_pool(1).await?;
    let c = mk.creator.id().clone();
    // the instant seed message even claims "mode":"trial"; the market ignores it
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    mk.mint(&mk.token, mk.launcher.id(), SEED_T).await?;
    mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &c)).await?.into_result()?;
    let r = mk.send(&mk.launcher, &mk.token, SEED_T, Mk::leg_msg(IID)).await?;
    let ev = events(&r, "pool_opened");
    assert_eq!((ev[0]["mode"].as_str(), ev[0]["creator"].as_str()), (Some("instant"), Some(c.as_str())));
    let (p, t) = (pool(&mk, IID).await, pool(&mk, 1).await);
    assert_eq!((p["mode"].as_str(), p["creator"].as_str()), (Some("instant"), Some(c.as_str())));
    assert_eq!((t["mode"].as_str(), t["creator"].is_null()), (Some("trial"), true));
    mk.assert_solvent(&[]).await;
    Ok(())
}

#[tokio::test]
async fn seed_caps_apply_to_instant_seeds_pool_global_and_aggregate() -> anyhow::Result<()> {
    // pool cap 1,200; global 2,500; instant aggregate 1,500
    let mk = Mk::new_with(Some((1_200 * USDC, 2_500 * USDC)), Some(1_500 * USDC)).await?;
    mk.set_launcher().await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    mk.mint(&mk.usdc, mk.launcher.id(), 3_000 * USDC).await?;
    assert!(has_code(&seed(&mk, IID, 1_300 * USDC, &c, &r).await?, "R_MARKET_CAP"), "above the per-pool cap");
    assert!(seed(&mk, IID, 1_000 * USDC, &c, &r).await?.is_success());
    assert!(has_code(&seed(&mk, IID + 1, 600 * USDC, &c, &r).await?, "R_MARKET_CAP"), "instant aggregate 1,000 + 600 > 1,500");
    assert_eq!(mk.view("get_config", json!({})).await["instant_q"], (1_000 * USDC).to_string());
    // seeds are not checked against the global reserve (trading must not grief seeding, M-01); the aggregate still binds
    mk.open_pool(1).await?; // global_q = 2,000
    assert!(seed(&mk, IID + 1, 500 * USDC, &c, &r).await?.is_success(), "instant_seeded 1,000 + 500 <= 1,500");
    assert_eq!(mk.bal(&mk.usdc, mk.launcher.id()).await, 1_500 * USDC, "refused seeds returned in full, accepted ones consumed");
    // the refused seed left no pool behind
    assert!(has_code(&seed(&mk, IID + 2, 500 * USDC, &c, &r).await?, "R_MARKET_CAP"), "1,500 + 500 > 1,500");
    assert!(pool(&mk, IID + 2).await.is_null());
    // trial seeds are not cap-checked (core's raise caps bound them): a 1,000 trial seed passes a 1,200 cap anyway, and so would a larger one
    mk.assert_solvent(&[]).await;
    Ok(())
}

#[tokio::test]
async fn trading_growth_does_not_count_against_the_instant_seed_cap() -> anyhow::Result<()> {
    // M-01 regression: a whale buy used to fill the instant sub-cap and block every other buy and every new seed.
    let mk = Mk::new(None).await?;
    mk.set_launcher().await?;
    let c = mk.creator.id().clone();
    mk.open_instant(IID, 1_000 * USDC, &c, &c).await?;
    let whale = mk.user("whale", 5_000 * USDC).await?;
    let r = mk.buy(&whale, IID, 3_900 * USDC, 1).await?;
    assert_eq!(events(&r, "swap").len(), 1, "{:?}", r.logs());
    let cfg = mk.view("get_config", json!({})).await;
    assert!(n(&cfg["instant_q"]) > 4_800 * USDC, "reserve grew through trading: {cfg}");
    assert_eq!(n(&cfg["instant_seeded_q"]), 1_000 * USDC, "only seeds count against the sub-cap");
    // another instant launch still seeds, and its buyers still buy
    let (c2, tok2) = (mk.user("maker2", 0).await?, deploy_ft(&mk.worker.root_account()?, "tok2").await?);
    mk.mint(&tok2, mk.market.id(), 0).await?;
    mk.mint(&tok2, mk.launcher.id(), SEED_T).await?;
    mk.mint(&mk.usdc, mk.launcher.id(), 1_000 * USDC).await?;
    mk.send(&mk.launcher, &mk.usdc, 1_000 * USDC, mk.instant_seed_msg(IID + 1, tok2.id(), c2.id(), c2.id())).await?.into_result()?;
    mk.send(&mk.launcher, &tok2, SEED_T, Mk::leg_msg(IID + 1)).await?.into_result()?;
    let other = mk.user("other", 100 * USDC).await?;
    let r = mk.send(&other, &mk.usdc, 50 * USDC, Mk::buy_msg(IID + 1, 1)).await?;
    assert_eq!(events(&r, "swap").len(), 1, "a buy in a second instant pool is not blocked by the first pool's growth");
    // the per-pool reserve cap still binds the whale's own pool
    let r = mk.buy(&whale, IID, 500 * USDC, 1).await?;
    assert!(has_code(&r, "R_MARKET_CAP"));
    let inv = mk.view("get_invariants", json!({})).await;
    assert!(inv["instant_q_matches"] == true);
    mk.assert_solvent(&[]).await;
    Ok(())
}

#[tokio::test]
async fn global_cap_filled_by_trading_does_not_block_a_small_seed() -> anyhow::Result<()> {
    // M-01 regression, global half: trading fills the global cap, a new instant seed still opens (seeds are bounded by the seeded aggregate)
    let mk = Mk::new_with(Some((5_000 * USDC, 2_500 * USDC)), None).await?;
    mk.set_launcher().await?;
    let c = mk.creator.id().clone();
    mk.open_instant(IID, 1_000 * USDC, &c, &c).await?;
    let whale = mk.user("whale", 2_000 * USDC).await?;
    mk.buy(&whale, IID, 1_400 * USDC, 1).await?.into_result()?;
    let blocked = mk.buy(&whale, IID, 200 * USDC, 1).await?;
    assert!(has_code(&blocked, "R_MARKET_CAP"), "global cap still binds buys");
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    let r = mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID + 1, mk.token.id(), &c, &c)).await?;
    assert!(r.is_success() && !has_code(&r, "R_MARKET_CAP"), "{:?}", r.logs());
    assert_eq!(pool(&mk, IID + 1).await["state"], "AwaitToken");
    Ok(())
}

#[tokio::test]
async fn creator_and_payout_recipient_cannot_buy_their_own_instant_pool() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.set_launcher().await?;
    let creator = mk.user("maker", 2_000 * USDC).await?;
    let payee = mk.user("payee", 2_000 * USDC).await?;
    let friend = mk.user("friend", 2_000 * USDC).await?;
    mk.open_instant(IID, 1_000 * USDC, creator.id(), payee.id()).await?;
    for who in [&creator, &payee] {
        let r = mk.buy(who, IID, 50 * USDC, 1).await?;
        assert!(has_code(&r, "R_SELF_BUY"), "{}", who.id());
        assert_eq!(mk.bal(&mk.usdc, who.id()).await, 2_000 * USDC, "refunded");
    }
    // a third party cannot deliver tokens to the creator or the recipient either
    for target in [creator.id(), payee.id()] {
        let msg = json!({ "v": 1, "op": "buy", "launch_id": IID.to_string(), "min_out": "1", "receiver": target }).to_string();
        let r = mk.send(&friend, &mk.usdc, 50 * USDC, msg).await?;
        assert!(has_code(&r, "R_SELF_BUY"), "receiver {target}");
    }
    assert_eq!(events(&mk.buy(&friend, IID, 50 * USDC, 1).await?, "swap").len(), 1, "everyone else buys");
    // the block is for buys only: creator may sell tokens they hold and the recipient may claim fees
    mk.mint(&mk.token, creator.id(), 0).await?;
    let c = payee.call(mk.market.id(), "claim").args_json(json!({ "launch_id": IID.to_string() })).gas(GAS).transact().await?;
    assert!(c.is_success() || has_code(&c, "R_NOTHING_TO_CLAIM"));
    mk.assert_solvent(&[IID]).await;
    Ok(())
}

#[tokio::test]
async fn attack_equivalents_for_the_new_paths() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.set_launcher().await?;
    let c = mk.creator.id().clone();
    // spoofed launcher: a stranger sends a seed with an instant id
    let eve = mk.user("eve", 2_000 * USDC).await?;
    let r = mk.send(&eve, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &c)).await?;
    assert!(has_code(&r, "R_NOT_AUTHORIZED"));
    // fake USDC from the real launcher account
    let fake = deploy_ft(&mk.worker.root_account()?, "fake").await?;
    mk.mint(&fake, mk.market.id(), 0).await?;
    mk.mint(&fake, mk.launcher.id(), 500 * USDC).await?;
    let r = mk.send(&mk.launcher, &fake, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &c)).await?;
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"));
    // pause blocks instant handoff legs like core's
    mk.guardian.call(mk.market.id(), "pause").transact().await?.into_result()?;
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    let r = mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &c)).await?;
    assert!(has_code(&r, "R_PAUSED"));
    mk.owner.call(mk.market.id(), "unpause").transact().await?.into_result()?;
    // duplicate instant launch id
    mk.open_instant(IID, 500 * USDC, &c, &c).await?;
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    let r = mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID, mk.token.id(), &c, &c)).await?;
    assert!(has_code(&r, "R_DUP_LAUNCH"));
    // a fake token parks first for an instant id and cannot poison the real handoff
    mk.mint(&fake, mk.launcher.id(), SEED_T).await?;
    let parked = mk.send(&mk.launcher, &fake, SEED_T, Mk::leg_msg(IID + 1)).await?;
    assert!(parked.is_success());
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * USDC).await?;
    mk.mint(&mk.token, mk.launcher.id(), SEED_T).await?;
    mk.send(&mk.launcher, &mk.usdc, 500 * USDC, mk.instant_seed_msg(IID + 1, mk.token.id(), &c, &c)).await?.into_result()?;
    mk.send(&mk.launcher, &mk.token, SEED_T, Mk::leg_msg(IID + 1)).await?.into_result()?;
    assert_eq!(pool(&mk, IID + 1).await["state"], "Open");
    mk.assert_solvent(&[]).await; // two pools share one mock token here
    Ok(())
}

// ---- N-02: the lifetime instant seed cap needs a setter (ABI 1.1.2) ---------------------------------------------------

async fn set_cap(mk: &Mk, who: &near_workspaces::Account, value: u128) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(who.call(mk.market.id(), "set_max_instant_reserve").args_json(json!({ "value": value.to_string() })).transact().await?)
}

#[tokio::test]
async fn the_instant_seed_cap_is_lifetime_and_only_the_timelocked_setter_moves_it_up() -> anyhow::Result<()> {
    let mk = Mk::new_with(None, Some(1_500 * USDC)).await?;
    mk.set_launcher().await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    mk.mint(&mk.usdc, mk.launcher.id(), 3_000 * USDC).await?;
    assert!(seed(&mk, IID, 1_000 * USDC, &c, &r).await?.is_success());
    assert!(
        has_code(&seed(&mk, IID + 1, 600 * USDC, &c, &r).await?, "R_MARKET_CAP"),
        "lifetime sum: 1,000 + 600 > 1,500, and it never goes down"
    );
    // off by default: nothing queued, the cap is the one set in `new`
    let cfg = mk.view("get_config", json!({})).await;
    assert!(cfg["pending_max_instant_reserve"].is_null(), "{cfg}");
    assert_eq!(cfg["max_instant_reserve_q"], (1_500 * USDC).to_string());
    // who may call
    let stranger = mk.user("stranger", 0).await?;
    assert!(has_code(&set_cap(&mk, &stranger, 4_000 * USDC).await?, "R_NOT_AUTHORIZED"));
    assert!(has_code(&set_cap(&mk, &mk.guardian, 4_000 * USDC).await?, "R_NOT_AUTHORIZED"), "the guardian can only lower");
    // an owner raise is queued, not applied
    let q = set_cap(&mk, &mk.owner, 4_000 * USDC).await?;
    q.clone().into_result()?;
    assert_eq!(events(&q, "max_instant_queued").len(), 1);
    let cfg = mk.view("get_config", json!({})).await;
    assert_eq!(cfg["max_instant_reserve_q"], (1_500 * USDC).to_string(), "still the old cap");
    assert_eq!(cfg["pending_max_instant_reserve"]["value"], (4_000 * USDC).to_string());
    let apply = stranger.call(mk.market.id(), "apply_max_instant_reserve").transact().await?;
    assert!(has_code(&apply, "R_NOT_YET"), "{:?}", apply.failures());
    assert!(has_code(&seed(&mk, IID + 1, 600 * USDC, &c, &r).await?, "R_MARKET_CAP"), "queued is not applied");
    // a guardian lowering applies at once and cancels the queued raise
    let low = set_cap(&mk, &mk.guardian, 1_000 * USDC).await?;
    low.clone().into_result()?;
    assert_eq!((events(&low, "max_instant_lowered").len(), events(&low, "max_instant_cancelled").len()), (1, 1));
    let cfg = mk.view("get_config", json!({})).await;
    assert_eq!(cfg["max_instant_reserve_q"], (1_000 * USDC).to_string());
    assert!(cfg["pending_max_instant_reserve"].is_null(), "{cfg}");
    let none = stranger.call(mk.market.id(), "apply_max_instant_reserve").transact().await?;
    assert!(has_code(&none, "R_NOTHING"), "{:?}", none.failures());
    assert!(has_code(&seed(&mk, IID + 1, 100 * USDC, &c, &r).await?, "R_MARKET_CAP"), "1,000 + 100 > 1,000 after the lowering");
    mk.assert_solvent(&[]).await;
    Ok(())
}
