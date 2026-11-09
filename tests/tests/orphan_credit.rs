//! `claim_orphan_credit` against the REAL `intents.near` wasm (real ed25519 signatures, real nonce bookkeeping).
//! An orphan is a buyer-signed S4 payload that somebody else executed at the Verifier: the money is in core's Intents balance with no credit.
use base64::Engine as _;
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

async fn setup(symbol: &str, seed: u8) -> anyhow::Result<(Env, u64, SolHolder)> {
    let env = Env::new_real_intents().await?;
    let id = env.create_launch(&params(symbol)).await?;
    let h = sol_holder(seed);
    env.deposit_real_intents(&h.hex, 500 * USDC).await?;
    Ok((env, id, h))
}

/// A strict S4 payload signed by `h`: a transfer of `amount` to `receiver` carrying the Kruxa memo for launch `id`.
fn signed(env: &Env, h: &SolHolder, id: u64, amount: u128, nonce_seed: u8, receiver: &str) -> Value {
    let memo = format!("kruxa:v1:t={};d={};fee=0", id, h.key());
    let intent = json!({ "intent": "transfer", "receiver_id": receiver, "tokens": { format!("nep141:{}", env.usdc.id()): amount.to_string() }, "memo": memo });
    let nonce = base64::engine::general_purpose::STANDARD.encode([nonce_seed; 32]);
    let payload = json!({ "signer_id": h.hex, "verifying_contract": env.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": nonce, "intents": [intent] }).to_string();
    json!({ "standard": "raw_ed25519", "payload": payload, "public_key": format!("ed25519:{}", h.b58), "signature": format!("ed25519:{}", h.sign(&payload)) })
}

async fn execute_at_verifier(env: &Env, s: &Value) {
    let r = env.worker_call(&env.owner, env.intents.id(), "execute_intents", json!({ "signed": [s] })).await;
    assert!(r.is_success(), "{:?}", r.failures());
}

async fn claim(env: &Env, s: &Value) -> near_workspaces::result::ExecutionFinalResult {
    let keeper = env.user("keeper", 0).await.unwrap_or_else(|_| env.owner.clone());
    env.call(&keeper, "claim_orphan_credit", json!({ "signed": s }), ZERO).await
}

async fn position(env: &Env, id: u64, h: &SolHolder) -> Value {
    env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await
}

fn refused(r: &near_workspaces::result::ExecutionFinalResult) -> bool {
    r.logs().iter().any(|l| l.contains("orphan_credit_refused"))
}

#[tokio::test]
async fn orphan_payload_is_credited_once_to_the_signing_key_whoever_submits_the_claim() -> anyhow::Result<()> {
    let (env, id, h) = setup("ORPH", 7).await?;
    let core = env.core.id().to_string();
    let s = signed(&env, &h, id, 40 * USDC, 1, &core);
    execute_at_verifier(&env, &s).await; // somebody else executes it at the Verifier: an orphan
    assert_eq!(env.intents_balance(&core).await, 40 * USDC);
    assert!(position(&env, id, &h).await.is_null(), "no credit yet");
    let r = claim(&env, &s).await;
    assert!(r.is_success() && !refused(&r), "{:?} {:?}", r.failures(), r.logs());
    let pos = position(&env, id, &h).await;
    assert_eq!((pos["open_intents"].as_str(), pos["contributed"].as_str()), (Some("40000000"), Some("40000000")), "{pos}");
    assert_eq!(env.view("get_ledger", lid(id)).await["open_intents"], "40000000");
    // the claim is single use, and the plain S4 path cannot credit the same payload again
    assert!(has_code(&claim(&env, &s).await, "R_NOTHING"));
    let again = env.call(&env.owner, "contribute_via_intents", json!({ "signed": s }), ZERO).await;
    assert!(has_code(&again, "R_NOTHING"), "{:?}", again.failures());
    assert_eq!(env.view("get_ledger", lid(id)).await["open_intents"], "40000000", "credited exactly once");
    Ok(())
}

#[tokio::test]
async fn orphan_claim_refusals_signature_shape_phase_and_a_nonce_that_was_never_spent() -> anyhow::Result<()> {
    let (env, id, h) = setup("ORPR", 8).await?;
    let core = env.core.id().to_string();
    let s = signed(&env, &h, id, 40 * USDC, 1, &core);
    // not executed at the Verifier: the signature is fine, the nonce is unspent, the callback refuses and credits nothing
    let r = claim(&env, &s).await;
    assert!(r.is_success() && refused(&r), "{:?}", r.logs());
    assert!(position(&env, id, &h).await.is_null());
    // shape and signature
    let mut other_standard = s.clone();
    other_standard["standard"] = json!("nep413");
    assert!(has_code(&claim(&env, &other_standard).await, "R_SIGNED_MSG"));
    let mut tampered = s.clone();
    tampered["payload"] = json!(s["payload"].as_str().unwrap().replace("40000000", "49000000"));
    assert!(has_code(&claim(&env, &tampered).await, "R_SIG"), "an amount changed after signing");
    let forged = signed(&env, &sol_holder(9), id, 40 * USDC, 1, &core);
    let mut wrong_key = s.clone();
    wrong_key["signature"] = forged["signature"].clone();
    assert!(has_code(&claim(&env, &wrong_key).await, "R_SIG"), "a signature by another key");
    let mut garbage = s.clone();
    garbage["signature"] = json!("ed25519:11");
    assert!(has_code(&claim(&env, &garbage).await, "R_SIG"));
    let other_launch = signed(&env, &h, 77, 40 * USDC, 2, &core);
    assert!(has_code(&claim(&env, &other_launch).await, "R_WRONG_PHASE"), "unknown launch");
    let not_core = signed(&env, &h, id, 40 * USDC, 3, "someone-else.test.near");
    assert!(has_code(&claim(&env, &not_core).await, "R_SIGNED_MSG"), "the transfer must be to core");
    // pause and freeze
    execute_at_verifier(&env, &s).await;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&claim(&env, &s).await, "R_PAUSED"));
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&claim(&env, &s).await, "R_FROZEN"));
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    // once the launch has a verdict the orphan can no longer be attributed to it
    env.advance_to(id, "Ready").await;
    env.call(&env.owner, "settle", lid(id), ZERO).await.into_result()?;
    assert!(has_code(&claim(&env, &s).await, "R_WRONG_PHASE"));
    Ok(())
}

