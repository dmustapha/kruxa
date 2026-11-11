//! Governance with a delay and per-launch stops: the upgrade queue, `halt_launch`, `withdraw_owed`.
//! The demo profile uses a 60 second clock for the upgrade and force-resolve delays so the sandbox can fast-forward through them.
use kruxa_logic::{hex, TrialParams};
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

/// Fast-forwards the sandbox until the chain clock moved by at least `secs`.
async fn wait_secs(env: &Env, secs: u64) {
    let start = env.worker.view_block().await.unwrap().timestamp();
    while env.worker.view_block().await.unwrap().timestamp() - start < secs * 1_000_000_000 {
        env.worker.fast_forward(20).await.unwrap();
    }
}

async fn code_hash(env: &Env) -> String {
    sha256_hex(&env.worker.view_code(env.core.id()).await.unwrap())
}

fn core_wasm() -> Vec<u8> {
    kruxa_tests::core_wasm_bytes()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex(&Sha256::digest(bytes))
}

/// The same program with one extra custom section: a different hash, identical behaviour (and it has `migrate`).
fn core_wasm_v2() -> Vec<u8> {
    let mut code = core_wasm();
    code.extend_from_slice(&[0, 5, 2, b'k', b'x', b'v', b'2']);
    code
}

async fn upgrade_call(env: &Env, who: &Account, code: Vec<u8>) -> near_workspaces::result::ExecutionFinalResult {
    who.call(env.core.id(), "upgrade_core").args(code).gas(GAS).transact().await.unwrap()
}

#[tokio::test]
async fn upgrade_queue_waits_the_delay_then_deploys_and_state_survives() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("UPGR")).await?;
    let v2 = core_wasm_v2();
    let want = sha256_hex(&v2);
    let before = code_hash(&env).await;
    assert_ne!(before, want);
    env.call(&env.owner, "queue_upgrade", json!({ "code_hash": want }), ZERO).await.into_result()?;
    let pending = env.view("get_ops_state", json!({})).await["pending_upgrade"].clone();
    assert_eq!(pending["code_hash"], want.as_str());
    // R_NOT_YET before the delay, even for the owner with the right bytes
    assert!(has_code(&upgrade_call(&env, &env.owner, v2.clone()).await, "R_NOT_YET"));
    assert_eq!(code_hash(&env).await, before);
    wait_secs(&env, 61).await;
    // wrong bytes are refused, the right bytes deploy
    assert!(has_code(&upgrade_call(&env, &env.owner, core_wasm()).await, "R_UPGRADE_HASH"));
    let ok = upgrade_call(&env, &env.owner, v2).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(code_hash(&env).await, want, "the queued code is now deployed");
    assert_eq!(env.view("get_ops_state", json!({})).await["pending_upgrade"], Value::Null);
    assert_eq!(env.state(id).await["status"], "Open", "launch state survived the upgrade");
    assert_eq!(env.view("get_config", json!({})).await["owner"], env.owner.id().as_str());
    assert!(has_code(&upgrade_call(&env, &env.owner, core_wasm_v2()).await, "R_NOTHING"), "a queued hash is single use");
    Ok(())
}

#[tokio::test]
async fn upgrade_refusals_and_guardian_cancel() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let h = sha256_hex(&core_wasm_v2());
    let someone = env.user("someone", 0).await?;
    for who in [&env.guardian, &someone, &env.creator] {
        assert!(has_code(&env.call(who, "queue_upgrade", json!({ "code_hash": h }), ZERO).await, "R_NOT_AUTHORIZED"));
    }
    for bad in ["", "abc", &h.to_uppercase(), &format!("{}0", h)] {
        assert!(has_code(&env.call(&env.owner, "queue_upgrade", json!({ "code_hash": bad }), ZERO).await, "R_UPGRADE_HASH"), "{bad}");
    }
    assert!(has_code(&env.call(&env.guardian, "cancel_upgrade", json!({}), ZERO).await, "R_NOTHING"));
    assert!(has_code(&upgrade_call(&env, &env.owner, core_wasm_v2()).await, "R_NOTHING"));
    env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&someone, "cancel_upgrade", json!({}), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.guardian, "cancel_upgrade", json!({}), ZERO).await.into_result()?;
    assert_eq!(env.view("get_ops_state", json!({})).await["pending_upgrade"], Value::Null);
    wait_secs(&env, 61).await;
    assert!(has_code(&upgrade_call(&env, &env.owner, core_wasm_v2()).await, "R_NOTHING"), "a cancelled upgrade cannot run");
    Ok(())
}

