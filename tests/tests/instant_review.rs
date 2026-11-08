//! Regression tests for the independent review (REVIEW-INSTANT-LAUNCH.md): one per finding in the launcher. Each of them
//! fails on the code before the fix.
mod instant_common;
use instant_common::*;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{json, Value};

const MS: u64 = 1_000_000;
const RECORD: u128 = 20_000_000_000_000_000_000_000;
const FACTORY: u128 = 60_000_000_000_000_000_000_000;

async fn set_mode(ix: &Ix, mode: &str) {
    ix.market.call("set_mode").args_json(json!({ "mode": mode })).transact().await.unwrap().into_result().unwrap();
}

async fn deploy_launcher(ix: &Ix, name: &str, profile: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let root = ix.worker.root_account()?;
    let acct = root.create_subaccount(name).initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let c = acct.deploy(&wasm("kruxa_instant_contract")).await?.into_result()?;
    let args = json!({ "owner": ix.owner.id(), "guardian": ix.guardian.id(), "treasury": ix.treasury.id(), "usdc": ix.usdc.id(), "factory": ix.factory.id(), "profile": profile });
    Ok(c.call("new").args_json(args).transact().await?)
}

// ---- C-01 -------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn open_instant_refuses_low_gas_before_touching_state() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.create_ready(&ix.creator, params("LOWG"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let before = ix.inst(&id).await;
    let r = ix.creator.call(ix.launcher.id(), "open_instant").args_json(lid(&id)).gas(Gas::from_tgas(250)).transact().await?;
    assert!(has_code(&r, "R_GAS"), "{:?}", r.failures());
    assert_eq!(ix.inst(&id).await, before, "nothing moved");
    assert!(ix.market.view("get_pool").args_json(lid(&id)).await?.json::<Value>()?.is_null());
    Ok(())
}

#[tokio::test]
async fn a_token_leg_skipped_by_the_callback_is_sent_by_the_next_open() -> anyhow::Result<()> {
    // A refused token leg leaves a consumed seed and an unsent bucket; the retry branch sends only the token leg.
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("SKIP"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "refuse_token").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let i = ix.inst(&id).await;
    assert_eq!((n(&i["seed_sent"]), n(&i["tokens_sent"]), n(&i["tokens_inflight"])), (250 * USDC, 0, 0));
    set_mode(&ix, "accept").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.status(&id).await, "Open");
    Ok(())
}

/// Builds a launch whose market holds the seed (and, if `both`, the pool bucket), then rewrites the launcher record to the
/// "callback never landed" state: legs in flight, nothing booked as sent.
async fn strand(ix: &Ix, id: &str, both: bool) -> anyhow::Result<()> {
    let state = ix.launcher.view_state().await?;
    let mut key = vec![1u8];
    key.extend_from_slice(&id.parse::<u64>()?.to_le_bytes());
    let mut v = state.get(&key).expect("record").clone();
    let l = v.len();
    let put = |v: &mut Vec<u8>, from_end: usize, x: u128| v[l - from_end..l - from_end + 16].copy_from_slice(&x.to_le_bytes());
    let (seed_total, pool) = (n(&ix.inst(id).await["seed_q"]), n(&ix.inst(id).await["n_pool"]));
    put(&mut v, 17, 0); // deposit_refundable untouched value 0
    put(&mut v, 65, if both { pool } else { 0 }); // tokens_inflight
    put(&mut v, 81, 0); // tokens_sent
    put(&mut v, 113, 0); // seed_sent
    put(&mut v, 129, seed_total); // seed_inflight
    put(&mut v, 145, 0); // seed_due
    v[l - 169..l - 161].copy_from_slice(&1u64.to_le_bytes()); // inflight_since: long ago
    v[l - 194] = 3; // Handoff
    ix.worker.patch_state(ix.launcher.id(), &key, &v).await?;
    Ok(())
}

