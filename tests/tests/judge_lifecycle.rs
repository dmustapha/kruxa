//! The narrated judge lifecycle (J-1): one short, readable run of the real core wasm in the sandbox, one line per step.
//! Run: `cargo test -p kruxa-tests --test judge_lifecycle -- --nocapture`. Prints `JUDGE LIFECYCLE PASS` when every step held.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> serde_json::Value {
    json!({ "launch_id": id.to_string() })
}

#[tokio::test]
async fn judge_lifecycle_narrated() -> anyhow::Result<()> {
    let env = Env::new().await?;

    // PASS launch: 13 backers commit 30 USDC each, one walks out, 12 remain at 360 USDC against a 350 soft cap and 10 funders.
    let id = env.create_launch(&params("PASS")).await?;
    println!("STEP 1 create: launch {id} is Open (token created and verified)");
    let mut users = Vec::new();
    for i in 0..13 {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
        users.push(u);
    }
    println!("STEP 2 commit: 13 backers committed 30 USDC each, total {} micro-USDC", env.state(id).await["total_active"]);
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    let st = env.state(id).await;
    assert_eq!(st["total_active"], (360 * USDC).to_string());
    println!(
        "STEP 3 walk: backer u0 walked; principal back {} micro-USDC of 1000000000, no fee; total_active now {}",
        env.usdc_balance(users[0].id()).await,
        st["total_active"]
    );
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);

    let early = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(has_code(&early, "R_TOO_EARLY"));
    println!("STEP 4 settle too early: refused with R_TOO_EARLY");
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?);
    println!("STEP 5 settle: verdict PASS, status {}", env.state(id).await["status"]);
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    for k in ["l1_ok", "l3_ok", "l4_ok", "i2_ok", "i3_ok", "i4_ok", "i5_ok"] {
        assert_eq!(inv[k], true, "{k}: {inv}");
    }
    println!("STEP 6 ledger identities L1 L3 L4 I2 to I5 all true");
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    let led = env.view("get_ledger", lid(id)).await;
    let all = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": led["stream_total"] }), ZERO).await;
    assert!(has_code(&all, "STREAM_CAP"));
    println!("STEP 7 stream: withdrawing the whole stream at once is refused with STREAM_CAP");

    // FAIL launch: 5 backers at 150 USDC total, below the soft cap, everyone gets the full principal back.
    let id2 = env.create_launch(&params("FAIL")).await?;
    let mut backers = Vec::new();
    for i in 0..5 {
        let u = env.user(&format!("f{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id2, 30 * USDC, None).await.into_result()?;
        backers.push(u);
    }
    env.advance_to(id2, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id2), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    for u in &backers {
        env.call(u, "claim_refund", json!({ "launch_id": id2.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    }
    println!("STEP 8 FAIL launch: status {}, all 5 backers refunded the full 30 USDC", env.state(id2).await["status"]);
    println!("JUDGE LIFECYCLE PASS (8 steps)");
    Ok(())
}
