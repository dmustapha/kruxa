//! D-2 (W1-DC-18, GR-18): `payout_recipient` is a view-only alias of the Charter's `stream_recipient`.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use serde_json::json;

#[tokio::test]
async fn views_show_payout_recipient_equal_to_the_recipient_set_at_create_trial() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = env.user("payee", 0).await?;
    let id = env.create_launch_to(&env.creator, &TrialParams::example("PAYA"), Some(payee.id())).await?;
    let (charter, state) = (env.view("get_charter", json!({ "launch_id": id.to_string() })).await, env.state(id).await);
    assert_eq!(charter["payout_recipient"], json!(payee.id()), "get_charter");
    assert_eq!(state["payout_recipient"], json!(payee.id()), "get_state");
    assert_eq!(charter["stream_recipient"], charter["payout_recipient"], "the old key stays and agrees");
    Ok(())
}

#[tokio::test]
async fn the_recipient_defaults_to_the_creator() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&TrialParams::example("PAYB")).await?;
    let charter = env.view("get_charter", json!({ "launch_id": id.to_string() })).await;
    assert_eq!(charter["payout_recipient"], json!(env.creator.id()));
    assert_eq!(env.state(id).await["payout_recipient"], json!(env.creator.id()));
    Ok(())
}

#[tokio::test]
async fn charter_created_carries_the_fields_the_indexer_needs() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = env.user("payee2", 0).await?;
    let p = TrialParams::example("PAYC");
    env.create_launch_to(&env.creator, &p, Some(payee.id())).await?;
    let events = env.events.borrow();
    let e = events.iter().find(|e| e["event"] == "charter_created").expect("charter_created event");
    let d = &e["data"][0];
    assert_eq!(d["soft_cap"], p.soft_cap.to_string());
    assert_eq!(
        (d["min_funders"].as_u64(), d["stream_days"].as_u64(), d["token_decimals"].as_u64()),
        (Some(p.min_funders as u64), Some(p.stream_days as u64), Some(6))
    );
    assert_eq!(d["payout_recipient"], json!(payee.id()));
    assert_eq!((d["name"].as_str(), d["total_supply"].as_str()), (Some(p.name.as_str()), Some("1000000000000000")));
    Ok(())
}