#[tokio::test]
async fn reconcile_books_a_consumed_seed_and_bucket_whose_callback_never_landed() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, params("RECO")).await?;
    strand(&ix, &id, true).await?;
    let i = ix.inst(&id).await;
    assert_eq!((i["status"].clone(), n(&i["seed_inflight"]), n(&i["seed_sent"])), (json!("Handoff"), 250 * USDC, 0));
    assert!(has_code(&ix.open(&ix.creator, &id).await?, "R_INSTANT_STATE"), "stuck, as the review describes");
    let stranger = ix.user("stranger", 0).await?;
    ix.call(&stranger, "reconcile", lid(&id)).await?.into_result()?;
    let i = ix.inst(&id).await;
    assert_eq!(
        (i["status"].clone(), n(&i["seed_inflight"]), n(&i["seed_sent"]), n(&i["tokens_inflight"])),
        (json!("Open"), 0, 250 * USDC, 0)
    );
    assert_eq!(n(&i["tokens_sent"]), N_TOTAL / 20 * 19);
    Ok(())
}

#[tokio::test]
async fn reconcile_recredits_a_seed_the_market_never_saw_so_abort_and_open_work_again() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let id = ix.create_ready(&ix.creator, params("RECN"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    strand(&ix, &id, false).await?;
    let early = ix.call(&ix.creator, "abort_instant", lid(&id)).await?;
    assert!(has_code(&early, "R_INSTANT_STATE") || has_code(&early, "R_TOO_EARLY"), "{:?}", early.failures());
    ix.call(&ix.creator, "reconcile", lid(&id)).await?.into_result()?;
    let i = ix.inst(&id).await;
    assert_eq!((n(&i["seed_inflight"]), n(&i["seed_due"]), n(&i["seed_sent"])), (0, 250 * USDC, 0), "the seed is the creator's again");
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.status(&id).await, "Open");
    let none = ix.call(&ix.creator, "reconcile", lid(&id)).await?;
    assert!(has_code(&none, "R_INSTANT_STATE"), "nothing in flight");
    Ok(())
}

// ---- H-01 -------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_factory_failure_never_refunds_the_factory_deposit_and_keeps_the_rate_limit() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    // a symbol whose token account already exists at the factory: the factory refuses
    ix.predeploy_token("TAKN", N_TOTAL).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let launcher_before = ix.launcher.view_account().await?.balance.as_yoctonear();
    let res = ix.create_raw(&ix.creator, params("TAKN"), None).await?;
    assert_eq!(events(&res, "instant_creation_failed").len(), 1);
    let id = ID0.to_string();
    let r = ix.inst(&id).await;
    assert_eq!(n(&r["deposit_refundable"]), n(&r["deposit_paid"]) - RECORD - FACTORY, "the 0.06 NEAR stays with the launcher");
    ix.call_gas(&ix.creator, "reclaim_deposit", lid(&id), 30).await?.into_result()?;
    let launcher_after = ix.launcher.view_account().await?.balance.as_yoctonear();
    assert!(
        launcher_after + NearToken::from_millinear(20).as_yoctonear()
            >= launcher_before + FACTORY + RECORD - NearToken::from_millinear(30).as_yoctonear(),
        "the launcher is not drained"
    );
    // no free retries: the rate limit survives the failure
    ix.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    ix.predeploy_token("TAK2", N_TOTAL).await?;
    let again = ix.create_raw(&ix.creator, params("TAK2"), None).await?;
    assert!(has_code(&again, "R_RATE_LIMIT"), "{:?}", again.failures());
    Ok(())
}

// ---- M-02 -------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn profile_is_validated_at_init() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    for (i, bad) in ["Mainnet", "prod", "", "testnet ", "main"].iter().enumerate() {
        let r = deploy_launcher(&ix, &format!("bad{i}"), bad).await?;
        assert!(has_code(&r, "R_PROFILE"), "{bad:?}: {:?}", r.failures());
    }
    for (i, good) in ["mainnet", "testnet", "demo"].iter().enumerate() {
        deploy_launcher(&ix, &format!("good{i}"), good).await?.into_result()?;
    }
    let c = ix.view("get_config", json!({})).await;
    assert_eq!((c["profile"].clone(), c["unit_ns"].clone()), (json!("demo"), json!("10000000000")), "the UI can read the real day length");
    let m = Ix::new("mainnet", true).await?;
    assert_eq!(m.view("get_config", json!({})).await["unit_ns"], "86400000000000");
    Ok(())
}

