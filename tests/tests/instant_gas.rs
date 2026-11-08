//! C-01: a gas-starved `open_instant` must never strand a consumed seed. Sweeps the prepaid gas of the permissionless call
//! over the whole band and proves, for every value, that nothing is left in flight and a normal call finishes the launch.
mod instant_common;
use instant_common::*;
use near_workspaces::types::Gas;
use serde_json::json;

async fn open_with(ix: &Ix, who: &near_workspaces::Account, id: &str, tgas: u64) -> near_workspaces::result::ExecutionFinalResult {
    who.call(ix.launcher.id(), "open_instant").args_json(lid(id)).gas(Gas::from_tgas(tgas)).transact().await.unwrap()
}

#[tokio::test]
async fn no_gas_band_strands_a_seed() -> anyhow::Result<()> {
    let ix = Ix::new("demo", false).await?;
    let stranger = ix.user("stranger", 0).await?;
    let mut first_open = None;
    let mut table = vec![];
    let list: Vec<u64> = match std::env::var("GAS_LIST") {
        Ok(v) => v.split(',').filter(|x| !x.trim().is_empty()).map(|x| x.trim().parse().unwrap()).collect(),
        Err(_) => vec![150, 200, 240, 244, 250, 254, 255, 256, 260, 270, 280, 290, 295, 300],
    };
    for g in list {
        let creator = ix.user(&format!("c{g}"), 0).await?;
        let id = ix.create_ready(&creator, params(&format!("GS{g}")), None).await?;
        ix.mint_usdc(creator.id(), 250 * USDC).await?;
        ix.seed(&creator, &id, 250 * USDC).await?.into_result()?;
        let r = open_with(&ix, &stranger, &id, g).await;
        if g == 300 {
            for o in r.outcomes() {
                eprintln!("BURNT {} {} tgas", o.executor_id, o.gas_burnt.as_gas() / 1_000_000_000_000);
            }
        }
        let i = ix.inst(&id).await;
        table.push((g, r.is_success(), i["status"].as_str().unwrap().to_string()));
        assert_eq!((n(&i["seed_inflight"]), n(&i["tokens_inflight"])), (0, 0), "gas {g}: funds stuck in flight: {i}");
        if i["status"] == "Open" && first_open.is_none() {
            first_open = Some(g);
        }
        if i["status"] != "Open" {
            let again = open_with(&ix, &creator, &id, 300).await;
            again.into_result()?;
        }
        assert_eq!(ix.status(&id).await, "Open", "gas {g}: a normal call must finish the launch");
        let inv = ix.view("get_invariants", lid(&id)).await;
        assert_eq!((inv["usdc_custody_identity"].clone(), inv["token_custody_identity"].clone()), (json!(true), json!(true)), "gas {g}");
    }
    eprintln!("GAS SWEEP (tgas, outer ok, status after first call): {table:?}; first single-call success at {first_open:?}");
    Ok(())
}
