//! `force_resolve_op`: the owner settles ONE outbound leg whose callback never ran, in two steps 48 hours apart (60 seconds on the demo clock).
//! The sandbox always runs callbacks, so a stuck leg is made by patching state: part of one holder's `due_native` moves to `inflight_native`
//! in both the position and the launch ledger, which is exactly what `claim_refund` writes before its transfer.
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const MOVED: u128 = 30 * USDC;

fn params(symbol: &str) -> kruxa_logic::TrialParams {
    let mut p = kruxa_logic::TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

fn key(a: &Account) -> String {
    format!("near:{}", a.id())
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

async fn wait_secs(env: &Env, secs: u64) {
    let start = env.worker.view_block().await.unwrap().timestamp();
    while env.worker.view_block().await.unwrap().timestamp() - start < secs * 1_000_000_000 {
        env.worker.fast_forward(20).await.unwrap();
    }
}

fn u128_at(v: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(v[o..o + 16].try_into().unwrap())
}

fn put_u128(v: &mut [u8], o: usize, x: u128) {
    v[o..o + 16].copy_from_slice(&x.to_le_bytes());
}

/// Offset of `Ledger.credited` inside a borsh `LaunchState` of a FAILED launch (status, flags, token, counters, bond, hashes come first).
fn ledger_offset(v: &[u8]) -> usize {
    let mut o = 32; // charter_hash
    o += if v[o] == 4 { 2 } else { 1 }; // Status::Failed carries its reason bits
    o += 2; // halted, cancelled
    o += if v[o] == 1 { 1 + 4 + u32::from_le_bytes(v[o + 1..o + 5].try_into().unwrap()) as usize } else { 1 }; // token
    o + 16 + 4 * 4 + 1 + 16 + 1 + 32 // total_active, four u32 counters, residue_swept, bond, bond_reclaimed, book_hash
}

/// Two buyers fail the soft cap; their positions are settled and `holder`'s refund (30 USDC) is turned into an in-flight leg.
async fn stuck_leg(env: &Env, symbol: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let id = env.create_launch(&params(symbol)).await?;
    let mut users = Vec::new();
    for i in 0..2 {
        let u = env.user(&format!("f{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, MOVED, None).await.is_success());
        users.push(u);
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    let state = env.worker.view_state(env.core.id()).await?;
    // Position of users[0]: key = [2] ++ borsh((launch_id, HolderId::Near(account))).
    let mut pkey = vec![2u8];
    pkey.extend_from_slice(&id.to_le_bytes());
    pkey.push(0);
    let name = users[0].id().as_str();
    pkey.extend_from_slice(&(name.len() as u32).to_le_bytes());
    pkey.extend_from_slice(name.as_bytes());
    let mut pos = state.get(&pkey).expect("position record").clone();
    let o = 4 + 1 + 4 + name.len() + 1 + 16 * 3; // seq, deliver, referrer None, then contributed/open_native/open_intents
    assert_eq!(u128_at(&pos, o), MOVED, "due_native is where the offset math says");
    put_u128(&mut pos, o, 0);
    put_u128(&mut pos, o + 32, MOVED); // inflight_native
    env.worker.patch_state(env.core.id(), &pkey, &pos).await?;
    let mut skey = vec![1u8];
    skey.extend_from_slice(&id.to_le_bytes());
    let mut st = state.get(&skey).expect("launch state").clone();
    let l = ledger_offset(&st);
    assert_eq!(u128_at(&st, l + 3 * 16), 2 * MOVED, "ledger.due_native");
    put_u128(&mut st, l + 3 * 16, MOVED);
    put_u128(&mut st, l + 5 * 16, MOVED); // inflight_native
    env.worker.patch_state(env.core.id(), &skey, &st).await?;
    let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[0]) })).await;
    assert_eq!((num(&p, "due_native"), p["inflight"].as_str(), p["conserved"].as_bool()), (0, Some("30000000"), Some(true)), "{p}");
    Ok((id, users))
}

fn args(id: u64, kind: &str, holder: Option<&Account>, amount: u128, ok: bool) -> Value {
    json!({ "launch_id": id.to_string(), "kind": kind, "holder": holder.map(key), "amount": amount.to_string(), "ok": ok, "evidence": "receipt 4xYz: ft_transfer failed" })
}

async fn force(env: &Env, who: &Account, a: &Value) -> near_workspaces::result::ExecutionFinalResult {
    env.call(who, "force_resolve_op", a.clone(), ZERO).await
}

fn event_seen(r: &near_workspaces::result::ExecutionFinalResult, name: &str) -> bool {
    r.logs().iter().any(|l| l.contains(name))
}

#[tokio::test]
async fn force_resolve_not_paid_puts_the_leg_back_to_due_for_the_same_holder_after_the_delay() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = stuck_leg(&env, "FRNP").await?;
    let a = args(id, "RefundNative", Some(&users[0]), MOVED, false);
    let queued = force(&env, &env.owner, &a).await;
    assert!(queued.is_success() && event_seen(&queued, "force_resolve_queued"), "{:?}", queued.failures());
    assert!(has_code(&force(&env, &env.owner, &a).await, "R_NOT_YET"), "the delay has not passed");
    wait_secs(&env, 61).await;
    let done = force(&env, &env.owner, &a).await;
    assert!(done.is_success() && event_seen(&done, "op_force_resolved"), "{:?}", done.failures());
    let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[0]) })).await;
    assert_eq!((num(&p, "due_native"), p["inflight"].as_str(), num(&p, "refunded")), (MOVED, Some("0"), 0), "back to due: {p}");
    assert!(has_code(&force(&env, &env.owner, &a).await, "R_NOTHING"), "nothing is in flight any more");
    // the holder now pulls it the normal way, to their own account
    env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC - MOVED + MOVED);
    Ok(())
}