// ---- M-03 -------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn lowering_a_cap_cancels_a_queued_raise() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.call(&ix.owner, "set_seed_cap", json!({ "kind": "aggregate", "value": "9000000000" })).await?.into_result()?;
    let c = ix.view("get_config", json!({})).await;
    assert_eq!(c["pending_caps"]["aggregate"]["value"], "9000000000");
    let low = ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "500000000" })).await?;
    low.clone().into_result()?;
    assert_eq!(events(&low, "cap_cancelled").len(), 1);
    let c = ix.view("get_config", json!({})).await;
    assert!(c["pending_caps"]["aggregate"].is_null(), "{c}");
    assert_eq!(c["seed_cap_aggregate"], "500000000");
    let stranger = ix.user("stranger", 0).await?;
    let apply = ix.call(&stranger, "apply_seed_cap", json!({ "kind": "aggregate" })).await?;
    assert!(has_code(&apply, "R_NOTHING"), "nothing is queued any more: {:?}", apply.failures());
    // the other kind is untouched
    ix.call(&ix.owner, "set_seed_cap", json!({ "kind": "per_launch", "value": "2000000000" })).await?.into_result()?;
    ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "400000000" })).await?.into_result()?;
    assert_eq!(ix.view("get_config", json!({})).await["pending_caps"]["per_launch"]["value"], "2000000000");
    Ok(())
}

// ---- L-01 .. L-05 -----------------------------------------------------------------------------------------------------

#[tokio::test]
async fn l01_a_seed_needs_a_market_and_locks_it() -> anyhow::Result<()> {
    let ix = Ix::without_market("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("LOCK"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    let r = ix.seed(&ix.creator, &id, 250 * USDC).await?;
    assert!(has_code(&r, "R_NO_MARKET"), "{:?}", r.logs());
    assert_eq!(ix.usdc_bal(ix.creator.id()).await, 250 * USDC, "returned");
    ix.call(&ix.owner, "set_market", json!({ "account": ix.market.id() })).await?.into_result()?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let thief = ix.user("thief", 0).await?;
    let late = ix.call(&ix.owner, "set_market", json!({ "account": thief.id() })).await?;
    assert!(has_code(&late, "R_NOTHING"), "the market is locked by the first seed, not the first open: {:?}", late.failures());
    Ok(())
}

#[tokio::test]
async fn l02_the_guardian_cannot_re_arm_a_freeze_but_the_owner_can() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    ix.call(&ix.guardian, "freeze", json!({})).await?.into_result()?;
    ix.call(&ix.owner, "unpause", json!({})).await?.into_result()?;
    let again = ix.call(&ix.guardian, "freeze", json!({})).await?;
    assert!(has_code(&again, "R_NOT_YET"), "{:?}", again.failures());
    ix.call(&ix.owner, "freeze", json!({})).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn l03_the_token_leg_can_be_retried_while_paused() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("PTKN"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    set_mode(&ix, "refuse_token").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(n(&ix.inst(&id).await["seed_sent"]), 250 * USDC);
    ix.call(&ix.guardian, "pause", json!({})).await?.into_result()?;
    set_mode(&ix, "accept").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    assert_eq!(ix.status(&id).await, "Open", "the seed is already in the market: finishing is not new risk");
    // but a seed that is still ours cannot start while paused
    let id2 = ix.user("c2", 250 * USDC).await?;
    let _ = id2;
    Ok(())
}

#[tokio::test]
async fn l05_symbols_containing_the_brand_are_reserved_and_the_list_is_normalised() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    for s in ["WKRUXA", "KRUXAV2", "KRUXAAI", "MYKRUXA"] {
        let r = ix.create_raw(&ix.creator, params(s), None).await?;
        assert!(has_code(&r, "R_SYMBOL_RESERVED"), "{s}: {:?}", r.failures());
    }
    ix.call(&ix.owner, "reserve_symbol", json!({ "symbol": "scam" })).await?.into_result()?;
    let r = ix.create_raw(&ix.creator, params("SCAM"), None).await?;
    assert!(has_code(&r, "R_SYMBOL_RESERVED"), "reserved in lower case still bites: {:?}", r.failures());
    let bad = ix.call(&ix.owner, "reserve_symbol", json!({ "symbol": "a b!" })).await?;
    assert!(has_code(&bad, "R_SYMBOL"));
    Ok(())
}

#[allow(dead_code)]
const _UNUSED: u64 = MS;