#[tokio::test]
async fn adversarial_a_reused_nonce_cannot_credit_money_that_never_arrived() -> anyhow::Result<()> {
    let (env, id, h) = setup("ORPA", 10).await?;
    let core = env.core.id().to_string();
    // an honest buyer has 50 USDC credited and held inside core's Intents balance
    let honest = sol_holder(11);
    env.deposit_real_intents(&honest.hex, 100 * USDC).await?;
    let usdc = env.usdc.id().clone();
    let ok = env.s3_real(&honest, &usdc, 50 * USDC, Some(msg(id, Some(&honest.key()), Some(0))), 3).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(env.intents_balance(&core).await, 50 * USDC);
    // the attacker signs A (30 USDC to core) and B (1 USDC to themselves) with the SAME nonce, and executes only B
    let a = signed(&env, &h, id, 30 * USDC, 5, &core);
    let b = signed(&env, &h, id, USDC, 5, env.owner.id().as_str());
    execute_at_verifier(&env, &b).await;
    assert_eq!(env.intents_balance(&core).await, 50 * USDC, "A never moved any money");
    // the nonce is spent and A is signed by the attacker, but core's balance has no unattributed 30 USDC
    let r = claim(&env, &a).await;
    assert!(r.is_success() && refused(&r), "{:?}", r.logs());
    assert!(position(&env, id, &h).await.is_null(), "no credit without money");
    assert_eq!(env.view("get_ledger", lid(id)).await["open_intents"], (50 * USDC).to_string(), "the honest buyer's ledger is untouched");
    // and the plain S4 path cannot execute A either: the Verifier refuses the spent nonce, nothing is credited
    let s4 = env.call(&env.owner, "contribute_via_intents", json!({ "signed": a }), ZERO).await;
    assert!(s4.logs().iter().any(|l| l.contains("contribution_failed")), "{:?}", s4.logs());
    assert!(position(&env, id, &h).await.is_null());
    Ok(())
}
