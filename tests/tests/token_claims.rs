//! Launch-token deliveries against the sandbox: in-claim NEP-145 registration, the creator allocation claim (cliff, then linear)
//! and `sweep_tokens` with `burn_mode`. The mock token enforces registration and the 0.00125 NEAR minimum, like the testnet factory token.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId};
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);
const REG: u128 = 1_250_000_000_000_000_000_000;

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

async fn fill(env: &Env, id: u64, n: usize, each: u128) -> Vec<Account> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await.unwrap();
        assert!(env.commit_native(&u, id, each, None).await.is_success());
        users.push(u);
    }
    users
}

/// PASS with 12 x 30 USDC, every position settled. Buyers are NOT registered on the launch token.
async fn passed(env: &Env, symbol: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let id = env.create_launch(&params(symbol)).await?;
    let users = fill(env, id, 12, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    Ok((id, users))
}

async fn token_call(env: &Env, symbol: &str, method: &str, args: Value) -> anyhow::Result<()> {
    env.owner.call(&env.token_id(symbol), method).args_json(args).transact().await?.into_result()?;
    Ok(())
}

async fn is_registered(env: &Env, symbol: &str, who: &AccountId) -> bool {
    let v: Value =
        env.worker.view(&env.token_id(symbol), "storage_balance_of").args_json(json!({ "account_id": who })).await.unwrap().json().unwrap();
    !v.is_null()
}

async fn near_balance(who: &Account) -> u128 {
    who.view_account().await.unwrap().balance.as_yoctonear()
}

fn claim_tokens_args(id: u64) -> Value {
    lid(id)
}

async fn position_claimed(env: &Env, id: u64, who: &Account) -> u128 {
    let p = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", who.id()) })).await;
    num(&p, "claimed")
}

fn has_event(res: &near_workspaces::result::ExecutionFinalResult, name: &str) -> bool {
    res.logs().iter().any(|l| l.contains("EVENT_JSON") && l.contains(&format!("\"event\":\"{name}\"")))
}

// ---- in-claim registration

#[tokio::test]
async fn claim_registers_an_unregistered_backer_and_refunds_the_excess() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGA").await?;
    let u = &users[3];
    assert!(!is_registered(&env, "REGA", u.id()).await);
    let before = near_balance(u).await;
    let r = env.call(u, "claim_tokens", claim_tokens_args(id), NearToken::from_near(1)).await;
    r.clone().into_result()?;
    assert!(is_registered(&env, "REGA", u.id()).await, "the claim registered the backer");
    let got = env.token_balance("REGA", u.id()).await;
    assert!(got >= 50_000_000_000_000, "sale share delivered: {got}");
    let spent = before - near_balance(u).await;
    assert!(spent >= REG, "the holder paid the registration deposit: {spent}");
    assert!(spent < NearToken::from_millinear(200).as_yoctonear(), "the rest of the 1 NEAR came back (registration + gas only): {spent}");
    assert_eq!(position_claimed(&env, id, u).await, got);
    Ok(())
}

#[tokio::test]
async fn claim_with_too_little_attached_for_an_unregistered_backer_loses_nothing() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGB").await?;
    let u = &users[0];
    let r = env.call(u, "claim_tokens", claim_tokens_args(id), ONE).await;
    assert!(r.is_success(), "a refused delivery is a value, not a revert: {:?}", r.failures());
    assert!(has_event(&r, "token_delivery_refused"), "{:?}", r.logs());
    assert_eq!(position_claimed(&env, id, u).await, 0, "the claim was re-credited");
    assert_eq!(env.token_balance("REGB", u.id()).await, 0);
    assert!(!is_registered(&env, "REGB", u.id()).await);
    let inv = env.view("get_token_custody", lid(id)).await;
    assert_eq!(num(&inv, "claimed_total"), 0);
    env.call(u, "claim_tokens", claim_tokens_args(id), NearToken::from_millinear(5)).await.into_result()?;
    assert!(env.token_balance("REGB", u.id()).await > 0, "the retry with enough NEAR delivers");
    Ok(())
}