#[tokio::test]
async fn adversarial_upgrade_guardian_cannot_upgrade_requeue_restarts_the_clock_and_a_bad_migrate_rolls_back() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let v2 = core_wasm_v2();
    let h = sha256_hex(&v2);
    env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await.into_result()?;
    wait_secs(&env, 61).await;
    // a compromised guardian cannot run an upgrade the owner queued
    assert!(has_code(&upgrade_call(&env, &env.guardian, v2.clone()).await, "R_NOT_AUTHORIZED"));
    // re-queueing restarts the clock: the owner cannot sneak a swap in at the old time
    env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await.into_result()?;
    assert!(has_code(&upgrade_call(&env, &env.owner, v2).await, "R_NOT_YET"));
    // a wasm without `migrate` (the mock FT) hashes right but cannot take over: the whole deploy receipt rolls back
    let junk = std::fs::read(format!("{}/../target/near/mock_ft/mock_ft.wasm", env!("CARGO_MANIFEST_DIR")))?;
    env.call(&env.owner, "queue_upgrade", json!({ "code_hash": sha256_hex(&junk) }), ZERO).await.into_result()?;
    wait_secs(&env, 61).await;
    let before = code_hash(&env).await;
    let r = upgrade_call(&env, &env.owner, junk).await;
    assert!(
        format!("{:?}", r.failures()).contains("MethodNotFound"),
        "the deploy receipt fails on the missing migrate: {:?}",
        r.failures()
    );
    assert_eq!(code_hash(&env).await, before, "a failed migrate leaves the old code in place");
    assert_eq!(env.view("get_config", json!({})).await["owner"], env.owner.id().as_str(), "state is intact");
    Ok(())
}

/// Thirteen buyers of 30 USDC: one walks, twelve (360 USDC) reach the soft cap and PASS.
async fn thirteen_buyers(env: &Env, symbol: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let id = env.create_launch(&params(symbol)).await?;
    let mut users = Vec::new();
    for i in 0..13 {
        let u = env.user(&format!("h{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
        users.push(u);
    }
    Ok((id, users))
}

#[tokio::test]
async fn halt_launch_stops_new_commits_and_creator_payouts_but_never_exits_or_the_verdict() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = thirteen_buyers(&env, "HALT").await?;
    let outsider = env.user("outsider", 1_000 * USDC).await?;
    assert!(has_code(
        &env.call(&outsider, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "x" }), ZERO).await,
        "R_NOT_AUTHORIZED"
    ));
    assert!(has_code(
        &env.call(&env.creator, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "x" }), ZERO).await,
        "R_NOT_AUTHORIZED"
    ));
    assert!(has_code(&env.call(&env.guardian, "halt_launch", json!({ "launch_id": "99", "reason": "x" }), ZERO).await, "R_NO_LAUNCH"));
    env.call(&env.guardian, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "exploit report" }), ZERO).await.into_result()?;
    assert_eq!(env.view("get_ops_state", json!({ "launch_id": id.to_string() })).await["halted"], true);
    assert!(has_code(&env.call(&env.owner, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "x" }), ZERO).await, "R_NOTHING"));
    // new commits are refused with R_HALTED and the money goes straight back
    let r = env.commit_native(&outsider, id, 30 * USDC, None).await;
    assert!(has_code(&r, "R_HALTED"), "{:?}", r.logs());
    assert_eq!(env.usdc_balance(outsider.id()).await, 1_000 * USDC);
    assert_eq!(
        env.view(
            "preview_contribution",
            json!({ "launch_id": id.to_string(), "holder": format!("near:{}", outsider.id()), "amount": (30 * USDC).to_string() })
        )
        .await["code"],
        "R_HALTED"
    );
    // exits stay open: Walk works while halted
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC, "Walk refunded in full while halted");
    // the verdict is not held back
    env.advance_to(id, "Ready").await;
    let settled = env.call(&outsider, "settle", lid(id), ZERO).await;
    assert!(settled.is_success() && settled.json::<bool>()?, "settle PASSES while halted");
    let hash = env.view("get_settlement", lid(id)).await["inputs_hash"].clone();
    env.call(&outsider, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&outsider, "sweep_residue", lid(id), ZERO).await.into_result()?;
    // creator-side payouts wait; holder token claims do not
    for m in ["pay_launch_fee", "consolidate"] {
        let r = env.call(&env.creator, m, lid(id), ZERO).await;
        assert!(has_code(&r, "R_HALTED"), "{m}: {:?}", r.failures());
    }
    assert!(has_code(&env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await, "R_HALTED"));
    env.register_on_token("HALT", users[1].id()).await?;
    env.call(&users[1], "claim_tokens", lid(id), ONE).await.into_result()?;
    assert!(env.token_balance("HALT", users[1].id()).await > 0, "token claims are exits and stay open");
    // only the owner resumes, and the payouts and the verdict are exactly as before
    assert!(has_code(&env.call(&env.guardian, "resume_launch", lid(id), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.owner, "resume_launch", lid(id), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.owner, "resume_launch", lid(id), ZERO).await, "R_NOTHING"));
    assert_eq!(env.view("get_settlement", lid(id)).await["inputs_hash"], hash, "a halt never changes a verdict");
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    Ok(())
}

