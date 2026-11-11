//! End-to-end lifecycle against the sandbox: create, commit, Walk, settle PASS (under- and oversubscribed), settle FAIL, refunds, claims.
use kruxa_logic::{fold_book, hex, BookEvent, TrialParams};
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

async fn fill(env: &Env, id: u64, n: usize, each: u128) -> Vec<Account> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await.unwrap();
        let r = env.commit_native(&u, id, each, None).await;
        assert!(r.is_success(), "commit {i} failed: {:?}", r.failures());
        users.push(u);
    }
    users
}

/// The hash stored at the verdict equals the hash a judge recomputes from `get_verdict_inputs`, and is never all zeros.
async fn assert_same_inputs_hash(env: &Env, id: u64) {
    let stored = env.view("get_settlement", lid(id)).await["inputs_hash"].as_str().unwrap().to_string();
    let live = env.view("get_verdict_inputs", lid(id)).await["inputs_hash"].as_str().unwrap().to_string();
    assert_eq!(stored, live, "settlement.inputs_hash must equal the recomputed inputs hash");
    assert_ne!(stored, "0".repeat(64));
}

/// P-RECOMPUTE against the real contract: the `contributed` / `walked` events it emitted, folded from scratch by the pure crate,
/// reproduce its stored `book_hash`, `total_active` and `active_funders`. `KRUXA_RECORD_FIXTURES=1` saves the log for `kruxa-sim fold`.
async fn assert_book_replays_to_the_stored_hash(env: &Env, id: u64) {
    let log = env.book_log(id);
    let events: Vec<BookEvent> = log
        .iter()
        .map(|line| {
            let e: Value = serde_json::from_str(line).unwrap();
            let d = &e["data"][0];
            let holder = d["holder"].as_str().unwrap().to_string();
            match e["event"].as_str().unwrap() {
                "contributed" => BookEvent::Contributed { holder, net: num(d, "net") },
                _ => BookEvent::Walked { holder, amount: num(d, "amount") },
            }
        })
        .collect();
    let folded = fold_book(&events).expect("the contract's own log must fold");
    let st = env.state(id).await;
    assert_eq!(hex(&folded.book_hash), st["book_hash"].as_str().unwrap(), "replayed book_hash == stored book_hash");
    assert_eq!(
        (folded.total_active.to_string(), u64::from(folded.active_funders)),
        (st["total_active"].as_str().unwrap().to_string(), st["active_funders"].as_u64().unwrap())
    );
    assert_eq!(
        env.view("get_settlement", lid(id)).await["book_hash"].as_str(),
        st["book_hash"].as_str(),
        "the settlement froze the same hash"
    );
    if std::env::var("KRUXA_RECORD_FIXTURES").is_ok() {
        let dir = format!("{}/../fixtures/events", env!("CARGO_MANIFEST_DIR"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/lifecycle.jsonl"), log.join("\n") + "\n").unwrap();
        std::fs::write(format!("{dir}/lifecycle.book_hash"), format!("{}\n", hex(&folded.book_hash))).unwrap();
    }
}

/// W1-DC-4: the seven identities by name, all true. (`Env` also asserts `all_ok` and a legal stage move after every call.)
async fn assert_all_identities(env: &Env, id: u64) {
    let inv = env.view("get_invariants", lid(id)).await;
    for k in ["l1_ok", "l3_ok", "l4_ok", "i2_ok", "i3_ok", "i4_ok", "i5_ok"] {
        assert_eq!(inv[k], true, "{k} must be true: {inv}");
    }
}

async fn settle_all(env: &Env, id: u64) {
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result().unwrap();
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()
        .unwrap();
}

#[tokio::test]
async fn create_trial_opens_after_token_verification() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    let st = env.state(id).await;
    assert_eq!((st["status"].as_str(), st["phase"].as_str()), (Some("Open"), Some("Open")));
    assert_eq!(st["token"], format!("abcd.{}", env.factory.id()));
    Ok(())
}

#[tokio::test]
async fn pass_undersubscribed_full_money_path() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    fill(&env, id, 12, 30 * USDC).await; // 360 USDC >= soft cap 350, 12 funders >= 10
    assert_eq!(env.state(id).await["total_active"], (360 * USDC).to_string());
    let early = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(has_code(&early, "R_TOO_EARLY"), "settle before walk_end must fail");
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?, "settle must PASS");
    let again = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(again.json::<bool>()?, "settle is idempotent");
    assert_same_inputs_hash(&env, id).await;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "launch_fee_due"), num(&led, "excess_pool")), (10 * USDC, 0));
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    let all = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": led["stream_total"] }), ZERO).await;
    assert!(has_code(&all, "STREAM_CAP"), "withdraw-all must hit STREAM_CAP");
    Ok(())
}

