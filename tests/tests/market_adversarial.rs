//! M-3 adversarial suite: fake token, direct callback, reentrancy, donation, rounding dust, cap breach, sandwich `min_out`.
mod market_common;
use market_common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ID: u64 = 1;

async fn pool_json(mk: &Mk, id: u64) -> serde_json::Value {
    mk.view("get_pool", json!({ "launch_id": id.to_string() })).await
}

#[tokio::test]
async fn fake_token_cannot_buy_sell_seed_or_hijack_the_handoff() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    let root = mk.worker.root_account()?;
    let fake = deploy_ft(&root, "fake").await?;
    mk.mint(&fake, mk.market.id(), 0).await?;
    // a fake token leg parks first (sender "core" is whatever the fake token claims) ...
    mk.mint(&fake, mk.core.id(), SEED_T).await?;
    let parked = mk.send(&mk.core, &fake, SEED_T, Mk::leg_msg(ID)).await?;
    assert!(parked.is_success());
    // ... and must not block or poison the real handoff
    mk.open_pool(ID).await?;
    let p = pool_json(&mk, ID).await;
    assert_eq!((p["state"].as_str(), n(&p["t"]), p["token"].as_str()), (Some("Open"), SEED_T, Some(mk.token.id().as_str())));
    // fake USDC "buy" and "seed", fake launch token "sell", fake leg after open
    let eve = mk.user("eve", 0).await?;
    mk.mint(&fake, eve.id(), 500 * USDC).await?;
    let r = mk.send(&eve, &fake, 100 * USDC, Mk::buy_msg(ID, 1)).await?;
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"));
    let r = mk.send(&eve, &fake, 100 * USDC, Mk::sell_msg(ID, 1)).await?;
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"));
    assert_eq!(mk.bal(&fake, eve.id()).await, 500 * USDC, "fake tokens refunded");
    mk.mint(&fake, mk.core.id(), SEED_Q).await?;
    let r = mk.send(&mk.core, &fake, SEED_Q, mk.seed_msg(2, fake.id())).await?;
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"));
    assert!(pool_json(&mk, 2).await.is_null());
    let r = mk.send(&mk.core, &fake, 1, Mk::leg_msg(ID)).await?;
    assert!(has_code(&r, "R_POOL_STATE"), "pool already open");
    assert_eq!((n(&pool_json(&mk, ID).await["q"]), n(&pool_json(&mk, ID).await["t"])), (SEED_Q, SEED_T));
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn seed_from_a_non_core_sender_or_a_duplicate_launch_is_refused() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    let eve = mk.user("eve", 2_000 * USDC).await?;
    let r = mk.send(&eve, &mk.usdc, SEED_Q, mk.seed_msg(ID, mk.token.id())).await?;
    assert!(has_code(&r, "R_NOT_AUTHORIZED"));
    assert!(pool_json(&mk, ID).await.is_null());
    assert_eq!(mk.bal(&mk.usdc, eve.id()).await, 2_000 * USDC);
    mk.open_pool(ID).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    let r = mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(ID, mk.token.id())).await?;
    assert!(has_code(&r, "R_DUP_LAUNCH"));
    assert_eq!(mk.bal(&mk.usdc, mk.core.id()).await, SEED_Q);
    Ok(())
}