#[tokio::test]
async fn registered_backer_claims_with_one_yocto_and_gets_the_excess_back() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGC").await?;
    env.register_on_token("REGC", users[1].id()).await?;
    env.register_on_token("REGC", users[2].id()).await?;
    env.call(&users[1], "claim_tokens", claim_tokens_args(id), ONE).await.into_result()?;
    assert!(env.token_balance("REGC", users[1].id()).await > 0);
    let before = near_balance(&users[2]).await;
    env.call(&users[2], "claim_tokens", claim_tokens_args(id), NearToken::from_near(1)).await.into_result()?;
    assert!(
        before - near_balance(&users[2]).await < NearToken::from_millinear(200).as_yoctonear(),
        "no registration was charged: spent {}",
        before - near_balance(&users[2]).await
    );
    Ok(())
}

#[tokio::test]
async fn failed_registration_recredits_the_claim_and_refunds_the_holder() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGD").await?;
    let u = &users[4];
    token_call(&env, "REGD", "set_fail_storage_deposit", json!({ "fail": true })).await?;
    let before = near_balance(u).await;
    let r = env.call(u, "claim_tokens", claim_tokens_args(id), NearToken::from_near(1)).await;
    assert!(r.is_success() && has_event(&r, "token_delivery_refused"), "{:?}", r.logs());
    assert_eq!(position_claimed(&env, id, u).await, 0, "re-credited");
    assert!(before - near_balance(u).await < NearToken::from_millinear(200).as_yoctonear(), "the whole deposit came back");
    assert!(!is_registered(&env, "REGD", u.id()).await);
    token_call(&env, "REGD", "set_fail_storage_deposit", json!({ "fail": false })).await?;
    env.call(u, "claim_tokens", claim_tokens_args(id), NearToken::from_millinear(5)).await.into_result()?;
    assert!(env.token_balance("REGD", u.id()).await > 0);
    Ok(())
}

#[tokio::test]
async fn failed_transfer_recredits_the_claim_and_the_position_survives() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGE").await?;
    let u = &users[5];
    env.register_on_token("REGE", u.id()).await?;
    token_call(&env, "REGE", "set_fail_transfer", json!({ "fail": true })).await?;
    env.call(u, "claim_tokens", claim_tokens_args(id), ONE).await.into_result()?;
    assert_eq!(position_claimed(&env, id, u).await, 0, "re-credited after the transfer failed");
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) })).await;
    assert!(!pos.is_null(), "the position is not deleted while a claim is unresolved");
    assert_eq!(num(&env.view("get_token_custody", lid(id)).await, "claimed_total"), 0);
    token_call(&env, "REGE", "set_fail_transfer", json!({ "fail": false })).await?;
    env.call(u, "claim_tokens", claim_tokens_args(id), ONE).await.into_result()?;
    assert!(env.token_balance("REGE", u.id()).await > 0);
    Ok(())
}

#[tokio::test]
async fn claim_without_any_attached_deposit_is_refused_up_front() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed(&env, "REGF").await?;
    let r = env.call(&users[0], "claim_tokens", claim_tokens_args(id), ZERO).await;
    assert!(has_code(&r, "R_DEPOSIT"), "{:?}", r.failures());
    Ok(())
}

// ---- creator allocation

/// Polls the sandbox clock until `get_token_custody.alloc_<key>` satisfies `pred`.
async fn wait_alloc(env: &Env, id: u64, key: &str, pred: impl Fn(u128) -> bool) -> u128 {
    for _ in 0..400 {
        let v = num(&env.view("get_token_custody", lid(id)).await, key);
        if pred(v) {
            return v;
        }
        env.worker.fast_forward(5).await.unwrap();
    }
    panic!("alloc {key} never satisfied the predicate");
}

#[tokio::test]
async fn creator_allocation_refuses_before_pass_before_the_cliff_and_from_strangers() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ALCA")).await?;
    let early = env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await;
    assert!(has_code(&early, "R_WRONG_PHASE"), "{:?}", early.failures());
    fill(&env, id, 12, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let stranger = env.user("stranger", 0).await?;
    assert!(has_code(&env.call(&stranger, "claim_creator_alloc", lid(id), ONE).await, "R_NOT_AUTHORIZED"));
    let at_cliff = env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await;
    assert!(has_code(&at_cliff, "R_NOTHING"), "nothing vests before the cliff: {:?}", at_cliff.failures());
    assert!(has_code(&env.call(&env.creator, "claim_creator_alloc", lid(id), ZERO).await, "R_DEPOSIT"));
    Ok(())
}

