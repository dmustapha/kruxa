//! PRD gap 17 on the market: the FEE_VEST_CAP error string on an over-large creator claim, and the `get_epochs` view.
//! Run `scripts/market-build.sh` first (the market wasm is not part of `scripts/build.sh`).
mod market_common;
use market_common::*;
use serde_json::json;

const ID: u64 = 1;

#[tokio::test]
async fn claiming_more_than_vested_reverts_fee_vest_cap_and_claiming_the_vested_part_works() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 900 * USDC, 1).await?.into_result()?;
    let status = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    let (claimable, accrued) = (n(&status["claimable"]), n(&status["accrued"]));
    assert!(claimable > 0 && claimable < accrued, "half of the slice is still vesting: {status}");
    let greedy = mk
        .creator
        .call(mk.market.id(), "claim")
        .args_json(json!({ "launch_id": "1", "amount": accrued.to_string() }))
        .gas(GAS)
        .transact()
        .await?;
    assert!(has_code(&greedy, "FEE_VEST_CAP"), "{:?}", greedy.failures());
    let msg = format!("{:?}", greedy.failures());
    assert!(
        msg.contains("requested") && msg.contains("claimable") && msg.contains("still vesting"),
        "the message names the amounts: {msg}"
    );
    let before = mk.bal(&mk.usdc, mk.creator.id()).await;
    let ok = mk
        .creator
        .call(mk.market.id(), "claim")
        .args_json(json!({ "launch_id": "1", "amount": claimable.to_string() }))
        .gas(GAS)
        .transact()
        .await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(mk.bal(&mk.usdc, mk.creator.id()).await - before, claimable);
    mk.assert_solvent(&[ID]).await;
    Ok(())
}

#[tokio::test]
async fn get_epochs_lists_each_vesting_epoch_with_its_vested_part() -> anyhow::Result<()> {
    let mk = Mk::new(None).await?;
    mk.open_pool(ID).await?;
    assert!(mk.view("get_epochs", json!({ "launch_id": "99" })).await.is_null());
    let empty = mk.view("get_epochs", json!({ "launch_id": "1" })).await;
    assert_eq!(empty["epochs"].as_array().map(Vec::len), Some(0));
    let alice = mk.user("alice", 2_000 * USDC).await?;
    mk.buy(&alice, ID, 900 * USDC, 1).await?.into_result()?;
    let e = mk.view("get_epochs", json!({ "launch_id": "1" })).await;
    let rows = e["epochs"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "{e}");
    let status = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    assert_eq!(n(&rows[0]["accrued"]), n(&status["accrued"]));
    assert_eq!(n(&rows[0]["vested"]) + n(&e["folded_unlocked"]), n(&status["unlocked"]), "the epoch rows add up to creator_status");
    assert_eq!((e["vest_days"].as_u64(), e["vest_bps"].as_u64()), (Some(90), Some(5_000)));
    Ok(())
}
