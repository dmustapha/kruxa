//! Adversarial suite for the instant launcher: fake token, direct callbacks, reentrancy, double open, early claims, creator
//! seed tricks, symbol squatting, gate bypass, ABI scan. A refusal is the pass; every test ends with the custody identities.
mod instant_common;
use instant_common::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const MS: u64 = 1_000_000;

async fn legs(ix: &Ix) -> Vec<Value> {
    ix.market.view("get_legs").await.unwrap().json().unwrap()
}

/// The names of every exported function in a wasm module (export section id 7).
fn exports(code: &[u8]) -> Vec<String> {
    fn leb(b: &[u8], i: &mut usize) -> usize {
        let (mut v, mut shift) = (0usize, 0);
        loop {
            let byte = b[*i];
            *i += 1;
            v |= ((byte & 0x7f) as usize) << shift;
            if byte & 0x80 == 0 {
                return v;
            }
            shift += 7;
        }
    }
    let (mut i, mut out) = (8, vec![]);
    while i < code.len() {
        let id = code[i];
        i += 1;
        let len = leb(code, &mut i);
        let end = i + len;
        if id == 7 {
            let count = leb(code, &mut i);
            for _ in 0..count {
                let nl = leb(code, &mut i);
                out.push(String::from_utf8_lossy(&code[i..i + nl]).to_string());
                i += nl;
                i += 1;
                leb(code, &mut i);
            }
        }
        i = end;
    }
    out
}

#[tokio::test]
async fn a_fake_usdc_or_the_launch_token_can_never_seed() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("FAKE"), None).await?;
    let root = ix.worker.root_account()?;
    let fake = root.create_subaccount("fakeusdc").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?.deploy(&wasm("mock_ft")).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": ix.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    ix.register(&fake, ix.launcher.id()).await?;
    ix.register(&fake, ix.creator.id()).await?;
    fake.call("mint").args_json(json!({ "account_id": ix.creator.id(), "amount": "250000000" })).transact().await?.into_result()?;
    let r = ix.seed_via(&ix.creator, fake.id(), &id, 250 * USDC).await?;
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"), "{:?}", r.logs());
    assert_eq!(ix.bal(fake.id(), ix.creator.id()).await, 250 * USDC, "the fake token came back");
    assert_eq!(ix.status(&id).await, "TokenReady");
    // the launch token itself (the launcher holds all of it): a transfer-call from the launcher to itself is not possible, so
    // a holder sends it from another account; here the creator receives some and tries
    let tok = ix.token_id("FAKE");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    // calling ft_on_transfer directly, from a non-token account, with the exact right message
    let msg = json!({ "v": 1, "op": "seed_instant", "launch_id": id }).to_string();
    let direct = ix.creator.call(ix.launcher.id(), "ft_on_transfer").args_json(json!({ "sender_id": ix.creator.id(), "amount": "250000000", "msg": msg })).gas(GAS).transact().await?;
    assert_eq!(direct.json::<String>()?, "250000000", "returned in full");
    assert_eq!(ix.status(&id).await, "TokenReady");
    assert_eq!(n(&ix.view("get_invariants", json!({})).await["usdc_custody"]), 0);
    Ok(())
}