#[tokio::test]
async fn creator_allocation_vests_after_the_cliff_registers_the_recipient_and_ends_exactly_at_the_total() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let recipient = env.user("payee", 0).await?;
    let id = env.create_launch_to(&env.creator, &params("ALCB"), Some(recipient.id())).await?;
    fill(&env, id, 12, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let total = num(&env.view("get_token_custody", lid(id)).await, "alloc_total");
    assert_eq!(total, 100_000_000_000_000, "creator_bps 1000 of 1e15");
    assert!(has_code(&env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await, "R_NOT_AUTHORIZED"), "only the payout recipient");
    let unlocked = wait_alloc(&env, id, "alloc_unlocked", |v| v > 0).await;
    assert!(unlocked <= total);
    let r = env.call(&recipient, "claim_creator_alloc", lid(id), NearToken::from_near(1)).await;
    r.clone().into_result()?;
    assert!(is_registered(&env, "ALCB", recipient.id()).await, "the recipient was registered from its own deposit");
    let first = env.token_balance("ALCB", recipient.id()).await;
    assert!(first > 0 && first <= total);
    assert_eq!(num(&env.view("get_token_custody", lid(id)).await, "alloc_claimed"), first);
    wait_alloc(&env, id, "alloc_unlocked", |v| v == total).await;
    env.call(&recipient, "claim_creator_alloc", lid(id), ONE).await.into_result()?;
    assert_eq!(env.token_balance("ALCB", recipient.id()).await, total, "the whole allocation, never more");
    let again = env.call(&recipient, "claim_creator_alloc", lid(id), ONE).await;
    assert!(has_code(&again, "R_NOTHING"), "{:?}", again.failures());
    Ok(())
}

#[tokio::test]
async fn creator_allocation_failed_transfer_recredits() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ALCC")).await?;
    fill(&env, id, 12, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    wait_alloc(&env, id, "alloc_unlocked", |v| v > 0).await;
    env.register_on_token("ALCC", env.creator.id()).await?;
    token_call(&env, "ALCC", "set_fail_transfer", json!({ "fail": true })).await?;
    env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await.into_result()?;
    assert_eq!(num(&env.view("get_token_custody", lid(id)).await, "alloc_claimed"), 0, "re-credited");
    assert_eq!(env.token_balance("ALCC", env.creator.id()).await, 0);
    token_call(&env, "ALCC", "set_fail_transfer", json!({ "fail": false })).await?;
    env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await.into_result()?;
    assert!(env.token_balance("ALCC", env.creator.id()).await > 0);
    Ok(())
}

// ---- burn_mode and sweep

async fn dissolved(env: &Env, symbol: &str) -> anyhow::Result<u64> {
    let id = env.create_launch(&params(symbol)).await?;
    let users = fill(env, id, 5, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    for u in &users {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    }
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    Ok(id)
}

#[tokio::test]
async fn set_burn_mode_is_owner_only_refuses_burn_and_kruxa_sinks_and_locks_after_one_use() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let stranger = env.user("stranger", 0).await?;
    assert!(has_code(&env.call(&stranger, "set_burn_mode", json!({ "mode": "hold" }), ZERO).await, "R_NOT_AUTHORIZED"));
    let burn = env.call(&env.owner, "set_burn_mode", json!({ "mode": "burn" }), ZERO).await;
    assert!(has_code(&burn, "R_BURN_UNSUPPORTED"), "{:?}", burn.failures());
    for kruxa in [env.owner.id(), env.guardian.id(), env.treasury.id(), env.relay_fees.id(), env.core.id()] {
        let r = env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{kruxa}") }), ZERO).await;
        assert!(has_code(&r, "R_NOT_AUTHORIZED"), "sink {kruxa}: {:?}", r.failures());
    }
    assert!(env.call(&env.owner, "set_burn_mode", json!({ "mode": "garbage" }), ZERO).await.is_failure());
    let sink = env.user("graveyard", 0).await?;
    env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{}", sink.id()) }), ZERO).await.into_result()?;
    let again = env.call(&env.owner, "set_burn_mode", json!({ "mode": "hold" }), ZERO).await;
    assert!(has_code(&again, "R_NOTHING"), "locked after one use: {:?}", again.failures());
    Ok(())
}