#[tokio::test]
async fn adversarial_halt_is_per_launch_and_refunds_stay_open_on_a_halted_failed_launch() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let creator2 = env.user("creator2", 0).await?;
    let a = env.create_launch(&params("HLTA")).await?;
    let b = env.create_launch_as(&creator2, &params("HLTB")).await?;
    let u = env.user("buyer1", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, a, 30 * USDC, None).await.is_success());
    env.call(&env.owner, "halt_launch", json!({ "launch_id": a.to_string(), "reason": "drill" }), ZERO).await.into_result()?;
    assert!(env.commit_native(&u, b, 30 * USDC, None).await.is_success(), "another launch is untouched by the halt");
    // launch A fails (one funder), is halted, and its refund is still claimable
    env.advance_to(a, "Ready").await;
    let r = env.call(&u, "settle", lid(a), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    env.call(&u, "claim_refund", json!({ "launch_id": a.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 970 * USDC, "A refunded (launch B still holds 30)");
    Ok(())
}

/// patch_state helper: writes the owed-NEAR entry the failed-push callback would have created.
async fn patch_owed(env: &Env, account: &str, amount: u128) -> anyhow::Result<()> {
    // Key = the `x:owed` prefix then borsh(AccountId) = u32 length + bytes.
    let mut key = b"x:owed".to_vec();
    key.extend_from_slice(&(account.len() as u32).to_le_bytes());
    key.extend_from_slice(account.as_bytes());
    env.worker.patch_state(env.core.id(), &key, &amount.to_le_bytes()).await?;
    Ok(())
}

#[tokio::test]
async fn withdraw_owed_pays_the_caller_only_once_and_never_another_account() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let alice = env.user("alice", 0).await?;
    let mallory = env.user("mallory", 0).await?;
    let owed = NearToken::from_near(3).as_yoctonear();
    patch_owed(&env, alice.id().as_str(), owed).await?;
    assert_eq!(env.view("get_ops_state", json!({ "account_id": alice.id() })).await["owed_near"], owed.to_string());
    assert!(
        has_code(&env.call(&mallory, "withdraw_owed", json!({}), ZERO).await, "R_NOTHING"),
        "someone else's owed NEAR is not claimable"
    );
    let before = alice.view_account().await?.balance.as_yoctonear();
    let r = env.call(&alice, "withdraw_owed", json!({}), ZERO).await;
    assert!(r.is_success(), "{:?}", r.failures());
    let after = alice.view_account().await?.balance.as_yoctonear();
    let gas_allowance = NearToken::from_millinear(600).as_yoctonear();
    assert!(after + gas_allowance > before + owed && after < before + owed, "the owed NEAR arrived (minus gas): {before} -> {after}");
    assert_eq!(env.view("get_ops_state", json!({ "account_id": alice.id() })).await["owed_near"], "0");
    assert!(has_code(&env.call(&alice, "withdraw_owed", json!({}), ZERO).await, "R_NOTHING"), "no double withdrawal");
    // an exit: open while PAUSED, closed while FROZEN
    patch_owed(&env, alice.id().as_str(), owed).await?;
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&alice, "withdraw_owed", json!({}), ZERO).await, "R_FROZEN"));
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    env.call(&alice, "withdraw_owed", json!({}), ZERO).await.into_result()?;
    Ok(())
}