#[tokio::test]
async fn direct_callbacks_and_direct_ft_on_transfer_do_nothing() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let eve = mk.user("eve", 0).await?;
    let r = eve
        .call(mk.market.id(), "resolve_payout")
        .args_json(json!({ "token": mk.usdc.id(), "account": eve.id(), "amount": "1000000", "reason": "x" }))
        .transact()
        .await?;
    assert!(r.is_failure() && format!("{:?}", r.failures()).contains("private"), "{:?}", r.failures());
    // a plain account calling ft_on_transfer is not the USDC contract: refused, no panic, no state change
    let r = eve
        .call(mk.market.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": eve.id(), "amount": "100000000", "msg": Mk::buy_msg(ID, 1) }))
        .transact()
        .await?;
    assert!(r.is_success() && has_code(&r, "R_UNEXPECTED_TOKEN"));
    assert_eq!(r.json::<String>()?, "100000000", "full amount handed back");
    let p = pool_json(&mk, ID).await;
    assert_eq!((n(&p["q"]), n(&p["t"])), (SEED_Q, SEED_T));
    // garbage messages never panic
    for bad in ["", "{", "{\"v\":2,\"op\":\"buy\",\"launch_id\":\"1\"}", "{\"v\":1,\"op\":\"nope\",\"launch_id\":\"1\"}"] {
        let alice = mk.user(&format!("a{}", bad.len()), 10 * USDC).await?;
        let r = mk.send(&alice, &mk.usdc, 5 * USDC, bad.to_string()).await?;
        assert!(has_code(&r, "R_BAD_MSG"), "{bad}");
        assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 10 * USDC);
    }
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn reentrancy_from_the_payout_token_cannot_claim_or_double_pay() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 500 * USDC, 1).await?.into_result()?;
    // From now on every ft_transfer of the launch token also calls claim / withdraw_platform / claim_owed on the market
    for (method, args) in
        [("claim", json!({ "launch_id": "1" })), ("withdraw_platform", json!({})), ("claim_owed", json!({ "token_id": mk.token.id() }))]
    {
        mk.token
            .call("set_reenter")
            .args_json(json!({ "account": mk.market.id(), "method": method, "args": args.to_string() }))
            .transact()
            .await?
            .into_result()?;
        let r = mk.buy(&alice, ID, 100 * USDC, 1).await?;
        assert_eq!(events(&r, "swap").len(), 1, "{method}");
    }
    assert_eq!(mk.bal(&mk.usdc, mk.creator.id()).await, 0, "the token contract is not the recipient");
    assert_eq!(mk.bal(&mk.usdc, mk.treasury.id()).await, 0);
    // the debit happens before the outbound call, so a second claim finds nothing left
    let a = mk.creator.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    let b = mk.creator.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(GAS).transact().await?;
    assert!(a.is_success() && b.is_failure() && has_code(&b, "R_NOTHING_TO_CLAIM"), "{:?}", b.failures());
    let st = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    assert_eq!(n(&st["paid"]), mk.bal(&mk.usdc, mk.creator.id()).await);
    assert!(n(&st["paid"]) <= n(&st["unlocked"]));
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn donation_moves_no_price_and_cannot_break_solvency() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let q0 = mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (50 * USDC).to_string(), "now_ns": "9999999999999999999" })).await;
    let eve = mk.user("eve", 1_000 * USDC).await?;
    eve.call(mk.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": mk.market.id(), "amount": (900 * USDC).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let q1 = mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (50 * USDC).to_string(), "now_ns": "9999999999999999999" })).await;
    assert_eq!(q0, q1, "a direct transfer is not a deposit");
    let p = pool_json(&mk, ID).await;
    assert_eq!(n(&p["q"]), SEED_Q);
    mk.assert_solvent(&[ID]).await;
    assert!(mk.bal(&mk.usdc, mk.market.id()).await > n(&mk.view("get_invariants", json!({})).await["usdc_custody"]));
    Ok(())
}

#[tokio::test]
async fn rounding_dust_never_lowers_k_or_creates_value() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 200 * USDC).await?;
    let sub_dollar = mk.buy(&alice, ID, USDC - 1, 1).await?;
    assert!(has_code(&sub_dollar, "R_MIN_TRADE"));
    assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 200 * USDC);
    let (mut q, mut t) = (SEED_Q, SEED_T);
    let mut k = q * t;
    let mut swaps = vec![];
    for i in 0..8u128 {
        swaps.extend(events(&mk.buy(&alice, ID, 5 * USDC + 1_234 * (i + 1) + i, 1).await?, "swap"));
        let held = mk.bal(&mk.token, alice.id()).await;
        swaps.extend(events(&mk.sell(&alice, ID, held / 3 + 1, 1).await?, "swap"));
    }
    assert!(swaps.len() >= 14);
    for e in &swaps {
        let sum: u128 = ["creator", "platform", "holders", "lp", "referral"].iter().map(|f| n(&e[*f])).sum();
        assert_eq!(sum, n(&e["fee_total"]));
        let (nq, nt) = (n(&e["q"]), n(&e["t"]));
        assert!(nq * nt >= k, "k fell");
        (q, t, k) = (nq, nt, nq * nt);
    }
    let _ = (q, t);
    // sell the rest: the trader ends with strictly less USDC than they started (fees are real, nothing minted)
    let held = mk.bal(&mk.token, alice.id()).await;
    mk.sell(&alice, ID, held, 1).await?;
    assert!(mk.bal(&mk.usdc, alice.id()).await < 200 * USDC);
    mk.assert_solvent(&[ID]).await;
    // exact custody: every micro-USDC accounted for, nothing donated here
    let inv = mk.view("get_invariants", json!({})).await;
    assert_eq!(mk.bal(&mk.usdc, mk.market.id()).await, n(&inv["usdc_custody"]));
    Ok(())
}

#[tokio::test]
async fn global_cap_breach_is_refused_across_pools() -> anyhow::Result<()> {
    let mk = Mk::new(Some((5_000 * USDC, 2_100 * USDC))).await?;
    mk.open_pool(1).await?;
    let root = mk.worker.root_account()?;
    let tok2 = deploy_ft(&root, "tok2").await?;
    mk.mint(&tok2, mk.market.id(), 0).await?;
    mk.mint(&tok2, mk.core.id(), SEED_T).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(2, tok2.id())).await?.into_result()?;
    mk.send(&mk.core, &tok2, SEED_T, Mk::leg_msg(2)).await?.into_result()?;
    assert_eq!(mk.view("get_config", json!({})).await["global_q"], (2_000 * USDC).to_string());
    let alice = mk.user("alice", 1_000 * USDC).await?;
    let r = mk.buy(&alice, 1, 150 * USDC, 1).await?;
    assert!(has_code(&r, "R_MARKET_CAP"));
    assert_eq!(mk.bal(&mk.usdc, alice.id()).await, 1_000 * USDC);
    assert_eq!(events(&mk.buy(&alice, 2, 50 * USDC, 1).await?, "swap").len(), 1);
    mk.assert_solvent(&[1, 2]).await;
    Ok(())
}

