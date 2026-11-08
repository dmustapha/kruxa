//! Sandbox suite for the instant launcher (CHANGE-ORDER-7, docs/interfaces/INSTANT-ABI.md): the whole flow against the stub
//! market (every failure path is scripted there) and the money/vesting/pause/gate semantics.
mod instant_common;
use instant_common::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const MS: u64 = 1_000_000;

async fn legs(ix: &Ix) -> Vec<Value> {
    ix.market.view("get_legs").await.unwrap().json().unwrap()
}

async fn set_mode(ix: &Ix, mode: &str) {
    ix.market.call("set_mode").args_json(json!({ "mode": mode })).transact().await.unwrap().into_result().unwrap();
}

#[tokio::test]
async fn happy_path_create_seed_open() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("HAPY"), None).await?;
    let r = ix.inst(&id).await;
    assert_eq!((n(&r["total_supply"]), n(&r["n_alloc"]), n(&r["n_pool"])), (N_TOTAL, N_TOTAL / 20, N_TOTAL / 20 * 19));
    assert_eq!(
        (r["mode"].clone(), r["creator"].clone(), r["payout_recipient"].clone()),
        (json!("instant"), json!(ix.creator.id()), json!(ix.creator.id()))
    );
    assert_eq!(r["token"], json!(ix.token_id("HAPY")));
    assert_eq!(r["charter_hash"].as_str().unwrap().len(), 64);
    assert!(id.parse::<u64>()? >= ID0);
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    let seeded = ix.seed(&ix.creator, &id, 250 * USDC).await?;
    seeded.clone().into_result()?;
    assert_eq!(events(&seeded, "instant_seeded")[0]["seed"], "250000000");
    assert_eq!(ix.status(&id).await, "Seeded");
    let opened = ix.open(&ix.user("anyone", 0).await?, &id).await?;
    assert_eq!(opened.clone().into_result()?.json::<u8>()?, 1);
    assert_eq!(ix.status(&id).await, "Open", "logs {:#?} failures {:#?}", opened.logs(), opened.failures());
    for e in ["instant_handoff", "instant_leg_resolved"] {
        assert_eq!(events(&opened, e).len(), 2, "{e}");
    }
    let ev = &events(&opened, "instant_opened")[0];
    assert_eq!((n(&ev["q"]), n(&ev["t"])), (250 * USDC, N_TOTAL / 20 * 19));
    let seen = legs(&ix).await;
    assert_eq!(seen.len(), 2);
    let (seed_leg, tok_leg) = (&seen[0], &seen[1]);
    assert_eq!((seed_leg["token_contract"].clone(), seed_leg["sender"].clone()), (json!(ix.usdc.id()), json!(ix.launcher.id())));
    let m = &seed_leg["msg"];
    assert_eq!((m["op"].clone(), m["launch_id"].clone(), m["token"].clone()), (json!("seed_quote"), json!(id), json!(ix.token_id("HAPY"))));
    assert_eq!(
        (m["creator"].clone(), m["payout_recipient"].clone(), m["charter_hash"].clone()),
        (json!(ix.creator.id()), json!(ix.creator.id()), r["charter_hash"].clone())
    );
    assert_eq!((m["total_supply"].clone(), m["supply_model"].clone()), (json!(N_TOTAL.to_string()), json!("near_factory_fixed")));
    assert_eq!(m["terms"]["opening_fee_start_bps"], 500);
    assert!(m.get("mint_authority").is_none() || m["mint_authority"].is_null());
    assert_eq!(seed_leg["amount"], "250000000");
    assert_eq!(
        (tok_leg["token_contract"].clone(), tok_leg["amount"].clone()),
        (json!(ix.token_id("HAPY")), json!((N_TOTAL / 20 * 19).to_string()))
    );
    assert_eq!(ix.usdc_bal(ix.market.id()).await, 250 * USDC);
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 0);
    let tok = ix.token_id("HAPY");
    assert_eq!((ix.bal(&tok, ix.market.id()).await, ix.bal(&tok, ix.launcher.id()).await), (N_TOTAL / 20 * 19, N_TOTAL / 20));
    assert_eq!(ix.view("get_phase", lid(&id)).await["step"], "done");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn the_allocation_vests_after_the_cliff_and_pays_exactly_n_alloc() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let mut p = params("VEST");
    p["vest_days"] = json!(30);
    let id = ix.launch_to_open(&ix.creator, p).await?;
    let tok = ix.token_id("VEST");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let r = ix.inst(&id).await;
    let (opened, n_alloc) = (n(&r["opened_at_ns"]) as u64, n(&r["n_alloc"]));
    let (cliff, vest) = (70_000 * MS, 300_000 * MS);
    let v = ix.view("get_vesting", lid(&id)).await;
    assert_eq!((n(&v["total"]), n(&v["claimable"])), (n_alloc, 0));
    let none = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    assert!(has_code(&none, "R_NOTHING_TO_CLAIM"), "{:?}", none.failures());
    let over = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": "1" })).await?;
    assert!(has_code(&over, "STREAM_CAP"), "{:?}", over.failures());
    let stranger = ix.user("stranger", 0).await?;
    let wrong = ix.call(&stranger, "claim_vested", json!({ "launch_id": id })).await?;
    assert!(has_code(&wrong, "R_NOT_AUTHORIZED"), "{:?}", wrong.failures());
    ix.wait_until(opened + cliff + 2_000 * MS).await;
    let (t0, v) = (ix.now().await, ix.view("get_vesting", lid(&id)).await);
    let t1 = ix.now().await;
    let (lo, hi) = (n_alloc * (t0 - opened) as u128 / vest as u128, n_alloc * (t1 - opened) as u128 / vest as u128);
    let can = n(&v["claimable"]);
    assert!(can > 0 && can >= lo && can <= hi.max(lo + 1), "claimable {can} not in [{lo}, {hi}]");
    let first = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": (can / 2).to_string() })).await?;
    first.clone().into_result()?;
    let got = ix.bal(&tok, ix.creator.id()).await;
    assert_eq!(got, can / 2);
    assert_eq!(n(&events(&first, "alloc_claimed")[0]["amount"]), can / 2);
    ix.assert_solvent(&[&id]).await;
    ix.wait_until(opened + vest + 1_000 * MS).await;
    ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?.into_result()?;
    assert_eq!(ix.bal(&tok, ix.creator.id()).await, n_alloc, "everything vested is paid, exactly n_alloc");
    let again = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    assert!(has_code(&again, "R_NOTHING_TO_CLAIM"));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn a_failed_allocation_payout_becomes_an_owed_balance() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let mut p = params("OWED");
    p["vest_days"] = json!(30);
    let id = ix.launch_to_open(&ix.creator, p).await?;
    let tok = ix.token_id("OWED");
    let opened = n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 380_000 * MS).await;
    // the creator is NOT registered on the token: the transfer fails, the callback records an owed balance
    let r = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    r.clone().into_result()?;
    assert_eq!(events(&r, "owed_credited").len(), 1, "{:?}", r.logs());
    let owed = n(&ix.view("owed_of_account", json!({ "account": ix.creator.id(), "token_id": tok })).await);
    assert_eq!(owed, N_TOTAL / 20);
    assert_eq!(ix.bal(&tok, ix.creator.id()).await, 0);
    ix.assert_solvent(&[&id]).await;
    let early = ix.call(&ix.creator, "claim_owed", json!({ "token_id": tok })).await?;
    early.into_result()?;
    assert_eq!(ix.bal(&tok, ix.creator.id()).await, 0, "still not registered: owed again");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    ix.call(&ix.creator, "claim_owed", json!({ "token_id": tok })).await?.into_result()?;
    assert_eq!(ix.bal(&tok, ix.creator.id()).await, N_TOTAL / 20);
    let none = ix.call(&ix.creator, "claim_owed", json!({ "token_id": tok })).await?;
    assert!(has_code(&none, "R_NOTHING_TO_CLAIM"));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn mainnet_gate_refuses_everyone_including_the_owner_until_open_beta() -> anyhow::Result<()> {
    let ix = Ix::new("mainnet", true).await?;
    assert_eq!(ix.view("get_config", json!({})).await["creator_gate"], true);
    ix.predeploy_token("GATE", N_TOTAL).await?;
    for who in [&ix.creator, &ix.owner, &ix.guardian] {
        let r = ix.create_raw(who, params("GATE"), None).await?;
        assert!(has_code(&r, "R_CREATOR_GATE"), "{}: {:?}", who.id(), r.failures());
    }
    let pre = ix.view("preview_instant", json!({ "params": params("GATE"), "creator": ix.owner.id() })).await;
    assert_eq!(pre["violations"][0]["code"], "R_CREATOR_GATE");
    for who in [&ix.guardian, &ix.creator] {
        let r = ix.call(who, "open_beta", json!({})).await?;
        assert!(has_code(&r, "R_NOT_AUTHORIZED"), "{:?}", r.failures());
    }
    let ev = ix.call(&ix.owner, "open_beta", json!({})).await?;
    assert_eq!(events(&ev, "beta_opened").len(), 1, "{:?}", ev.failures());
    let twice = ix.call(&ix.owner, "open_beta", json!({})).await?;
    assert!(has_code(&twice, "R_NOTHING"));
    ix.create_raw(&ix.creator, params("GATE"), None).await?.into_result()?;
    assert_eq!(ix.view("get_config", json!({})).await["creator_gate"], false);
    Ok(())
}

