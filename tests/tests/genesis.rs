//! Task 4.4: the contract side of the Solana genesis ceremony. The sandbox plays the relayer; no Solana is involved.
use base64::Engine;
use kruxa_logic::genesis::{leaf_hash, merkle_root_bottom_up, mint_address, GenesisSpec, TOKEN_PROGRAM};
use kruxa_logic::{hex, TrialParams};
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
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

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

struct Round {
    env: Env,
    id: u64,
    relayer: Account,
    /// (pubkey bytes, amount) of every Solana holder, ascending by pubkey.
    leaves: Vec<([u8; 32], u64)>,
}

impl Round {
    async fn call(&self, who: &Account, method: &str, args: Value) -> near_workspaces::result::ExecutionFinalResult {
        self.env.call(who, method, args, ZERO).await
    }
    async fn genesis(&self) -> Value {
        self.env.view("get_genesis", lid(self.id)).await
    }
    fn page(&self, from: usize, to: usize) -> Value {
        let l: Vec<Value> = self.leaves[from..to].iter().map(|(k, a)| json!([hex(k), a.to_string()])).collect();
        json!({ "launch_id": self.id.to_string(), "leaves": l })
    }
}

/// A launch with `n_native` NEAR buyers and `n_sol` Solana buyers (30 USDC each); settled but not yet committed to genesis when `settle` is true.
async fn round(symbol: &str, n_native: usize, n_sol: usize, settle: bool) -> anyhow::Result<Round> {
    let env = Env::new().await?;
    let relayer = env.user("relayer", 0).await?;
    env.owner.call(env.core.id(), "set_genesis_relayer").args_json(json!({ "account": relayer.id() })).transact().await?.into_result()?;
    let id = env.create_launch(&params(symbol)).await?;
    for i in 0..n_native {
        let u = env.user(&format!("n{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
    }
    let mut keys = Vec::new();
    for i in 0..n_sol {
        let h = sol_holder(40 + i as u8);
        env.fund_intents(&h.hex, 40 * USDC).await?;
        env.commit_s3(&h, id, 30 * USDC, 0).await.into_result()?;
        keys.push(h);
    }
    let mut leaves = Vec::new();
    if settle {
        env.advance_to(id, "Ready").await;
        env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
        let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
        env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
        env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
        for h in &keys {
            let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
            let amt = |k: &str| pos[k].as_str().unwrap().parse::<u64>().unwrap();
            let pk: [u8; 32] = unhex(&h.hex).try_into().unwrap();
            leaves.push((pk, amt("tokens_entitled") + amt("bonus_entitled")));
        }
        leaves.sort();
    }
    Ok(Round { env, id, relayer, leaves })
}

const G_PUB: [u8; 32] = [5; 32];

fn commit_args(id: u64) -> Value {
    json!({ "launch_id": id.to_string(), "g_pub": hex(&G_PUB) })
}

#[tokio::test]
async fn commit_genesis_on_open_or_failed_returns_r_genesis_state() -> anyhow::Result<()> {
    let r = round("GENA", 0, 0, false).await?;
    let open = r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await;
    assert!(has_code(&open, "R_GENESIS_STATE"), "Open: {:?}", open.failures());
    r.call(&r.env.creator, "cancel_trial", lid(r.id)).await.into_result()?;
    let failed = r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await;
    assert!(has_code(&failed, "R_GENESIS_STATE"), "Failed: {:?}", failed.failures());
    assert_eq!(r.genesis().await["status"], "None");
    Ok(())
}

#[tokio::test]
async fn commit_needs_every_position_settled() -> anyhow::Result<()> {
    let r = round("GENB", 12, 0, false).await?;
    r.env.advance_to(r.id, "Ready").await;
    r.call(&r.env.creator, "settle", lid(r.id)).await.into_result()?;
    let early = r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await;
    assert!(has_code(&early, "R_GENESIS_STATE"), "positions are not settled yet: {:?}", early.failures());
    Ok(())
}

#[tokio::test]
async fn only_the_relayer_can_use_the_three_methods_and_it_holds_no_other_power() -> anyhow::Result<()> {
    let r = round("GENC", 12, 0, true).await?;
    let stranger = r.env.user("stranger", 0).await?;
    for (who, method, args) in [
        (&stranger, "commit_genesis", commit_args(r.id)),
        (&r.env.owner, "commit_genesis", commit_args(r.id)),
        (&stranger, "build_root_page", r.page(0, 0)),
        (
            &stranger,
            "confirm_genesis",
            json!({ "launch_id": r.id.to_string(), "mint": hex(&[0; 32]), "sigs": ["s"], "slot": "1", "ceremony_hash": hex(&[0; 32]) }),
        ),
        (&stranger, "attest_log_append", json!({ "launch_id": r.id.to_string(), "attestation_hash": hex(&[1; 32]) })),
        (&stranger, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "x" })),
        (&r.relayer, "open_beta", json!({})),
        (&r.relayer, "pause_genesis", json!({})),
        (&r.relayer, "set_genesis_relayer", json!({ "account": r.relayer.id() })),
    ] {
        let res = r.call(who, method, args).await;
        assert!(has_code(&res, "R_NOT_AUTHORIZED"), "{} {method}: {:?}", who.id(), res.failures());
    }
    Ok(())
}

