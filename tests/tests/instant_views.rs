//! Launcher views of CO-7 2.13: `instants_by_creator`, `declared_wallets`, `solvency_report`, and the creator index behind them.
//! Build first: `scripts/instant-build.sh`.
mod instant_common;
use instant_common::*;
use near_workspaces::Account;
use serde_json::{json, Value};

const SEC: u64 = 1_000_000_000;

fn ids(page: &Value) -> Vec<String> {
    page["items"].as_array().unwrap().iter().map(|i| i["launch_id"].as_str().unwrap().to_string()).collect()
}

/// One launch per day per creator, and the demo day is 10 s: wait it out between two launches of the same account.
async fn next_day(ix: &Ix) {
    let t = ix.now().await + 11 * SEC;
    ix.wait_until(t).await;
}

async fn by_creator(ix: &Ix, who: &Account, from: Option<u64>, limit: Option<u64>) -> Value {
    ix.view("instants_by_creator", json!({ "creator": who.id(), "from_index": from, "limit": limit })).await
}

#[tokio::test]
async fn instants_by_creator_lists_oldest_first_pages_and_follows_status() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let bob = ix.user("bob", 0).await?;
    let a = ix.create_ready(&ix.creator, params("VWA"), None).await?;
    let b = ix.create_ready(&bob, params("VWB"), None).await?;
    next_day(&ix).await;
    let c = ix.create_ready(&ix.creator, params("VWC"), None).await?;
    next_day(&ix).await;
    let d = ix.create_ready(&ix.creator, params("VWD"), None).await?;
    let all = by_creator(&ix, &ix.creator, None, None).await;
    assert_eq!((ids(&all), all["total"].clone()), (vec![a.clone(), c.clone(), d.clone()], json!("3")));
    assert_eq!(all["items"][0]["symbol"], "VWA");
    assert_eq!(all["items"][0]["token"], json!(ix.token_id("VWA")));
    assert_eq!(all["items"][0]["status"], "TokenReady");
    assert_eq!(ids(&by_creator(&ix, &bob, None, None).await), vec![b.clone()], "another creator has its own list");
    let p1 = by_creator(&ix, &ix.creator, Some(0), Some(2)).await;
    let p2 = by_creator(&ix, &ix.creator, Some(2), Some(2)).await;
    assert_eq!((ids(&p1), ids(&p2)), (vec![a.clone(), c.clone()], vec![d.clone()]));
    assert!(ids(&by_creator(&ix, &ix.creator, Some(3), Some(10)).await).is_empty());
    assert!(ids(&by_creator(&ix, &ix.creator, Some(u64::MAX), Some(u64::MAX)).await).is_empty());
    let nobody = ix.user("nobody", 0).await?;
    assert_eq!(by_creator(&ix, &nobody, None, None).await["total"], "0");
    // the brief info follows the record
    ix.call(&ix.creator, "abandon_instant", lid(&a)).await?.into_result()?;
    assert_eq!(by_creator(&ix, &ix.creator, None, None).await["items"][0]["status"], "Abandoned");
    Ok(())
}

#[tokio::test]
async fn declared_wallets_name_the_creator_and_the_payout_recipient() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let rec = ix.user("recipient", 0).await?;
    let same = ix.create_ready(&ix.creator, params("DWA"), None).await?;
    next_day(&ix).await;
    let split = ix.create_ready(&ix.creator, params("DWB"), Some(rec.id())).await?;
    let w = ix.view("declared_wallets", lid(&same)).await;
    assert_eq!(w["wallets"], json!([ix.creator.id()]), "once when they are the same account");
    let w = ix.view("declared_wallets", lid(&split)).await;
    assert_eq!((w["creator"].clone(), w["payout_recipient"].clone()), (json!(ix.creator.id()), json!(rec.id())));
    assert_eq!(w["wallets"], json!([ix.creator.id(), rec.id()]));
    assert!(ix.view("declared_wallets", lid("1999999999")).await.is_null());
    Ok(())
}

#[tokio::test]
async fn solvency_report_expected_custody_never_exceeds_the_real_balances_and_matches_at_rest() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("SLV"), None).await?;
    ix.mint_usdc(ix.creator.id(), 250 * USDC).await?;
    ix.seed(&ix.creator, &id, 250 * USDC).await?.into_result()?;
    let token = ix.token_id("SLV");
    for (ft, label) in [(ix.usdc.id().clone(), "usdc"), (token.clone(), "token")] {
        let r = ix.view("solvency_report", json!({ "token_id": ft })).await;
        assert_eq!(r["token"], json!(ft));
        assert_eq!(n(&r["owed_total"]), 0);
        let (expected, real) = (n(&r["expected_custody"]), ix.bal(&ft, ix.launcher.id()).await);
        assert_eq!(expected, real, "{label}: at rest the launcher holds exactly what it expects");
    }
    assert!(n(&ix.view("solvency_report", json!({ "token_id": token })).await["expected_custody"]) == N_TOTAL);
    ix.assert_solvent(&[&id]).await;
    Ok(())
}

#[tokio::test]
async fn the_creator_index_backfill_is_idempotent_and_bounded() -> anyhow::Result<()> {
    let ix = Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, params("IDX"), None).await?;
    let anyone = ix.user("anyone", 0).await?;
    let added: u64 = ix.call(&anyone, "index_creators", json!({ "from_launch_id": id, "limit": 5 })).await?.json()?;
    assert_eq!(added, 0, "a launch created by this build is indexed already");
    assert_eq!(by_creator(&ix, &ix.creator, None, None).await["total"], "1");
    for bad in [
        json!({ "from_launch_id": "5", "limit": 5 }),
        json!({ "from_launch_id": id, "limit": 0 }),
        json!({ "from_launch_id": id, "limit": 51 }),
    ] {
        let r = ix.call(&anyone, "index_creators", bad).await?;
        assert!(has_code(&r, "R_NOTHING"), "{:?}", r.failures());
    }
    Ok(())
}