#[tokio::test]
async fn pass_oversubscribed_four_buckets_refunds_and_claims() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("OVER")).await?;
    let users = fill(&env, id, 14, 100 * USDC).await; // 1,400 > hard cap 1,000
    settle_all(&env, id).await;
    let st = env.view("get_settlement", lid(id)).await;
    assert_eq!((num(&st, "accepted"), num(&st, "excess_pool")), (1_000 * USDC, 400 * USDC));
    let (spend, refund) = (71_428_572u128, 28_571_428u128); // S1-B rounding rules: spend ceil, refund floor
    let before = env.usdc_balance(users[0].id()).await;
    env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) }), ZERO)
        .await
        .into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await - before, refund, "anyone may push a refund; destination is fixed");
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) })).await;
    assert_eq!((num(&pos, "spent"), pos["conserved"].as_bool()), (spend, Some(true)));
    let noop = env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(noop.is_success() && !noop.json::<bool>()?, "second refund call is a harmless no-op");
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    // tokens: the holder registers on the launch token first, then claims sale tokens (+ the tiny vested bonus)
    env.register_on_token("OVER", users[2].id()).await?;
    env.call(&users[2], "claim_tokens", lid(id), ONE).await.into_result()?;
    let got = env.token_balance("OVER", users[2].id()).await;
    let expected = 42_857_142_857_142u128; // floor(100e6 * 600e12 / 1400e6)
    assert!(got >= expected && got < expected + 1_000_000_000, "got {got}");
    Ok(())
}

#[tokio::test]
async fn fail_below_soft_cap_refunds_everyone_then_dissolves_and_returns_bond() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FAIL")).await?;
    let users = fill(&env, id, 5, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    assert_eq!(env.state(id).await["status"], "Failed(3)");
    // regression (found in Phase 1): a FAIL used to store an all-zero inputs_hash, so `verify` reported MISMATCH on every failed launch
    assert_same_inputs_hash(&env, id).await;
    for u in &users {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    }
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    let bal = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(id), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > bal, "bond returned");
    assert_eq!(env.state(id).await["status"], "Dissolved");
    Ok(())
}

#[tokio::test]
async fn cancel_trial_makes_everyone_refundable_at_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("CNCL")).await?;
    let users = fill(&env, id, 3, 50 * USDC).await;
    assert!(has_code(&env.call(&users[0], "cancel_trial", lid(id), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.creator, "cancel_trial", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.state(id).await["status"], "Failed(4)");
    env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);
    Ok(())
}

#[tokio::test]
async fn walk_shrinks_the_book_refunds_and_closes_at_walk_end() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("WALK")).await?;
    let users = fill(&env, id, 2, 40 * USDC).await;
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    let st = env.state(id).await;
    assert_eq!((st["total_active"].as_str(), st["active_funders"].as_u64()), (Some("40000000"), Some(1)));
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC, "principal returned in full, no fee");
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_NO_POSITION"));
    assert!(env.commit_native(&users[0], id, 20 * USDC, None).await.is_success(), "a walker may commit again while Open");
    env.advance_to(id, "Closing").await;
    env.call(&users[1], "walk", lid(id), ONE).await.into_result()?;
    env.advance_to(id, "Ready").await;
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_WALK_CLOSED"));
    Ok(())
}

#[tokio::test]
async fn w_lifecycle_pass_30_buyers_3_walks_every_identity_true_at_every_step() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("LIFE");
    p.commit_secs = 3_600; // about 100 sandbox transactions happen inside the window
    let id = env.create_launch(&p).await?;
    assert_all_identities(&env, id).await;
    let users = fill(&env, id, 30, 40 * USDC).await; // 1,200 USDC, above the 1,000 hard cap
    assert_eq!(env.state(id).await["total_active"], (1_200 * USDC).to_string());
    assert_all_identities(&env, id).await;
    for u in &users[..3] {
        env.call(u, "walk", lid(id), ONE).await.into_result()?;
        assert_all_identities(&env, id).await;
    }
    let st = env.state(id).await;
    assert_eq!((st["total_active"].as_str(), st["active_funders"].as_u64()), (Some("1080000000"), Some(27)), "1,200.00 down to 1,080.00");
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    assert_all_identities(&env, id).await;
    assert_same_inputs_hash(&env, id).await;
    assert_book_replays_to_the_stored_hash(&env, id).await;
    let pages = [(0u32, 25u32), (25, 25)];
    for (from, limit) in pages {
        env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": from, "limit": limit }), ZERO)
            .await
            .into_result()?;
        assert_all_identities(&env, id).await;
    }
    for u in &users[3..6] {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    }
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    env.register_on_token("LIFE", users[10].id()).await?;
    env.call(&users[10], "claim_tokens", lid(id), ONE).await.into_result()?;
    assert_all_identities(&env, id).await;
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "launch_fee_due"), num(&led, "excess_pool")), (15 * USDC, 0));
    Ok(())
}

/// Settles, finishes every position and sweeps the residue, so `draw` is open. 12 buyers x 30 USDC = 360 USDC, PASS.
async fn passed_and_swept(env: &Env) -> anyhow::Result<u64> {
    let id = env.create_launch(&params("STRM")).await?;
    fill(env, id, 12, 30 * USDC).await;
    settle_all(env, id).await;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    Ok(id)
}