#[tokio::test]
async fn full_ceremony_commit_pages_confirm() -> anyhow::Result<()> {
    let r = round("GEND", 8, 6, true).await?;
    assert_eq!(r.leaves.len(), 6);
    let c = r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await;
    assert!(c.is_success(), "{:?}", c.failures());
    let g = r.genesis().await;
    assert_eq!((g["status"].as_str(), g["expected_leaves"].as_u64(), g["root_ready"].as_bool()), (Some("Committed"), Some(6), Some(false)));
    let mint = mint_address(&G_PUB, &r.id.to_string(), &TOKEN_PROGRAM);
    assert_eq!(g["mint_address"], hex(&mint), "M = createWithSeed(G_pub, launch id, Tokenkeg)");
    let again = r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await;
    assert!(has_code(&again, "R_GENESIS_ALREADY"), "{:?}", again.failures());
    // out of order, wrong amount, unknown holder
    let mut swapped = r.page(0, 3);
    swapped["leaves"].as_array_mut().unwrap().swap(0, 1);
    assert!(has_code(&r.call(&r.relayer, "build_root_page", swapped).await, "R_GENESIS_ORDER"));
    let mut wrong = r.page(0, 2);
    wrong["leaves"][0][1] = json!("1");
    assert!(has_code(&r.call(&r.relayer, "build_root_page", wrong).await, "R_GENESIS_LEAF"));
    let unknown = json!({ "launch_id": r.id.to_string(), "leaves": [[hex(&[0xEE; 32]), "10"]] });
    assert!(has_code(&r.call(&r.relayer, "build_root_page", unknown).await, "R_GENESIS_LEAF"));
    // confirm is refused until the root is complete
    let confirm = |mint_hex: String| json!({ "launch_id": r.id.to_string(), "mint": mint_hex, "sigs": ["sig1", "sig2"], "slot": "777", "ceremony_hash": hex(&[4; 32]) });
    assert!(has_code(&r.call(&r.relayer, "confirm_genesis", confirm(hex(&mint))).await, "R_GENESIS_STATE"));
    // two pages; a page that restarts below the cursor is refused
    r.call(&r.relayer, "build_root_page", r.page(0, 4)).await.into_result()?;
    assert!(has_code(&r.call(&r.relayer, "build_root_page", r.page(3, 6)).await, "R_GENESIS_ORDER"), "overlap with the previous page");
    assert_eq!(r.genesis().await["root_ready"], false);
    r.call(&r.relayer, "build_root_page", r.page(4, 6)).await.into_result()?;
    let g = r.genesis().await;
    assert_eq!(g["root_ready"], true);
    let hashes: Vec<[u8; 32]> = r.leaves.iter().map(|(k, a)| leaf_hash(k, *a, 0)).collect();
    assert_eq!(g["merkle_root"], hex(&merkle_root_bottom_up(&hashes)), "the on-chain root equals the reference construction");
    let total: u64 = r.leaves.iter().map(|l| l.1).sum();
    assert_eq!(g["max_total_claim"], total.to_string());
    // the committed spec hashes to the stored hash
    let b64 = r.env.view("get_genesis_spec", lid(r.id)).await;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.as_str().unwrap())?;
    let spec: GenesisSpec = borsh::from_slice(&bytes)?;
    assert_eq!(hex(&spec.hash()), g["genesis_spec_hash"].as_str().unwrap());
    assert_eq!((spec.mint_authority_none, spec.freeze_authority_none, spec.extensions_allowed), (true, true, false));
    assert_eq!((spec.genesis_key_pubkey, spec.mint_address, spec.max_num_nodes), (G_PUB, mint, 6));
    // confirm
    assert!(
        has_code(&r.call(&r.relayer, "confirm_genesis", confirm(hex(&[9; 32]))).await, "R_GENESIS_ARG"),
        "mint must be the committed address"
    );
    let ok = r.call(&r.relayer, "confirm_genesis", confirm(hex(&mint))).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let g = r.genesis().await;
    assert_eq!(
        (g["status"].as_str(), g["slot"].as_str(), g["tx_sigs"].as_array().map(Vec::len)),
        (Some("Confirmed"), Some("777"), Some(2))
    );
    assert_eq!(g["ceremony_hash"], hex(&[4; 32]));
    assert!(has_code(&r.call(&r.relayer, "confirm_genesis", confirm(hex(&mint))).await, "R_GENESIS_STATE"), "confirm is one-shot");
    let abort = r.call(&r.relayer, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "late" })).await;
    assert!(has_code(&abort, "R_GENESIS_STATE"), "no abort after confirm");
    r.call(&r.relayer, "attest_log_append", json!({ "launch_id": r.id.to_string(), "attestation_hash": hex(&[1; 32]) }))
        .await
        .into_result()?;
    assert_eq!(r.genesis().await["attest_log"], json!([hex(&[1; 32])]));
    Ok(())
}