#[tokio::test]
async fn force_resolve_paid_counts_the_leg_as_refunded() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = stuck_leg(&env, "FRPD").await?;
    let a = args(id, "RefundNative", Some(&users[0]), MOVED, true);
    force(&env, &env.owner, &a).await.into_result()?;
    wait_secs(&env, 61).await;
    force(&env, &env.owner, &a).await.into_result()?;
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "inflight_native"), num(&led, "refunded")), (0, MOVED), "{led}");
    assert!(
        env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[0]) })).await.is_null(),
        "the settled position is done"
    );
    assert_eq!(env.view("get_invariants", lid(id)).await["all_ok"], true);
    Ok(())
}

#[tokio::test]
async fn force_resolve_refusals_every_r_code() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = stuck_leg(&env, "FRRF").await?;
    for who in [&env.guardian, &users[0], &env.creator] {
        assert!(has_code(&force(&env, who, &args(id, "RefundNative", Some(&users[0]), MOVED, false)).await, "R_NOT_AUTHORIZED"));
    }
    assert!(has_code(&force(&env, &env.owner, &args(99, "RefundNative", Some(&users[0]), MOVED, false)).await, "R_NO_LAUNCH"));
    for (kind, holder, amount) in [
        ("RefundNative", Some(&users[0]), 0),
        ("RefundNative", Some(&users[0]), MOVED + 1),
        ("RefundNative", Some(&users[1]), MOVED), // nothing in flight for the other holder
        ("RefundNative", None, MOVED),
        ("RefundIntents", Some(&users[0]), MOVED),
        ("LaunchFee", None, 1),
        ("Stream", None, 1),
        ("RelayFee", None, 1),
        ("Consolidate", None, 1),
        ("Claim", Some(&users[0]), MOVED), // token claims are not resolvable from here
    ] {
        let r = force(&env, &env.owner, &args(id, kind, holder, amount, false)).await;
        assert!(has_code(&r, "R_NOTHING"), "{kind} {amount}: {:?}", r.failures());
    }
    // a different `ok` is a different resolution: it must be queued on its own and waits its own delay
    force(&env, &env.owner, &args(id, "RefundNative", Some(&users[0]), MOVED, false)).await.into_result()?;
    wait_secs(&env, 61).await;
    let other = force(&env, &env.owner, &args(id, "RefundNative", Some(&users[0]), MOVED, true)).await;
    assert!(event_seen(&other, "force_resolve_queued"), "ok=true was not the queued resolution, so it only queues");
    let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[0]) })).await;
    assert_eq!(p["inflight"], "30000000", "nothing was resolved by the mismatched call");
    Ok(())
}

#[tokio::test]
async fn adversarial_force_resolve_cannot_redirect_inflate_block_exits_or_change_a_verdict() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = stuck_leg(&env, "FRAD").await?;
    let verdict = env.view("get_settlement", lid(id)).await["inputs_hash"].clone();
    let other_before = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[1]) })).await;
    let a = args(id, "RefundNative", Some(&users[0]), MOVED, false);
    force(&env, &env.owner, &a).await.into_result()?;
    // while a resolution is queued, the OTHER holder's exit is not blocked and the stuck holder is not paid twice
    env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[1].id()).await, 1_000 * USDC);
    // an amount beyond what is in flight is refused, even if queued for a bigger number
    assert!(
        has_code(&force(&env, &env.owner, &args(id, "RefundNative", Some(&users[0]), 2 * MOVED, true)).await, "R_NOTHING"),
        "cannot inflate"
    );
    wait_secs(&env, 61).await;
    force(&env, &env.owner, &a).await.into_result()?;
    // the money went back to the same holder's due, never to the owner or anyone else
    assert_eq!(env.usdc_balance(env.owner.id()).await, 0);
    assert_eq!(env.usdc_balance(users[1].id()).await, 1_000 * USDC, "the other holder's balance did not change");
    let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key(&users[0]) })).await;
    assert_eq!(num(&p, "due_native"), MOVED);
    assert_eq!(env.view("get_settlement", lid(id)).await["inputs_hash"], verdict, "a force-resolve never touches a verdict");
    assert_eq!(other_before["contributed"], "30000000");
    // the owner can still not fabricate a platform payout: no launch fee was in flight
    assert!(has_code(&force(&env, &env.owner, &args(id, "LaunchFee", None, 1, true)).await, "R_NOTHING"));
    env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);
    Ok(())
}