#[tokio::test]
async fn dissolved_launch_supply_is_held_by_default_and_never_reaches_a_wallet() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = dissolved(&env, "SWPA").await?;
    let custody = env.view("get_token_custody", lid(id)).await;
    assert_eq!(custody["burn_mode"], "hold");
    let total = 1_000_000_000_000_000u128;
    assert_eq!(num(&custody, "sweepable_now"), total);
    let stranger = env.user("stranger", 0).await?;
    let r = env.call(&stranger, "sweep_tokens", lid(id), NearToken::from_millinear(10)).await;
    r.clone().into_result()?;
    assert!(has_event(&r, "tokens_swept"));
    assert_eq!(env.token_balance("SWPA", stranger.id()).await, 0);
    assert_eq!(env.token_balance("SWPA", env.core.id()).await, total, "Hold keeps the supply in core, unreachable");
    let after = env.view("get_token_custody", lid(id)).await;
    assert_eq!((num(&after, "swept"), num(&after, "sweepable_now")), (total, 0));
    assert!(has_code(&env.call(&stranger, "sweep_tokens", lid(id), ZERO).await, "R_NOTHING"));
    Ok(())
}

#[tokio::test]
async fn dissolved_launch_supply_goes_to_the_sink_and_registers_it_from_the_sweepers_deposit() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = dissolved(&env, "SWPB").await?;
    let sink = env.user("graveyard", 0).await?;
    env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{}", sink.id()) }), ZERO).await.into_result()?;
    let keeper = env.user("keeper", 0).await?;
    assert!(has_code(&env.call(&keeper, "sweep_tokens", lid(id), ZERO).await, "R_DEPOSIT"), "a sink sweep needs the 1 yocto");
    let before = near_balance(&keeper).await;
    env.call(&keeper, "sweep_tokens", lid(id), NearToken::from_near(1)).await.into_result()?;
    let total = 1_000_000_000_000_000u128;
    assert_eq!(env.token_balance("SWPB", sink.id()).await, total);
    assert!(
        near_balance(&keeper).await + NearToken::from_millinear(200).as_yoctonear() > before,
        "the keeper paid registration + gas only: before {before} after {}",
        near_balance(&keeper).await
    );
    assert!(is_registered(&env, "SWPB", sink.id()).await);
    assert_eq!(num(&env.view("get_token_custody", lid(id)).await, "swept"), total);
    Ok(())
}

#[tokio::test]
async fn failed_sweep_transfer_recredits_and_a_retry_succeeds() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = dissolved(&env, "SWPC").await?;
    let sink = env.user("graveyard", 0).await?;
    env.register_on_token("SWPC", sink.id()).await?;
    env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{}", sink.id()) }), ZERO).await.into_result()?;
    token_call(&env, "SWPC", "set_fail_transfer", json!({ "fail": true })).await?;
    env.call(&env.owner, "sweep_tokens", lid(id), ONE).await.into_result()?;
    let c = env.view("get_token_custody", lid(id)).await;
    assert_eq!(num(&c, "swept"), 0, "re-credited");
    token_call(&env, "SWPC", "set_fail_transfer", json!({ "fail": false })).await?;
    env.call(&env.owner, "sweep_tokens", lid(id), ONE).await.into_result()?;
    assert_eq!(env.token_balance("SWPC", sink.id()).await, 1_000_000_000_000_000);
    Ok(())
}

#[tokio::test]
async fn nothing_is_sweepable_while_the_bonus_vest_and_window_run_or_on_open_launches() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _users) = passed(&env, "SWPD").await?;
    let c = env.view("get_token_custody", lid(id)).await;
    assert_eq!(num(&c, "sweepable_now"), 0, "the backer bonus vests for 30 days, then the window runs");
    assert!(has_code(&env.call(&env.creator, "sweep_tokens", lid(id), ZERO).await, "R_NOTHING"));
    let open = env.create_launch(&params("SWPE")).await?;
    assert!(has_code(&env.call(&env.creator, "sweep_tokens", lid(open), ZERO).await, "R_NOTHING"), "an Open launch has nothing to sweep");
    Ok(())
}

// ---- views and rule codes

#[tokio::test]
async fn invariants_include_l7_and_the_new_token_bounds() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _users) = passed(&env, "INVA").await?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!(inv["l7_ok"], true, "{inv}");
    assert_eq!(inv["i5_ok"], true, "{inv}");
    let c = env.view("get_token_custody", lid(id)).await;
    assert_eq!(c["solana_claim_rent"], "relay_fee_covers");
    Ok(())
}