#[tokio::test]
async fn a_launch_without_solana_buyers_commits_an_empty_tree_at_once() -> anyhow::Result<()> {
    let r = round("GENE", 12, 0, true).await?;
    r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await.into_result()?;
    let g = r.genesis().await;
    assert_eq!(
        (g["root_ready"].as_bool(), g["merkle_root"].as_str(), g["expected_leaves"].as_u64()),
        (Some(true), Some(hex(&[0; 32]).as_str()), Some(0))
    );
    Ok(())
}

#[tokio::test]
async fn abort_before_confirm_is_final_for_the_relayer_and_the_guardian_can_do_it() -> anyhow::Result<()> {
    let r = round("GENF", 12, 0, true).await?;
    assert!(
        has_code(
            &r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "x" })).await,
            "R_GENESIS_STATE"
        ),
        "nothing to abort yet"
    );
    r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await.into_result()?;
    r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "relayer host compromised" }))
        .await
        .into_result()?;
    let g = r.genesis().await;
    assert_eq!((g["status"].as_str(), g["abort_reason"].as_str()), (Some("Aborted"), Some("relayer host compromised")));
    assert!(has_code(&r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await, "R_GENESIS_ALREADY"), "one-shot even after an abort");
    let confirm =
        json!({ "launch_id": r.id.to_string(), "mint": hex(&[0; 32]), "sigs": ["s"], "slot": "1", "ceremony_hash": hex(&[0; 32]) });
    assert!(has_code(&r.call(&r.relayer, "confirm_genesis", confirm).await, "R_GENESIS_STATE"));
    Ok(())
}