#[tokio::test]
async fn the_mainnet_launch_fee_comes_out_of_the_seed_and_accrues_to_the_platform() -> anyhow::Result<()> {
    let ix = Ix::new("mainnet", true).await?;
    ix.call(&ix.owner, "open_beta", json!({})).await?.into_result()?;
    let id = ix.create_ready(&ix.creator, params("FEE1"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let r = ix.inst(&id).await;
    assert_eq!((n(&r["fee_held"]), n(&r["seed_due"]), n(&r["pool_seed_q"])), (10 * USDC, 240 * USDC, 240 * USDC));
    let opened = ix.open(&ix.creator, &id).await?;
    opened.clone().into_result()?;
    assert_eq!(events(&opened, "fee_credited")[0]["amount"], "10000000");
    assert_eq!(legs(&ix).await[0]["amount"], "240000000");
    assert_eq!(ix.usdc_bal(ix.market.id()).await, 240 * USDC);
    assert_eq!(n(&ix.view("get_config", json!({})).await["platform_unpaid"]), 10 * USDC);
    ix.assert_solvent(&[&id]).await;
    let no = ix.call(&ix.creator, "withdraw_platform", json!({})).await?;
    assert!(has_code(&no, "R_NOT_AUTHORIZED"));
    ix.call(&ix.treasury, "withdraw_platform", json!({})).await?.into_result()?;
    assert_eq!(ix.usdc_bal(ix.treasury.id()).await, 10 * USDC);
    let again = ix.call(&ix.treasury, "withdraw_platform", json!({})).await?;
    assert!(has_code(&again, "R_NOTHING_TO_CLAIM"));
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn testnet_has_no_launch_fee_and_an_open_gate() -> anyhow::Result<()> {
    let ix = Ix::new("testnet", true).await?;
    let c = ix.view("get_config", json!({})).await;
    assert_eq!((c["creator_gate"].clone(), n(&c["launch_fee"])), (json!(false), 0));
    Ok(())
}

#[tokio::test]
async fn preview_reports_every_violation_and_the_exact_deposit() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let ok = ix.view("preview_instant", json!({ "params": params("PREV") })).await;
    assert_eq!(ok["ok"], true, "{ok}");
    assert_eq!((n(&ok["n_alloc"]), n(&ok["n_pool"]), n(&ok["pool_seed_q"])), (N_TOTAL / 20, N_TOTAL / 20 * 19, 250 * USDC));
    assert_eq!(n(&ok["required_deposit"]), ix.required_deposit().await);
    assert_eq!(ix.required_deposit().await, 131_250_000_000_000_000_000_000);
    let mut bad = params("KRUXA");
    bad["creator_alloc_bps"] = json!(2000);
    bad["vest_days"] = json!(5);
    bad["seed_q"] = json!("1000");
    let r = ix.view("preview_instant", json!({ "params": bad })).await;
    let codes: Vec<&str> = r["violations"].as_array().unwrap().iter().map(|v| v["code"].as_str().unwrap()).collect();
    for c in ["R_SYMBOL_RESERVED", "R_ALLOC", "R_VEST", "R_SEED_RANGE"] {
        assert!(codes.contains(&c), "{c} missing in {codes:?}");
    }
    assert_eq!(r["ok"], false);
    Ok(())
}

#[tokio::test]
async fn create_instant_refuses_each_rule_with_its_code() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let cases: Vec<(&str, Value)> = vec![
        ("R_SYMBOL_RESERVED", params("KRUXA")),
        ("R_SYMBOL", params("x")),
        ("R_ALLOC", json!({ "name": "A", "symbol": "ALCA", "creator_alloc_bps": 1001 })),
        ("R_VEST", json!({ "name": "A", "symbol": "VSTA", "vest_days": 29 })),
        ("R_VEST", json!({ "name": "A", "symbol": "VSTB", "cliff_days": 6 })),
        ("R_SEED_RANGE", json!({ "name": "A", "symbol": "SEDA", "seed_q": "99999999" })),
        ("R_SEED_RANGE", json!({ "name": "A", "symbol": "SEDB", "seed_q": "1000000001" })),
        (
            "R_FEE_TOTAL",
            json!({ "name": "A", "symbol": "FEEA", "fees": { "total_fee_bps": 201, "creator_bps": 5000, "platform_bps": 1500, "holders_bps": 1500, "lp_bps": 1000, "referral_bps": 1000, "opening_fee_start_bps": 0, "opening_decay_minutes": 0, "fee_vest_bps": 5000, "fee_vest_days": 90 } }),
        ),
    ];
    for (code, p) in cases {
        let r = ix.create_raw(&ix.creator, p.clone(), None).await?;
        assert!(has_code(&r, code), "{code} for {p}: {:?}", r.failures());
    }
    let short = ix.create_with_deposit(&ix.creator, params("SHRT"), None, ix.required_deposit().await - 1).await?;
    assert!(has_code(&short, "R_DEPOSIT"), "{:?}", short.failures());
    assert_eq!(ix.view("get_config", json!({})).await["next_launch_id"], ID0.to_string(), "nothing was created");
    Ok(())
}

#[tokio::test]
async fn one_launch_per_account_per_day_and_reserved_or_used_symbols() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("RATA"), None).await?;
    ix.predeploy_token("RATB", N_TOTAL).await?;
    let again = ix.create_raw(&ix.creator, params("RATB"), None).await?;
    assert!(has_code(&again, "R_RATE_LIMIT"), "{:?}", again.failures());
    let other = ix.user("other", 0).await?;
    let squat = ix.create_raw(&other, params("RATA"), None).await?;
    assert!(has_code(&squat, "R_SYMBOL"), "a used symbol is taken: {:?}", squat.failures());
    ix.call(&ix.owner, "reserve_symbol", json!({ "symbol": "RATB" })).await?.into_result()?;
    let reserved = ix.create_raw(&other, params("RATB"), None).await?;
    assert!(has_code(&reserved, "R_SYMBOL_RESERVED"), "{:?}", reserved.failures());
    let stranger_reserve = ix.call(&other, "reserve_symbol", json!({ "symbol": "RATC" })).await?;
    assert!(has_code(&stranger_reserve, "R_NOT_AUTHORIZED"));
    // a day later (one demo unit = 10 s) the same creator may launch again
    let t = n(&ix.inst(&id).await["created_at_ns"]) as u64;
    ix.wait_until(t + 11_000 * MS).await;
    ix.predeploy_token("RATD", N_TOTAL).await?;
    ix.create_raw(&ix.creator, params("RATD"), None).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn excess_deposit_is_sent_back() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.predeploy_token("EXCS", N_TOTAL).await?;
    let (need, before) = (ix.required_deposit().await, ix.creator.view_account().await?.balance.as_yoctonear());
    ix.create_with_deposit(&ix.creator, params("EXCS"), None, need + NearToken::from_near(5).as_yoctonear()).await?.into_result()?;
    let spent = before - ix.creator.view_account().await?.balance.as_yoctonear();
    assert!(spent < need + NearToken::from_millinear(500).as_yoctonear(), "spent {spent} vs required {need}");
    assert_eq!(n(&ix.inst(&ID0.to_string()).await["deposit_paid"]), need);
    Ok(())
}