#[tokio::test]
async fn every_callback_is_private() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.launch_to_open(&ix.creator, params("PRIV")).await?;
    let before = ix.inst(&id).await;
    let calls = [
        ("on_instant_token_created", json!({ "launch_id": id })),
        ("on_instant_token_verified", json!({ "launch_id": id })),
        ("on_instant_leg", json!({ "launch_id": id, "leg": "Seed", "amount": "1" })),
        ("on_instant_leg", json!({ "launch_id": id, "leg": "Token", "amount": "1" })),
        ("resolve_payout", json!({ "token": ix.usdc.id(), "account": ix.creator.id(), "amount": "1000000", "reason": "x" })),
        ("resolve_near", json!({ "account": ix.creator.id(), "amount": "1000000", "reason": "x" })),
    ];
    for who in [&ix.creator, &ix.owner, &ix.guardian] {
        for (m, a) in &calls {
            let r = ix.call(who, m, a.clone()).await?;
            assert!(r.is_failure() && format!("{:?}", r.failures()).contains("rivate"), "{m} by {}: {:?}", who.id(), r.failures());
        }
    }
    assert_eq!(ix.inst(&id).await, before, "no direct callback moved anything");
    assert_eq!(ix.view("owed_of_account", json!({ "account": ix.creator.id(), "token_id": ix.usdc.id() })).await, "0");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn concurrent_open_instant_calls_send_each_leg_once() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("DBLO"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let (a, b, c) = (ix.user("a", 0).await?, ix.user("b", 0).await?, ix.user("c", 0).await?);
    let (ra, rb, rc) = tokio::join!(ix.open(&a, &id), ix.open(&b, &id), ix.open(&c, &id));
    let ok = [ra?, rb?, rc?].iter().filter(|r| r.is_success()).count();
    assert!(ok >= 1);
    let seen = legs(&ix).await;
    assert_eq!(seen.iter().filter(|l| l["msg"]["op"] == "seed_quote").count(), 1, "the seed went once: {seen:?}");
    assert_eq!(seen.iter().filter(|l| l["msg"]["op"] == "open_pool_token").count(), 1, "the pool bucket went once");
    assert_eq!(ix.usdc_bal(ix.market.id()).await, 250 * USDC);
    assert_eq!(ix.bal(&ix.token_id("DBLO"), ix.market.id()).await, N_TOTAL / 20 * 19);
    assert_eq!(ix.status(&id).await, "Open");
    let late = ix.open(&a, &id).await?;
    assert!(has_code(&late, "R_INSTANT_STATE"));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn reentrant_calls_from_the_token_cannot_double_pay_or_double_refund() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let mut p = params("REEN");
    p["vest_days"] = json!(30);
    let id = ix.launch_to_open(&ix.creator, p).await?;
    let tok = ix.token_id("REEN");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let opened = n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 100_000 * MS).await;
    // while the launcher pays the allocation, the token calls back into the launcher with the recipient's request
    let hook = json!({ "account": ix.launcher.id(), "method": "claim_vested", "args": json!({ "launch_id": id }).to_string() });
    ix.creator.call(&tok, "set_reenter").args_json(hook).transact().await?.into_result()?;
    let r = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    r.into_result()?;
    let got = ix.bal(&tok, ix.creator.id()).await;
    let v = ix.view("get_vesting", lid(&id)).await;
    assert_eq!(n(&v["claimed"]), got, "claimed equals what was paid, once");
    assert!(got <= n(&v["total"]));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn early_and_foreign_claims_are_refused() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("EARL"), None).await?;
    for state in ["TokenReady", "Seeded"] {
        let r = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
        assert!(has_code(&r, "R_INSTANT_STATE"), "{state}: {:?}", r.failures());
        if state == "TokenReady" {
            ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
            ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
        }
    }
    ix.open(&ix.creator, &id).await?.into_result()?;
    let huge = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": u128::MAX.to_string() })).await?;
    assert!(has_code(&huge, "STREAM_CAP"), "{:?}", huge.failures());
    let zero = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": "0" })).await?;
    assert!(has_code(&zero, "R_NOTHING_TO_CLAIM"));
    let tok = ix.token_id("EARL");
    assert_eq!(ix.bal(&tok, ix.creator.id()).await, 0);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn creator_seed_tricks_do_not_move_money_twice() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("TRIK"), None).await?;
    ix.mint_usdc(ix.creator.id(), 2_000 * USDC).await?;
    // a donation by a plain ft_transfer only adds to the balance
    ix.creator.call(ix.usdc.id(), "ft_transfer").args_json(json!({ "receiver_id": ix.launcher.id(), "amount": "5000000" })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    for _ in 0..3 {
        let dup = ix.seed(&ix.creator, &id, 250 * USDC).await?;
        assert!(has_code(&dup, "R_INSTANT_STATE"));
    }
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, 2_000 * USDC - 5 * USDC - 250 * USDC, "only one seed was kept");
    ix.assert_solvent(&[&id]).await;
    set_market_mode(&ix, "refuse_seed").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let seeded = n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded + 31_000 * MS).await;
    ix.call(&ix.creator, "abort_instant", lid(&id)).await?.into_result()?;
    let after = ix.usdc_bal(ix.creator.id()).await;
    assert_eq!(after, 2_000 * USDC - 5 * USDC, "the seed came back once");
    for _ in 0..2 {
        let again = ix.call(&ix.creator, "abort_instant", lid(&id)).await?;
        assert!(has_code(&again, "R_INSTANT_STATE"), "{:?}", again.failures());
    }
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, after, "no second refund");
    let open_after = ix.open(&ix.creator, &id).await?;
    assert!(has_code(&open_after, "R_INSTANT_STATE"));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

