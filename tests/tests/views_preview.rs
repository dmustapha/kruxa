//! App-spec views (IR-C1 to IR-C4): `preview_charter`, `get_phase`, `preview_settlement`, `declared_wallets`, `get_book_hash`.
//! All are view-only; none changes state.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn codes(v: &Value) -> Vec<String> {
    v["violations"].as_array().unwrap().iter().map(|x| x["code"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn preview_charter_accepts_the_standard_preset_and_names_every_hostile_rule() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let good = params("PRVA");
    let r = env.view("preview_charter", json!({ "params": good, "creator": env.creator.id() })).await;
    assert_eq!(r["ok"], true, "{r}");
    let want: String = env.core.view("required_deposit").args_json(json!({ "params": good })).await?.json()?;
    assert_eq!(r["required_deposit"], want, "same price as the required_deposit view");
    let mut bad = params("PRVB");
    (bad.creator_bps, bad.backer_bps, bad.sale_bps, bad.lp_bps, bad.commit_secs) = (1_900, 700, 5_400, 2_000, 0);
    let r = env.view("preview_charter", json!({ "params": bad, "creator": env.creator.id() })).await;
    assert_eq!(r["ok"], false);
    let c = codes(&r);
    assert!(c.contains(&"R_ALLOC".to_string()) && c.contains(&"R_WINDOW".to_string()), "{c:?}");
    assert!(r["required_deposit"].is_null(), "no price for a refused charter");
    assert_eq!(env.state(1).await, Value::Null, "a preview creates nothing");
    Ok(())
}

#[tokio::test]
async fn preview_charter_reports_the_creator_gate_on_the_mainnet_profile() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    let p = TrialParams::example("PRVC");
    let other = env.preview_codes(&p, env.creator.id()).await;
    assert!(other.contains(&"R_CREATOR_GATE".to_string()), "{other:?}");
    let owner = env.preview_codes(&p, env.owner.id()).await;
    assert!(!owner.contains(&"R_CREATOR_GATE".to_string()), "{owner:?}");
    Ok(())
}

#[tokio::test]
async fn get_phase_follows_the_clock_and_agrees_with_get_state() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PRVD")).await?;
    let p = env.view("get_phase", lid(id)).await;
    assert_eq!(p["phase"], "Open");
    assert_eq!(p["phase"], env.state(id).await["phase"]);
    assert!(p["opens_at"].is_string() && p["commit_end"].is_string() && p["walk_end"].is_string());
    env.advance_to(id, "Ready").await;
    assert_eq!(env.view("get_phase", lid(id)).await["phase"], "Ready");
    assert!(env.view("get_phase", lid(99)).await.is_null());
    Ok(())
}

async fn commit_n(env: &Env, id: u64, n: usize, each: u128) -> anyhow::Result<Vec<near_workspaces::Account>> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, each, None).await.into_result()?;
        users.push(u);
    }
    Ok(users)
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn preview_settlement_equals_the_real_settlement_oversubscribed() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PRVE")).await?;
    let users = commit_n(&env, id, 14, 100 * USDC).await?; // 1,400 > hard cap 1,000
    let holder = format!("near:{}", users[0].id());
    let args = json!({ "launch_id": id.to_string(), "holder": holder });
    let pre = env.view("preview_settlement", args.clone()).await;
    assert_eq!(pre["ok"], true, "{pre}");
    assert_eq!((pre["provisional"].as_bool(), pre["would_pass"].as_bool()), (Some(true), Some(true)));
    assert_eq!((num(&pre, "spend"), num(&pre, "refund")), (71_428_572, 28_571_428));
    assert_eq!(num(&pre, "soft_cap_margin"), 1_400 * USDC - 350 * USDC);
    assert_eq!(pre["funders_margin"], 14 - 10);
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    let pos = env.view("get_position", args.clone()).await;
    assert_eq!(
        (num(&pre, "tokens"), num(&pre, "bonus"), num(&pre, "spend")),
        (num(&pos, "tokens_entitled"), num(&pos, "bonus_entitled"), num(&pos, "spent"))
    );
    let after = env.view("preview_settlement", args).await;
    assert_eq!(
        (after["provisional"].as_bool(), num(&after, "tokens")),
        (Some(false), num(&pos, "tokens_entitled")),
        "after settlement it reports the real numbers"
    );
    Ok(())
}

#[tokio::test]
async fn preview_settlement_says_fail_below_the_soft_cap_and_handles_strangers() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PRVF")).await?;
    let users = commit_n(&env, id, 3, 30 * USDC).await?;
    let pre = env.view("preview_settlement", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) })).await;
    assert_eq!((pre["would_pass"].as_bool(), pre["ok"].as_bool()), (Some(false), Some(true)), "{pre}");
    assert_eq!(pre["refund"], (30 * USDC).to_string(), "a failing launch refunds everything");
    assert_eq!(pre["soft_cap_margin"], format!("-{}", 350 * USDC - 90 * USDC));
    let none = env.view("preview_settlement", json!({ "launch_id": id.to_string(), "holder": "near:nobody.near" })).await;
    assert_eq!((none["ok"].as_bool(), none["code"].as_str()), (Some(false), Some("R_NO_POSITION")));
    let junk = env.view("preview_settlement", json!({ "launch_id": id.to_string(), "holder": "bogus" })).await;
    assert_eq!(junk["code"], "R_DELIVER");
    Ok(())
}

#[tokio::test]
async fn declared_wallets_and_book_hash() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = env.user("payee3", 0).await?;
    let id = env.create_launch_to(&env.creator, &params("PRVG"), Some(payee.id())).await?;
    let w = env.view("declared_wallets", lid(id)).await;
    assert_eq!(w["creator"], json!(env.creator.id()));
    assert_eq!(w["payout_recipient"], json!(payee.id()));
    assert_eq!(w["wallets"], json!([env.creator.id(), payee.id()]));
    let same = env.create_launch_to(&env.owner, &params("PRVH"), None).await?;
    assert_eq!(env.view("declared_wallets", lid(same)).await["wallets"], json!([env.owner.id()]), "creator = recipient lists once");
    let u = env.user("u-book", 100 * USDC).await?;
    env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
    let st = env.state(id).await;
    assert_eq!(env.view("get_book_hash", lid(id)).await, st["book_hash"]);
    assert_ne!(st["book_hash"], "0".repeat(64), "a commit moved the hash");
    Ok(())
}