#[tokio::test]
async fn a_failed_factory_call_frees_the_symbol_and_refunds_the_deposit() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let res = ix.create_raw(&ix.creator, params("FAIL"), None).await?;
    assert_eq!(events(&res, "instant_creation_failed").len(), 1, "{:?}", res.logs());
    let id = ID0.to_string();
    assert_eq!(ix.status(&id).await, "CreationFailed");
    let r = ix.inst(&id).await;
    let need = n(&r["deposit_paid"]);
    assert_eq!(
        n(&r["deposit_refundable"]),
        need - 80_000_000_000_000_000_000_000,
        "minus record storage and the factory deposit (review H-01)"
    );
    let stranger = ix.user("stranger", 0).await?;
    assert!(has_code(&ix.call(&stranger, "reclaim_deposit", lid(&id)).await?, "R_NOT_AUTHORIZED"));
    let before = ix.creator.view_account().await?.balance.as_yoctonear();
    let rr = ix.call_gas(&ix.creator, "reclaim_deposit", lid(&id), 30).await?;
    let after = ix.creator.view_account().await?.balance.as_yoctonear();
    assert!(
        after > before,
        "before {before} after {after}: {:#?} {:#?}",
        rr.logs(),
        rr.outcomes().iter().map(|o| (o.executor_id.to_string(), o.is_success(), o.tokens_burnt)).collect::<Vec<_>>()
    );
    let gained = after - before;
    assert!(gained > n(&r["deposit_refundable"]) - NearToken::from_millinear(50).as_yoctonear(), "gained {gained}");
    assert!(has_code(&ix.call(&ix.creator, "reclaim_deposit", lid(&id)).await?, "R_NOTHING_TO_CLAIM"));
    // the symbol is free again for anyone; the creator's own rate limit is not reset by a failure
    ix.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    let other = ix.user("other", 0).await?;
    ix.create_ready(&other, params("FAIL"), None).await?;
    Ok(())
}

