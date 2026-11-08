//! Task 2.6 B-STORAGE: bytes of contract storage one position costs, measured from `storage_usage` before and after a commit.
//! Gas (B-INTAKE, B-PAYOUT) is printed by the harness under `BENCH=1` for every call of every suite.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use serde_json::json;

#[tokio::test]
async fn bench_storage_bytes_per_position() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = TrialParams::example("BNCH");
    p.commit_secs = 600;
    let id = env.create_launch(&p).await?;
    let usage = || async { env.core.view_account().await.map(|a| a.storage_usage) };
    let u0 = usage().await?;
    let a = env.user("bench-a", 100 * USDC).await?;
    env.commit_native(&a, id, 30 * USDC, None).await.into_result()?;
    let u1 = usage().await?;
    let h = sol_holder(77);
    env.fund_intents(&h.hex, 40 * USDC).await?;
    env.commit_s3(&h, id, 30 * USDC, 0).await.into_result()?;
    let u2 = usage().await?;
    env.commit_native(&a, id, 25 * USDC, None).await.into_result()?;
    let u3 = usage().await?;
    println!("BENCH storage native_position_bytes {}", u1 - u0);
    println!("BENCH storage solana_position_bytes {}", u2 - u1);
    println!("BENCH storage second_commit_same_holder_bytes {}", u3 - u2);
    assert!(u1 > u0 && u2 > u1, "a new position costs storage");
    assert_eq!(u3, u2, "a second commit by the same holder adds no storage");
    let _ = json!({});
    Ok(())
}