#[tokio::test]
async fn sandwich_is_defeated_by_min_out_and_missing_min_out_is_refused() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let victim = mk.user("victim", 500 * USDC).await?;
    let attacker = mk.user("attacker", 1_500 * USDC).await?;
    let quote = mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (100 * USDC).to_string() })).await;
    let min_out = n(&quote["out"]) * 995 / 1000;
    // front-run: the attacker pushes the price up first
    mk.buy(&attacker, ID, 800 * USDC, 1).await?.into_result()?;
    let r = mk.buy(&victim, ID, 100 * USDC, min_out).await?;
    assert!(has_code(&r, "R_MIN_OUT"));
    assert_eq!(mk.bal(&mk.usdc, victim.id()).await, 500 * USDC, "victim refunded in full");
    assert_eq!(mk.bal(&mk.token, victim.id()).await, 0);
    // back-run alone does not profit either
    let held = mk.bal(&mk.token, attacker.id()).await - 10;
    mk.sell(&attacker, ID, held, 1).await?.into_result()?;
    assert!(mk.bal(&mk.usdc, attacker.id()).await < 1_500 * USDC);
    // min_out missing or zero: refused
    for msg in [json!({ "v": 1, "op": "buy", "launch_id": "1" }).to_string(), Mk::buy_msg(ID, 0)] {
        let r = mk.send(&victim, &mk.usdc, 10 * USDC, msg).await?;
        assert!(has_code(&r, "R_MIN_OUT"));
    }
    let r = mk.sell(&attacker, ID, 5, 0).await?;
    assert!(has_code(&r, "R_MIN_OUT") || has_code(&r, "R_MIN_TRADE"));
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn token_whose_ft_transfer_returns_a_value_is_not_paid_twice() -> anyhow::Result<()> {
    // M-04 regression: promise_result_checked(0, 0) booked any non-empty result as a failure, so claim_owed paid again.
    let mk = Mk::new(None).await?;
    let root = mk.worker.root_account()?;
    let rt = deploy_ft_ret(&root, "rtok").await?;
    mk.mint(&rt, mk.market.id(), 0).await?;
    mk.mint(&rt, mk.core.id(), SEED_T).await?;
    mk.mint(&mk.usdc, mk.core.id(), SEED_Q).await?;
    mk.send(&mk.core, &mk.usdc, SEED_Q, mk.seed_msg(ID, rt.id())).await?.into_result()?;
    mk.send(&mk.core, &rt, SEED_T, Mk::leg_msg(ID)).await?.into_result()?;
    let alice = mk.user("alice", 500 * USDC).await?;
    mk.mint(&rt, alice.id(), 0).await?;
    let r = mk.buy(&alice, ID, 100 * USDC, 1).await?;
    let out = n(&events(&r, "swap")[0]["amount_out"]);
    assert!(events(&r, "owed_credited").is_empty(), "a successful transfer must not create an owed balance");
    assert_eq!(mk.bal(&rt, alice.id()).await, out);
    let again = alice.call(mk.market.id(), "claim_owed").args_json(json!({ "token_id": rt.id() })).gas(GAS).transact().await?;
    assert!(has_code(&again, "R_NOTHING_TO_CLAIM"));
    assert_eq!(mk.bal(&rt, alice.id()).await, out, "paid exactly once");
    let inv = mk.view("get_invariants", json!({})).await;
    assert_eq!(inv["usdc_custody_identity"], true);
    Ok(())
}

#[tokio::test]
async fn emptied_owed_entries_are_removed_from_storage() -> anyhow::Result<()> {
    // L-10 regression: owed_debit wrote zero instead of removing the key, so entries never shrank.
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 500 * USDC).await?;
    let ghost = format!("ghost.{}", mk.worker.root_account()?.id());
    let msg = json!({ "v": 1, "op": "buy", "launch_id": "1", "min_out": "1", "receiver": ghost }).to_string();
    mk.send(&alice, &mk.usdc, 50 * USDC, msg).await?;
    let owed_keys =
        |st: &std::collections::HashMap<Vec<u8>, Vec<u8>>| st.keys().filter(|k| k.first() == Some(&2u8) || k.first() == Some(&3u8)).count();
    let before = owed_keys(&mk.market.view_state().await?);
    assert!(before >= 2, "owed entry and owed_total entry exist: {before}");
    let ghost_acct =
        mk.worker.root_account()?.create_subaccount("ghost").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    mk.mint(&mk.token, ghost_acct.id(), 0).await?;
    let c = ghost_acct.call(mk.market.id(), "claim_owed").args_json(json!({ "token_id": mk.token.id() })).gas(GAS).transact().await?;
    assert!(c.is_success());
    assert_eq!(owed_keys(&mk.market.view_state().await?), 0, "both keys removed once the balance is zero");
    Ok(())
}