#[tokio::test]
async fn a_supply_mismatch_fails_creation_and_keeps_the_factory_deposit() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.predeploy_token("SHRT", N_TOTAL - 1).await?;
    let res = ix.create_raw(&ix.creator, params("SHRT"), None).await?;
    assert_eq!(events(&res, "instant_creation_failed").len(), 1);
    let r = ix.inst(&ID0.to_string()).await;
    assert_eq!(r["status"], "CreationFailed");
    assert_eq!(n(&r["deposit_refundable"]), n(&r["deposit_paid"]) - 20_000_000_000_000_000_000_000 - 60_000_000_000_000_000_000_000);
    // the supply sits elsewhere: the launcher holds the right total but total_supply is larger
    let ix2 = Ix::new("demo", true).await?;
    ix2.predeploy_token("BIGG", N_TOTAL + 1).await?;
    let _ = ix2.create_raw(&ix2.creator, params("BIGG"), None).await?;
    assert_eq!(ix2.status(&ID0.to_string()).await, "CreationFailed");
    Ok(())
}

#[tokio::test]
async fn seed_is_refused_with_the_full_amount_returned() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("SEED"), None).await?;
    let other = ix.user("other", 1_000 * USDC).await?;
    ix.mint_usdc(ix.creator.id(), 1_000 * USDC).await?;
    let cases = [
        ("R_NOT_CREATOR", ix.seed(&other, &id, 250 * USDC).await?),
        ("R_SEED_AMOUNT", ix.seed(&ix.creator, &id, 250 * USDC + 1).await?),
        ("R_SEED_AMOUNT", ix.seed(&ix.creator, &id, 249 * USDC).await?),
        ("R_INSTANT_STATE", ix.seed(&ix.creator, "1999999999", 250 * USDC).await?),
    ];
    for (code, r) in cases {
        assert!(has_code(&r, code), "{code}: {:?}", r.logs());
    }
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 0, "nothing was kept");
    let bad = ix
        .creator
        .call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.launcher.id(), "amount": "250000000", "msg": "not json" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await?;
    assert!(has_code(&bad, "R_BAD_MSG"));
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, 1_000 * USDC);
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let dup = ix.seed(&ix.creator, &id, 250 * USDC).await?;
    assert!(has_code(&dup, "R_INSTANT_STATE"), "{:?}", dup.logs());
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 250 * USDC);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn a_refused_seed_leg_is_recredited_and_a_retry_sends_only_what_is_missing() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("RETR"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "refuse_seed").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let r = ix.inst(&id).await;
    assert_eq!((r["status"].clone(), n(&r["seed_due"]), n(&r["seed_inflight"]), n(&r["seed_sent"])), (json!("Handoff"), 250 * USDC, 0, 0));
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 250 * USDC, "the seed came back");
    assert_eq!(ix.view("get_phase", lid(&id)).await["next_action"], "retry_open_instant");
    ix.assert_solvent(&[&id]).await;
    // token leg refused after the seed was consumed: the seed stays in the market, only the token leg is retried
    set_mode(&ix, "refuse_token").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let r = ix.inst(&id).await;
    assert_eq!(
        (r["status"].clone(), n(&r["seed_sent"]), n(&r["tokens_sent"]), n(&r["tokens_inflight"])),
        (json!("Handoff"), 250 * USDC, 0, 0)
    );
    assert_eq!(n(&r["tokens_unsent"]), N_TOTAL / 20 * 19);
    ix.assert_solvent(&[&id]).await;
    set_mode(&ix, "accept").await;
    let before = legs(&ix).await.len();
    ix.open(&ix.creator, &id).await?.into_result()?;
    let after = legs(&ix).await;
    assert_eq!(after.len(), before + 1, "only the token leg was sent");
    assert_eq!(after.last().unwrap()["msg"]["op"], "open_pool_token");
    assert_eq!(ix.status(&id).await, "Open");
    let done = ix.open(&ix.creator, &id).await?;
    assert!(has_code(&done, "R_INSTANT_STATE"), "an open launch has nothing to send");
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn a_panicking_market_gets_everything_back() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("PANK"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "panic").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let r = ix.inst(&id).await;
    assert_eq!((n(&r["seed_due"]), n(&r["seed_inflight"]), n(&r["seed_sent"])), (250 * USDC, 0, 0));
    assert_eq!(ix.usdc_bal(ix.launcher.id()).await, 250 * USDC);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn open_instant_needs_a_seed_and_a_market() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("NOSD"), None).await?;
    assert!(has_code(&ix.open(&ix.creator, &id).await?, "R_INSTANT_STATE"));
    assert!(has_code(&ix.open(&ix.creator, "1999999999").await?, "R_NO_LAUNCH"));
    Ok(())
}