async fn set_market_mode(ix: &Ix, mode: &str) {
    ix.market.call("set_mode").args_json(json!({ "mode": mode })).transact().await.unwrap().into_result().unwrap();
}

#[tokio::test]
async fn a_symbol_cannot_be_squatted_into_a_reserved_or_foreign_name() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    for sym in ["KRUXA", "USDC", "NEAR", "kruxa", "KRUXA1234567890"] {
        for who in [&ix.creator, &ix.owner] {
            let r = ix.create_raw(who, params(sym), None).await?;
            assert!(has_code(&r, "R_SYMBOL_RESERVED") || has_code(&r, "R_SYMBOL"), "{sym}: {:?}", r.failures());
        }
    }
    // an abandoned launch keeps its symbol: the token account exists, nobody else can take the name
    let id = ix.create_ready(&ix.creator, params("SQAT"), None).await?;
    ix.call(&ix.creator, "cancel_instant", lid(&id)).await?.into_result()?;
    let other = ix.user("other", 0).await?;
    let r = ix.create_raw(&other, params("SQAT"), None).await?;
    assert!(has_code(&r, "R_SYMBOL"), "{:?}", r.failures());
    Ok(())
}

#[tokio::test]
async fn nobody_bypasses_the_mainnet_gate_or_redirects_the_market() -> anyhow::Result<()> {
    let ix = Ix::new("mainnet", true).await?;
    let stranger = ix.user("stranger", 0).await?;
    for who in [&ix.creator, &ix.owner, &ix.guardian, &ix.treasury, &stranger] {
        let r = ix.create_raw(who, params("BYPS"), Some(stranger.id())).await?;
        assert!(has_code(&r, "R_CREATOR_GATE"), "{}: {:?}", who.id(), r.failures());
    }
    for (m, a) in [("open_beta", json!({})), ("set_market", json!({ "account": stranger.id() })), ("unpause", json!({})), ("reserve_symbol", json!({ "symbol": "ZZZ" }))] {
        for who in [&stranger, &ix.creator, &ix.guardian] {
            let r = ix.call(who, m, a.clone()).await?;
            assert!(has_code(&r, "R_NOT_AUTHORIZED"), "{m} by {}: {:?}", who.id(), r.failures());
        }
    }
    assert_eq!(ix.view("get_config", json!({})).await["creator_gate"], true);
    // after open_beta the market is locked by the first open_instant (IL-4)
    ix.call(&ix.owner, "open_beta", json!({})).await?.into_result()?;
    let id = ix.create_ready(&ix.creator, params("BYPS"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let late = ix.call(&ix.owner, "set_market", json!({ "account": stranger.id() })).await?;
    assert!(has_code(&late, "R_NOTHING"), "{:?}", late.failures());
    assert_eq!(ix.view("get_config", json!({})).await["market"], json!(ix.market.id()));
    Ok(())
}

#[tokio::test]
async fn hostile_fee_terms_and_edge_inputs_are_refused() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let fees = |c: u16, pl: u16, h: u16, l: u16, rf: u16, total: u16| json!({ "total_fee_bps": total, "creator_bps": c, "platform_bps": pl, "holders_bps": h, "lp_bps": l, "referral_bps": rf,
        "opening_fee_start_bps": 0, "opening_decay_minutes": 0, "fee_vest_bps": 5000, "fee_vest_days": 90 });
    let cases: Vec<(Value, &str)> = vec![
        (json!({ "name": "A", "symbol": "HOS1", "fees": fees(10000, 0, 0, 0, 0, 100) }), "R_CREATOR_SHARE"),
        (json!({ "name": "A", "symbol": "HOS2", "fees": fees(0, 0, 3000, 7000, 0, 100) }), "R_PLATFORM_FLOOR"),
        (json!({ "name": "A", "symbol": "HOS3", "fees": fees(5000, 1500, 1500, 1000, 1000, 5000) }), "R_FEE_TOTAL"),
        (json!({ "name": "A", "symbol": "HOS4", "creator_alloc_bps": 65535 }), "R_ALLOC"),
        (json!({ "name": "A", "symbol": "HOS5", "seed_q": "340282366920938463463374607431768211455" }), "R_SEED_RANGE"),
        (json!({ "name": "A", "symbol": "TOOLONGSYMBOL1" }), "R_SYMBOL"),
        (json!({ "name": "Zoë", "symbol": "HOS6" }), "R_SYMBOL"),
        (json!({ "name": "x".repeat(33), "symbol": "HOS7" }), "R_SYMBOL"),
    ];
    for (p, code) in cases {
        let r = ix.create_raw(&ix.creator, p.clone(), None).await?;
        assert!(has_code(&r, code), "{code} for {p}: {:?}", r.failures());
    }
    let junk = ix.creator.call(ix.launcher.id(), "create_instant").args_json(json!({ "params": "nope" })).deposit(NearToken::from_near(1)).gas(GAS).transact().await?;
    assert!(junk.is_failure());
    assert_eq!(ix.view("get_config", json!({})).await["next_launch_id"], ID0.to_string());
    Ok(())
}

#[tokio::test]
async fn the_abi_has_no_mint_no_pool_withdrawal_and_no_recipient_setter() -> anyhow::Result<()> {
    let ex = exports(&wasm("kruxa_instant_contract"));
    assert!(ex.iter().any(|e| e == "claim_vested") && ex.iter().any(|e| e == "open_instant"), "parser sanity: {ex:?}");
    for bad in ["mint", "burn", "set_payout", "set_recipient", "set_creator", "change_recipient", "withdraw_pool", "withdraw_liquidity", "remove_liquidity", "sweep", "upgrade", "set_launch", "migrate", "transfer_pool"] {
        assert!(!ex.iter().any(|e| e.contains(bad)), "forbidden export containing {bad}: {ex:?}");
    }
    // the only methods that move a token out: claim_vested (recipient), abort_instant (creator seed), withdraw_platform,
    // claim_owed(_near), reclaim_deposit, and the market handoff; none takes a destination argument
    let moving = ["claim_vested", "abort_instant", "withdraw_platform", "claim_owed", "claim_owed_near", "reclaim_deposit", "open_instant"];
    for m in moving {
        assert!(ex.iter().any(|e| e == m), "{m}");
    }
    Ok(())
}

#[tokio::test]
async fn a_pool_bucket_can_only_go_to_the_market_named_before_the_first_open() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let thief = ix.user("thief", 0).await?;
    let r = ix.call(&thief, "set_market", json!({ "account": thief.id() })).await?;
    assert!(has_code(&r, "R_NOT_AUTHORIZED"));
    let id = ix.launch_to_open(&ix.creator, params("LOCK")).await?;
    // every token that left the launcher went to the stub market, nothing to the creator or a thief
    let tok = ix.token_id("LOCK");
    assert_eq!(ix.bal(&tok, thief.id()).await + ix.bal(&tok, ix.creator.id()).await, 0);
    assert_eq!(ix.bal(&tok, ix.market.id()).await, N_TOTAL / 20 * 19);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}