#[tokio::test]
async fn only_the_owner_can_reopen_an_aborted_genesis_and_the_second_attempt_completes() -> anyhow::Result<()> {
    let r = round("GENR", 12, 0, true).await?;
    assert!(has_code(&r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE"), "nothing to reopen before a commit");
    r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await.into_result()?;
    assert!(has_code(&r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE"), "a committed genesis is not aborted");
    r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "first attempt failed" }))
        .await
        .into_result()?;
    for who in [&r.relayer, &r.env.guardian, &r.env.creator] {
        assert!(has_code(&r.call(who, "reopen_genesis", lid(r.id)).await, "R_NOT_AUTHORIZED"), "only the owner reopens");
    }
    assert!(
        has_code(&r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await, "R_GENESIS_ALREADY"),
        "still final until the owner acts"
    );
    r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await.into_result()?;
    let g = r.genesis().await;
    assert_eq!((g["status"].as_str(), g["abort_reason"].as_str(), g["g_pub"].is_null()), (Some("None"), Some(""), true));
    r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await.into_result()?;
    let g = r.genesis().await;
    assert_eq!((g["status"].as_str(), g["root_ready"].as_bool()), (Some("Committed"), Some(true)));
    let mint = g["mint_address"].as_str().unwrap().to_string();
    let confirm = json!({ "launch_id": r.id.to_string(), "mint": mint, "sigs": ["s"], "slot": "1", "ceremony_hash": hex(&[0; 32]) });
    r.call(&r.relayer, "confirm_genesis", confirm).await.into_result()?;
    assert_eq!(r.genesis().await["status"], "Confirmed");
    assert!(
        has_code(&r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE"),
        "a confirmed genesis can never be reopened"
    );
    assert!(has_code(
        &r.call(&r.relayer, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "late" })).await,
        "R_GENESIS_STATE"
    ));
    Ok(())
}

#[tokio::test]
async fn pause_genesis_is_guardian_only_and_blocks_the_ceremony() -> anyhow::Result<()> {
    let r = round("GENG", 12, 0, true).await?;
    assert!(has_code(&r.call(&r.env.creator, "pause_genesis", json!({})).await, "R_NOT_AUTHORIZED"));
    r.call(&r.env.guardian, "pause_genesis", json!({})).await.into_result()?;
    assert!(has_code(&r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await, "R_PAUSED"));
    assert!(has_code(&r.call(&r.env.guardian, "resume_genesis", json!({})).await, "R_NOT_AUTHORIZED"), "only the owner resumes");
    r.call(&r.env.owner, "resume_genesis", json!({})).await.into_result()?;
    r.call(&r.relayer, "commit_genesis", commit_args(r.id)).await.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_plan_that_keeps_an_authority_or_allows_extensions_is_refused_at_create_trial() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let p = params("GENH");
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
    for bad in [json!({ "mint_authority_none": false }), json!({ "freeze_authority_none": false }), json!({ "extensions_allowed": true })] {
        let res = env
            .creator
            .call(env.core.id(), "create_trial")
            .args_json(json!({ "params": p, "stream_recipient": null, "genesis": bad }))
            .deposit(NearToken::from_yoctonear(required.parse()?))
            .gas(GAS)
            .transact()
            .await?;
        assert!(has_code(&res, "R_GENESIS_AUTH"), "{bad}: {:?}", res.failures());
    }
    Ok(())
}

#[tokio::test]
async fn solana_allocations_page_lists_only_solana_holders_after_settlement() -> anyhow::Result<()> {
    let r = round("GENI", 8, 6, true).await?;
    let rows: Vec<Value> = r
        .env
        .view("solana_allocations_page", json!({ "launch_id": r.id.to_string(), "from_seq": 0, "limit": 50 }))
        .await
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(rows.len(), 6);
    let mut got: Vec<(String, String)> =
        rows.iter().map(|v| (v["pubkey"].as_str().unwrap().to_string(), v["amount"].as_str().unwrap().to_string())).collect();
    got.sort();
    let mut want: Vec<(String, String)> = r.leaves.iter().map(|(k, a)| (hex(k), a.to_string())).collect();
    want.sort();
    assert_eq!(got, want);
    Ok(())
}