#[tokio::test]
async fn abort_refunds_the_seed_after_72h_only_while_the_market_consumed_none_of_it() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("ABRT"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    let usdc_before = ix.usdc_bal(ix.creator.id()).await;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "refuse_seed").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert!(has_code(&ix.call(&ix.creator, "abort_instant", lid(&id)).await?, "R_TOO_EARLY"));
    let seeded = n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded + 31_000 * MS).await;
    let stranger = ix.user("stranger", 0).await?;
    assert!(has_code(&ix.call(&stranger, "abort_instant", lid(&id)).await?, "R_NOT_AUTHORIZED"));
    let ab = ix.call(&ix.creator, "abort_instant", lid(&id)).await?;
    ab.clone().into_result()?;
    assert_eq!(events(&ab, "instant_aborted")[0]["refunded_seed"], "250000000");
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, usdc_before, "the whole seed came back");
    assert_eq!(ix.status(&id).await, "Aborted");
    ix.assert_solvent(&[&id]).await;
    assert!(has_code(&ix.open(&ix.creator, &id).await?, "R_INSTANT_STATE"), "an aborted launch cannot open");
    let c = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    assert!(has_code(&c, "R_INSTANT_STATE"), "nothing ever vests for an aborted launch");
    ix.call(&ix.creator, "reclaim_deposit", lid(&id)).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn il8_a_consumed_seed_can_never_be_aborted() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("IL8X"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "refuse_token").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(n(&ix.inst(&id).await["seed_sent"]), 250 * USDC);
    let seeded = n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded + 31_000 * MS).await;
    let r = ix.call(&ix.creator, "abort_instant", lid(&id)).await?;
    assert!(has_code(&r, "R_INSTANT_STATE"), "{:?}", r.failures());
    Ok(())
}