#[tokio::test]
async fn draw_full_amount_after_pass_reverts_with_stream_cap() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = passed_and_swept(&env).await?;
    let led = env.view("get_ledger", lid(id)).await;
    let total = num(&led, "stream_total");
    assert!(total > 0);
    let all = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": total.to_string() }), ZERO).await;
    assert!(has_code(&all, "STREAM_CAP"), "withdraw-all must hit STREAM_CAP: {:?}", all.failures());
    println!("STREAM_CAP evidence (withdraw-all of {total}): {:?}", all.failures());
    let half = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": (total / 2).to_string() }), ZERO).await;
    assert!(has_code(&half, "STREAM_CAP"), "even half of the stream is not unlocked at day 0");
    let drawable = num(&env.view("stream_status", lid(id)).await, "drawable");
    assert!(drawable > 0 && drawable < total / 100, "only the elapsed sliver is drawable: {drawable} of {total}");
    let intruder = env.user("intruder", 0).await?;
    assert!(has_code(&env.call(&intruder, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await, "R_NOT_AUTHORIZED"));
    let before = env.usdc_balance(env.creator.id()).await;
    env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": drawable.to_string() }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.creator.id()).await - before, drawable, "the unlocked sliver is paid");
    let st = env.view("stream_status", lid(id)).await;
    assert_eq!(num(&st, "drawn"), drawable);
    assert!(num(&st, "cap") >= drawable);
    Ok(())
}

#[tokio::test]
async fn draw_before_pass_and_on_failed_launch_is_refused() -> anyhow::Result<()> {
    // Open launch: no verdict yet.
    let env = Env::new().await?;
    let id = env.create_launch(&params("EARL")).await?;
    fill(&env, id, 12, 30 * USDC).await;
    let r = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await;
    assert!(has_code(&r, "R_NOT_CLEAR"), "{:?}", r.failures());
    // PASSED but positions not yet settled: still refused.
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let r = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await;
    assert!(has_code(&r, "R_NOT_CLEAR"), "no draw before every position is settled and the residue swept");
    // FAILED launch: there is no stream row at all.
    let env = Env::new().await?;
    let id = env.create_launch(&params("DEAD")).await?;
    fill(&env, id, 5, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    assert!(!env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?);
    for amount in [json!("1"), serde_json::Value::Null] {
        let r = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": amount }), ZERO).await;
        assert!(has_code(&r, "R_NOT_CLEAR"), "a failed launch can never be drawn: {:?}", r.failures());
    }
    assert_eq!(env.view("stream_status", lid(id)).await, serde_json::Value::Null, "no stream on a failed launch");
    Ok(())
}

#[tokio::test]
async fn stream_clock_keeps_running_while_paused() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = passed_and_swept(&env).await?;
    let cap_before = num(&env.view("stream_status", lid(id)).await, "cap");
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    let held = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await;
    assert!(has_code(&held, "R_PAUSED"), "creator payouts wait while paused: {:?}", held.failures());
    env.worker.fast_forward(300).await?;
    let paused = env.view("stream_status", lid(id)).await;
    assert_eq!(paused["paused"], true);
    let cap_paused = num(&paused, "cap");
    assert!(cap_paused > cap_before, "the clock ran during the pause: {cap_before} -> {cap_paused}");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    let drawable = num(&env.view("stream_status", lid(id)).await, "drawable");
    assert!(drawable >= cap_paused, "time spent paused still counts: drawable {drawable} >= cap seen while paused {cap_paused}");
    env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": cap_paused.to_string() }), ZERO).await.into_result()?;
    Ok(())
}

/// LIMITATIONS item 21 (fixed): a walker's record is deleted once the refund lands, so a launch that FAILs after walks still dissolves
/// and returns the creator bond. Adversarial parts: dissolve is refused while any refund is unclaimed, a walker who commits again
/// and walks again is paid exactly once each time, and every USDC unit is accounted for.
#[tokio::test]
async fn walk_then_fail_still_dissolves_and_returns_bond() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("WDIS")).await?;
    let users = fill(&env, id, 5, 30 * USDC).await;
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    assert!(env.commit_native(&users[0], id, 30 * USDC, None).await.is_success(), "a walker may commit again while Open");
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    env.call(&users[1], "walk", lid(id), ONE).await.into_result()?;
    for u in &users[..2] {
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "walkers paid in full, exactly once");
        assert!(has_code(&env.call(u, "walk", lid(id), ONE).await, "R_NO_POSITION"), "the record is gone, a third walk finds nothing");
    }
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    assert!(has_code(&env.call(&env.creator, "dissolve", lid(id), ZERO).await, "R_NOT_CLEAR"), "three refunds are still due");
    for u in &users[2..] {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    }
    let st = env.state(id).await;
    assert_eq!(st["positions_live"].as_u64(), Some(0));
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    let bal = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(id), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > bal, "bond returned");
    assert_eq!(env.state(id).await["status"], "Dissolved");
    Ok(())
}
