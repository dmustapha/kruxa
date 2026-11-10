//! N-04 (launcher review): every token-leg attempt of `open_instant` attaches 0.00125 NEAR of the LAUNCHER's own balance to a
//! `storage_deposit(market, registration_only)` on the launch token. NEP-145 says a deposit for an already registered account is
//! refunded, so a retry after a refused token leg costs nothing. This file measures what a retry costs when the token does NOT
//! refund (a token that keeps the deposit), and what it costs whoever sends the retry. The result is written to
//! `evidence/instant-n04/storage-deposit-retry.json` and summarised in docs/KNOWN-FINDINGS.md. The stub market is the cheapest
//! possible receiver, so the sender's gas figure here is a floor: the real market burns more.
//!
//! Method: a stub market that refuses the token bucket keeps the launch in `Handoff` with an unsent bucket, so every
//! `open_instant` is a pure token-leg retry. The launcher's NEAR balance is read before and after each retry. The mock token
//! (`mock_ft`, test hook `set_keep_storage_deposit`) refunds like a NEP-145 token by default and keeps the deposit when switched.
mod instant_common;
use instant_common as ic;
use near_workspaces::result::ExecutionFinalResult;
use serde_json::{json, Value};

const REG: i128 = 1_250_000_000_000_000_000_000;
/// Sandbox gas price: 1e8 yocto per gas, so 1 Tgas = 0.0001 NEAR.
const GAS_PRICE: u128 = 100_000_000;
const SEED: u128 = 250 * ic::USDC;

async fn launcher_near(ix: &ic::Ix) -> i128 {
    ix.launcher.as_account().view_account().await.unwrap().balance.as_yoctonear() as i128
}

async fn set_stub(ix: &ic::Ix, mode: &str) {
    ix.market.call("set_mode").args_json(json!({ "mode": mode })).transact().await.unwrap().into_result().unwrap();
}

async fn set_keep(ix: &ic::Ix, symbol: &str, keep: bool) {
    ix.owner
        .call(&ix.token_id(symbol), "set_keep_storage_deposit")
        .args_json(json!({ "keep": keep }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
}

struct Retry {
    launcher_delta: i128,
    sender_gas_yocto: u128,
    result: ExecutionFinalResult,
}

async fn retry(ix: &ic::Ix, who: &near_workspaces::Account, id: &str) -> Retry {
    let before = launcher_near(ix).await;
    let result = ix.open(who, id).await.unwrap();
    let after = launcher_near(ix).await;
    Retry { launcher_delta: after - before, sender_gas_yocto: u128::from(result.total_gas_burnt.as_gas()) * GAS_PRICE, result }
}

fn near(y: i128) -> f64 {
    y as f64 / 1e24
}

#[tokio::test]
async fn a_token_that_keeps_the_storage_deposit_costs_the_launcher_0_00125_near_per_retry_and_the_sender_at_least_as_much(
) -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("N04"), None).await?;
    ix.mint_usdc(ix.creator.id(), SEED).await?;
    ix.seed(&ix.creator, &id, SEED).await?.into_result()?;
    let stranger = ix.user("stranger", 0).await?;
    set_stub(&ix, "refuse_token").await;
    let first = retry(&ix, &stranger, &id).await;
    assert!(first.result.is_success(), "{:?}", first.result.failures());
    let inst = ix.inst(&id).await;
    assert_eq!(inst["status"], "Handoff", "the seed was consumed and the token bucket refused: a pure token-leg retry state");
    assert!(ic::n(&inst["seed_sent"]) == SEED && ic::n(&inst["tokens_inflight"]) == 0, "{inst}");

    // Refunding token (NEP-145): the registration deposit comes back, so a retry costs the launcher nothing.
    let refunding: Vec<Retry> = vec![retry(&ix, &stranger, &id).await, retry(&ix, &stranger, &id).await];
    // Token that keeps the deposit: every retry takes the registration amount.
    set_keep(&ix, "N04", true).await;
    let keeping: Vec<Retry> = vec![retry(&ix, &stranger, &id).await, retry(&ix, &stranger, &id).await, retry(&ix, &stranger, &id).await];

    let base = refunding.iter().map(|r| r.launcher_delta).max().unwrap();
    let kept_loss: Vec<i128> = keeping.iter().map(|r| base - r.launcher_delta).collect();
    for (i, loss) in kept_loss.iter().enumerate() {
        assert!(
            (loss - REG).abs() < REG / 5,
            "retry {i} on a deposit-keeping token costs the launcher the registration amount more than a refunding one: {} NEAR",
            near(*loss)
        );
    }
    for r in refunding.iter() {
        assert!(r.launcher_delta > -REG / 10, "a refunding token costs the launcher no deposit: {} NEAR", near(r.launcher_delta));
    }
    let sender_cost = keeping.iter().map(|r| r.sender_gas_yocto).min().unwrap() as i128; // floor: stub market
    assert!(sender_cost > REG, "the sender burns at least what the launcher loses (parity, never a profit): {} NEAR", near(sender_cost));

    // Recovery: the market accepts again, the next retry completes the opening and the launch is Open.
    set_stub(&ix, "accept").await;
    let done = retry(&ix, &stranger, &id).await;
    assert!(done.result.is_success(), "{:?}", done.result.failures());
    assert_eq!(ix.status(&id).await, "Open", "retries lose only NEAR; the launch itself still opens once the market accepts");
    ix.assert_solvent(&[&id]).await;

    let record = json!({
        "id": "N-04", "network": "SANDBOX", "gas_price_yocto_per_gas": GAS_PRICE.to_string(),
        "token_leg_registration_yocto": REG.to_string(),
        "refunding_token_launcher_delta_near": refunding.iter().map(|r| near(r.launcher_delta)).collect::<Vec<_>>(),
        "keeping_token_launcher_delta_near": keeping.iter().map(|r| near(r.launcher_delta)).collect::<Vec<_>>(),
        "keeping_token_extra_loss_near": kept_loss.iter().map(|l| near(*l)).collect::<Vec<_>>(),
        "sender_gas_cost_near_per_retry": keeping.iter().map(|r| r.sender_gas_yocto as f64 / 1e24).collect::<Vec<_>>(),
        "first_attempt_includes_the_real_registration": true,
        "finding": "A retry costs the launcher 0.00125 NEAR only when the token keeps the storage deposit of an already registered market; the sender of the retry burns about the same amount in gas against a stub market and more against the real one, so draining is griefing at cost parity, never a profit. A retry exists only after a refused token leg.",
    });
    let dir = format!("{}/../evidence/instant-n04", env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(format!("{dir}/storage-deposit-retry.json"), serde_json::to_string_pretty(&record)? + "\n")?;
    let _: Value = record;
    Ok(())
}