#[tokio::test]
async fn cancel_and_abandon_end_an_unseeded_launch() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("CNCL"), None).await?;
    let stranger = ix.user("stranger", 250 * USDC).await?;
    assert!(has_code(&ix.call(&stranger, "abandon_instant", lid(&id)).await?, "R_TOO_EARLY"), "a stranger waits 24 hours");
    let created = n(&ix.inst(&id).await["created_at_ns"]) as u64;
    ix.wait_until(created + 11_000 * MS).await;
    let ab = ix.call(&stranger, "abandon_instant", lid(&id)).await?;
    assert_eq!(events(&ab, "instant_abandoned").len(), 1, "{:?}", ab.failures());
    assert_eq!(ix.status(&id).await, "Abandoned");
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    let late_seed = ix.seed(&ix.creator, &id, 250 * USDC).await?;
    assert!(has_code(&late_seed, "R_INSTANT_STATE"));
    let r = ix.inst(&id).await;
    assert_eq!(
        n(&r["deposit_refundable"]),
        n(&r["deposit_paid"]) - 80_000_000_000_000_000_000_000,
        "minus record storage and the factory deposit"
    );
    ix.call(&ix.creator, "reclaim_deposit", lid(&id)).await?.into_result()?;
    let id2 = ix.user("c2", 0).await?;
    let second = ix.create_ready(&id2, params("CNC2"), None).await?;
    ix.call(&id2, "abandon_instant", lid(&second)).await?.into_result()?;
    assert_eq!(ix.status(&second).await, "Abandoned");
    Ok(())
}

#[tokio::test]
async fn pause_blocks_new_risk_but_never_the_exits() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let mut p = params("PAUS");
    p["vest_days"] = json!(30);
    let id = ix.launch_to_open(&ix.creator, p).await?;
    let tok = ix.token_id("PAUS");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let stranger = ix.user("stranger", 0).await?;
    assert!(has_code(&ix.call(&stranger, "pause", json!({})).await?, "R_NOT_AUTHORIZED"));
    ix.call(&ix.guardian, "pause", json!({})).await?.into_result()?;
    ix.predeploy_token("PAU2", N_TOTAL).await?;
    let other = ix.user("other", 0).await?;
    assert!(has_code(&ix.create_raw(&other, params("PAU2"), None).await?, "R_PAUSED"));
    let opened = n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 100_000 * MS).await;
    ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?.into_result()?;
    assert!(ix.bal(&tok, ix.creator.id()).await > 0, "claims stay open while paused");
    assert!(has_code(&ix.call(&ix.guardian, "unpause", json!({})).await?, "R_NOT_AUTHORIZED"), "only the owner unpauses");
    ix.call(&ix.guardian, "freeze", json!({})).await?.into_result()?;
    assert!(has_code(&ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?, "R_FROZEN"));
    ix.call(&ix.owner, "unpause", json!({})).await?.into_result()?;
    ix.create_raw(&other, params("PAU2"), None).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_seed_while_paused_is_refused_and_returned() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("PSED"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.call(&ix.guardian, "pause", json!({})).await?.into_result()?;
    let r = ix.seed(&ix.creator, &id, 250 * USDC).await?;
    assert!(has_code(&r, "R_PAUSED"));
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, 250 * USDC);
    Ok(())
}

#[tokio::test]
async fn the_aggregate_seed_cap_counts_only_unconsumed_seeds_and_is_timelocked_upward() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let (a, b) = (ix.user("a", 500 * USDC).await?, ix.user("b", 500 * USDC).await?);
    let (ida, idb) = (ix.create_ready(&a, params("CAPA"), None).await?, ix.create_ready(&b, params("CAPB"), None).await?);
    let stranger = ix.user("stranger", 0).await?;
    assert!(has_code(&ix.call(&stranger, "set_seed_cap", json!({ "kind": "aggregate", "value": "400000000" })).await?, "R_NOT_AUTHORIZED"));
    ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "400000000" })).await?.into_result()?;
    ix.seed(&a, &ida, 250 * USDC).await?.into_result()?;
    let r = ix.seed(&b, &idb, 250 * USDC).await?;
    assert!(has_code(&r, "R_CAP_GLOBAL"), "{:?}", r.logs());
    assert_eq!(ix.usdc_bal(b.id()).await, 500 * USDC);
    ix.open(&a, &ida).await?.into_result()?;
    ix.seed(&b, &idb, 250 * USDC).await?.into_result()?;
    // raising waits seven days
    let guardian_raise = ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "9000000000" })).await?;
    assert!(has_code(&guardian_raise, "R_NOT_AUTHORIZED"), "the guardian can only lower");
    ix.call(&ix.owner, "set_seed_cap", json!({ "kind": "aggregate", "value": "9000000000" })).await?.into_result()?;
    assert!(has_code(&ix.call(&stranger, "apply_seed_cap", json!({ "kind": "aggregate" })).await?, "R_NOT_YET"));
    assert!(has_code(&ix.call(&stranger, "apply_seed_cap", json!({ "kind": "per_launch" })).await?, "R_NOTHING"));
    Ok(())
}

#[tokio::test]
async fn a_separate_payout_recipient_gets_the_allocation_not_the_creator() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let recipient = ix.user("recipient", 0).await?;
    let mut p = params("RECP");
    p["vest_days"] = json!(30);
    let id = ix.create_ready(&ix.creator, p, Some(recipient.id())).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.inst(&id).await["payout_recipient"], json!(recipient.id()));
    assert_eq!(legs(&ix).await[0]["msg"]["payout_recipient"], json!(recipient.id()));
    let opened = n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 380_000 * MS).await;
    let by_creator = ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?;
    assert!(has_code(&by_creator, "R_NOT_AUTHORIZED"), "the creator is not the recipient");
    let tok = ix.token_id("RECP");
    ix.register_on_token(&tok, recipient.id()).await?;
    ix.call(&recipient, "claim_vested", json!({ "launch_id": id })).await?.into_result()?;
    assert_eq!(ix.bal(&tok, recipient.id()).await, N_TOTAL / 20);
    Ok(())
}

#[tokio::test]
async fn phase_config_and_recovery_views() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let c = ix.view("get_config", json!({})).await;
    assert_eq!((c["profile"].clone(), c["market"].clone(), c["paused"].clone()), (json!("demo"), json!(ix.market.id()), json!("None")));
    assert_eq!((n(&c["seed_min"]), n(&c["seed_max"]), n(&c["seed_cap_aggregate"])), (100 * USDC, 1_000 * USDC, 3_000 * USDC));
    assert!(ix.view("get_instant", lid("1000000000")).await.is_null());
    let id = ix.create_ready(&ix.creator, params("PHAS"), None).await?;
    let p = ix.view("get_phase", lid(&id)).await;
    assert_eq!((p["step"].clone(), p["next_action"].clone(), p["can_cancel"].clone()), (json!("seed"), json!("seed"), json!(true)));
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let p = ix.view("get_phase", lid(&id)).await;
    assert_eq!(
        (p["step"].clone(), p["next_action"].clone(), p["can_cancel"].clone()),
        (json!("open"), json!("open_instant"), json!(false))
    );
    let rec = ix.call(&ix.creator, "finalize_creation", lid(&id)).await?;
    assert!(has_code(&rec, "R_INSTANT_STATE"), "only a launch stuck in Creating can be finalized: {:?}", rec.failures());
    let v = ix.view("get_vesting", lid(&id)).await;
    assert_eq!((n(&v["unlocked"]), n(&v["claimable"])), (0, 0), "nothing vests before the pool is open");
    Ok(())
}
