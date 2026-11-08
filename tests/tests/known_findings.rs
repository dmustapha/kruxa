//! Known findings: reproductions of the issues in the independent review (REVIEW-INSTANT-LAUNCH.md) against the CURRENT code.
//! These are NOT part of the 81-attack gallery counts. Each test records what actually happened:
//!   EXPLOITABLE  the weakness reproduced (pre-fix evidence; the test still passes, it records the truth),
//!   NOT_EXPLOITABLE  the weakness did not reproduce (after a fix this is the regression result),
//!   NOT_REPRODUCED  the harness could not exercise it (the record says why).
//! Records go to KRUXA_FINDINGS_OUT (default evidence/attack-gallery/known-findings/records); scripts/known-findings.sh aggregates
//! and exits 1 while anything is EXPLOITABLE. The tests themselves only fail on a harness error, never to hide a result.
mod instant_common;
use instant_common as ic;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::Account;
use serde_json::{json, Value};

const MS: u64 = 1_000_000;
const U: u128 = ic::USDC;

fn record(id: &str, review: &str, title: &str, result: &str, summary: &str, data: Value) {
    let rec = json!({ "id": id, "review_id": review, "title": title, "result": result, "summary": summary, "network": "SANDBOX", "data": data });
    let dir = std::env::var("KRUXA_FINDINGS_OUT")
        .unwrap_or_else(|_| format!("{}/../evidence/attack-gallery/known-findings/records", env!("CARGO_MANIFEST_DIR")));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(format!("{dir}/{id}.json"), serde_json::to_string_pretty(&rec).unwrap()).unwrap();
}

async fn open_with_gas(ix: &ic::Ix, who: &Account, id: &str, tgas: u64) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(who.call(ix.launcher.id(), "open_instant").args_json(ic::lid(id)).gas(Gas::from_tgas(tgas)).transact().await?)
}

/// Fresh creator + launch seeded with `seed` USDC.
async fn seeded_for(ix: &ic::Ix, n: usize, seed: u128) -> anyhow::Result<(Account, String)> {
    let c = ix.user(&format!("c{n}"), seed).await?;
    let mut p = ic::params(&format!("GS{n}"));
    p["seed_q"] = json!(seed.to_string());
    let id = ix.create_ready(&c, p, None).await?;
    ix.seed(&c, &id, seed).await?.into_result()?;
    Ok((c, id))
}

/// C-01: sweep the prepaid gas of open_instant against the real market and classify each outcome by the on-chain state.
#[tokio::test]
async fn k_c01_open_instant_gas_sweep() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let stranger = ix.user("stranger", 0).await?;
    let mut rows = vec![];
    let mut stranded_ids: Vec<(u64, String, Account)> = vec![];
    let sweep: Vec<u64> = vec![240, 243, 244, 245, 246, 248, 250, 255, 260, 270, 280, 290, 300];
    for (i, g) in sweep.iter().copied().enumerate() {
        let (creator, id) = seeded_for(&ix, i, 100 * U).await?;
        let r = open_with_gas(&ix, &stranger, &id, g).await?;
        let inst = ix.inst(&id).await;
        let pool: Value = ix.market.view("get_pool").args_json(ic::lid(&id)).await?.json()?;
        let outcome = match (inst["status"].as_str().unwrap(), ic::n(&inst["seed_inflight"]) > 0, ic::n(&inst["seed_due"]) > 0, pool["state"].as_str()) {
            ("Open", _, _, _) => "OPEN",
            ("Handoff", true, _, Some("AwaitToken")) => "STRANDED",
            ("Seeded", _, _, None) => "NOTHING_HAPPENED",
            ("Handoff", false, true, None) => "SEED_REFUSED_RETRYABLE",
            ("Handoff", false, false, Some("AwaitToken")) => "TOKEN_LEG_PENDING_RETRYABLE",
            _ => "OTHER",
        };
        if outcome == "STRANDED" {
            stranded_ids.push((g, id.clone(), creator.clone()));
        }
        rows.push(json!({ "prepaid_tgas": g, "outer_call_success": r.is_success(), "outcome": outcome, "status": inst["status"], "seed_inflight": inst["seed_inflight"],
                          "seed_due": inst["seed_due"], "pool_state": pool["state"], "tx": r.outcome().transaction_hash.to_string(),
                          "total_gas_burnt_tgas": r.total_gas_burnt.as_gas() as f64 / 1e12,
                          "receipts_gas_burnt_tgas": r.outcomes().iter().map(|o| json!({ "executor": o.executor_id.to_string(), "tgas": o.gas_burnt.as_gas() as f64 / 1e12 })).collect::<Vec<_>>() }));
        eprintln!("gas {g}: {outcome}");
    }
    let by = |o: &str| rows.iter().filter(|r| r["outcome"] == o).map(|r| r["prepaid_tgas"].as_u64().unwrap()).collect::<Vec<_>>();
    let (open, stranded) = (by("OPEN"), by("STRANDED"));
    // consequences on one stranded launch
    let mut follow = json!({});
    if let Some((g, id, creator)) = stranded_ids.first() {
        let again = ix.open(&stranger, id).await?;
        let seeded_at = ic::n(&ix.inst(id).await["seeded_at_ns"]) as u64;
        ix.wait_until(seeded_at + 31_000 * MS).await;
        let abort = ix.call(creator, "abort_instant", ic::lid(id)).await?;
        let pool: Value = ix.market.view("get_pool").args_json(ic::lid(id)).await?.json()?;
        follow = json!({ "stranded_at_tgas": g, "launch_id": id,
                         "second_open_at_300_tgas": if ic::has_code(&again, "R_INSTANT_STATE") { "refused R_INSTANT_STATE" } else { "other" },
                         "abort_after_wait": if ic::has_code(&abort, "R_INSTANT_STATE") { "refused R_INSTANT_STATE" } else { "other" },
                         "market_pool_state": pool["state"], "pool_q": pool["q"], "launcher_invariants": ix.view("get_invariants", json!({})).await });
    }
    let result = if stranded.is_empty() { "NOT_EXPLOITABLE" } else { "EXPLOITABLE" };
    let min_safe = open.iter().copied().filter(|g| stranded.iter().all(|s| g > s)).min();
    record(
        "K-C01",
        "C-01",
        "open_instant with too little prepaid gas strands the consumed seed",
        result,
        &format!("prepaid gas that stranded the seed: {stranded:?} Tgas; that opened cleanly: {open:?} Tgas; lowest gas above every stranded value that opened: {min_safe:?}"),
        json!({ "sweep": rows, "stranded_tgas": stranded, "open_tgas": open, "min_safe_tgas": min_safe, "follow_up": follow }),
    );
    let _ = NearToken::from_yoctonear(0);
    Ok(())
}

async fn market_cfg(ix: &ic::Ix) -> Value {
    ix.market.view("get_config").await.unwrap().json().unwrap()
}

async fn trader(ix: &ic::Ix, name: &str, symbol: &str, usdc: u128) -> anyhow::Result<Account> {
    let t = ix.user(name, usdc).await?;
    ix.register_on_token(&ix.token_id(symbol), t.id()).await?;
    Ok(t)
}

async fn buy(ix: &ic::Ix, who: &Account, id: &str, amount: u128) -> near_workspaces::result::ExecutionFinalResult {
    let msg = json!({ "v": 1, "op": "buy", "launch_id": id, "min_out": "1" }).to_string();
    who.call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.market.id(), "amount": amount.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(ic::GAS)
        .transact()
        .await
        .unwrap()
}

/// M-01: one buyer fills the instant sub-cap; other instant pools refuse buys, new seeds are refused by the market and
/// the refused seeds then fill the launcher's aggregate seed cap.
#[tokio::test]
async fn k_m01_sub_cap_grief() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let mut p = ic::params("WHAL");
    p["seed_q"] = json!((1_000 * U).to_string());
    let a = ix.launch_to_open(&ix.creator, p).await?;
    let mut p2 = ic::params("SMLL");
    p2["seed_q"] = json!((100 * U).to_string());
    let c2 = ix.user("small", 100 * U).await?;
    let b = ix.create_ready(&c2, p2, None).await?;
    ix.seed(&c2, &b, 100 * U).await?.into_result()?;
    ix.open(&c2, &b).await?.into_result()?;
    let whale = trader(&ix, "whale", "WHAL", 4_500 * U).await?;
    let cap = ic::n(&market_cfg(&ix).await["max_instant_reserve_q"]);
    let mut spent = 0u128;
    for _ in 0..6 {
        let left = cap - ic::n(&market_cfg(&ix).await["instant_q"]);
        if left < 5 * U {
            break;
        }
        let amt = (left - 2 * U).min(3_900 * U);
        buy(&ix, &whale, &a, amt).await;
        spent += amt;
    }
    let cfg = market_cfg(&ix).await;
    let room = cap - ic::n(&cfg["instant_q"]);
    let bob = trader(&ix, "bob", "SMLL", 50 * U).await?;
    let other_buy = buy(&ix, &bob, &b, 10 * U).await;
    let mut seeds = vec![];
    let mut refused = 0;
    for i in 0..3 {
        let c = ix.user(&format!("sybil{i}"), 1_000 * U).await?;
        let mut pp = ic::params(&format!("SYB{i}"));
        pp["seed_q"] = json!((1_000 * U).to_string());
        let id = ix.create_ready(&c, pp, None).await?;
        ix.seed(&c, &id, 1_000 * U).await?.into_result()?;
        let r = ix.open(&c, &id).await?;
        if ic::has_code(&r, "R_MARKET_CAP") {
            refused += 1;
        }
        seeds.push(id);
    }
    let victim = ix.user("victim", 1_000 * U).await?;
    let mut pv = ic::params("VICT");
    pv["seed_q"] = json!((1_000 * U).to_string());
    let vid = ix.create_ready(&victim, pv, None).await?;
    let vs = ix.seed(&victim, &vid, 1_000 * U).await?;
    let aggregate_blocked = ic::has_code(&vs, "R_CAP_GLOBAL");
    let buy_refused = ic::has_code(&other_buy, "R_MARKET_CAP");
    // the attacker's way out: sell back (costs about two trading fees)
    let held = ix.bal(&ix.token_id("WHAL"), whale.id()).await;
    let msg = json!({ "v": 1, "op": "sell", "launch_id": a, "min_out": "1" }).to_string();
    whale.call(&ix.token_id("WHAL"), "ft_transfer_call").args_json(json!({ "receiver_id": ix.market.id(), "amount": held.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1)).gas(ic::GAS).transact().await?;
    let back = ix.usdc_bal(whale.id()).await;
    let exploitable = buy_refused && refused == 3 && aggregate_blocked;
    record(
        "K-M01",
        "M-01",
        "One buyer fills the $5,000 instant sub-cap; refused seeds then fill the $3,000 launcher aggregate cap",
        if exploitable { "EXPLOITABLE" } else { "NOT_EXPLOITABLE" },
        &format!("whale spent {} USDC of buys and held room {} micro-USDC; a 10 USDC buy in another instant pool refused R_MARKET_CAP: {buy_refused}; 3 of 3 sybil seeds refused by the market: {refused}/3; victim seed refused R_CAP_GLOBAL: {aggregate_blocked}; whale ends with {} of its 4500 USDC after selling everything back (the difference is the cost of the grief)", spent / U, room, back / U),
        json!({ "sub_cap": cap.to_string(), "room_left": room.to_string(), "whale_spent_usdc": spent / U, "whale_after_unwind_usdc": back / U, "sybil_seed_launches": seeds, "victim_launch": vid }),
    );
    Ok(())
}

/// M-02: profile is a free string; "demo" (10 s days) is accepted on a .near account.
#[tokio::test]
async fn k_m02_profile_typo_and_demo_on_a_mainnet_suffix() -> anyhow::Result<()> {
    let mut findings = vec![];
    for profile in ["Mainnet", "prod", "testnet", "demo"] {
        match ic::Ix::new(profile, true).await {
            Err(e) => findings.push(json!({ "profile": profile, "accepted": false, "error": e.to_string().chars().take(160).collect::<String>() })),
            Ok(ix) => {
                let cfg = ix.view("get_config", json!({})).await;
                let stranger = ix.user("stranger", 0).await?;
                ix.predeploy_token("PROF", ic::N_TOTAL).await?;
                let r = ix.create_raw(&stranger, ic::params("PROF"), None).await?;
                findings.push(json!({ "profile": profile, "accepted": true, "account_suffix_near": ix.launcher.id().as_str().ends_with(".near"),
                    "launcher_account": ix.launcher.id(), "creator_gate": cfg["creator_gate"], "launch_fee": cfg["launch_fee"], "unit_ns": cfg["unit_ns"],
                    "stranger_create_instant_ok": r.is_success() && !ic::has_code(&r, "R_CREATOR_GATE") }));
            }
        }
    }
    let typo_open = findings.iter().any(|f| (f["profile"] == "Mainnet" || f["profile"] == "prod") && f["accepted"] == true && f["creator_gate"] == false);
    let demo_on_near = findings.iter().any(|f| f["profile"] == "demo" && f["accepted"] == true && f["account_suffix_near"] == true);
    let testnet_on_near = findings.iter().any(|f| f["profile"] == "testnet" && f["accepted"] == true && f["account_suffix_near"] == true);
    record(
        "K-M02",
        "M-02",
        "Unvalidated profile string: a typo disables the mainnet gate and fee; demo and testnet profiles deploy on a .near account",
        if typo_open || demo_on_near || testnet_on_near { "EXPLOITABLE" } else { "NOT_EXPLOITABLE" },
        &format!("typo profile ('Mainnet' or 'prod') accepted with the gate open: {typo_open}; demo accepted on a .near account: {demo_on_near}; testnet accepted on a .near account: {testnet_on_near}"),
        json!({ "profiles": findings }),
    );
    Ok(())
}

/// M-03: a queued cap raise survives a later guardian lowering and anyone can apply it.
#[tokio::test]
async fn k_m03_queued_raise_survives_a_lowering() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let stranger = ix.user("stranger", 0).await?;
    ix.call(&ix.owner, "set_seed_cap", json!({ "kind": "aggregate", "value": (10_000 * U).to_string() })).await?.into_result()?;
    let low = ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": (500 * U).to_string() })).await?;
    let cfg = ix.view("get_config", json!({})).await;
    let lowered = ic::n(&cfg["seed_cap_aggregate"]);
    let pending = cfg["pending_caps"].clone();
    let survives = pending.to_string().contains("10000000000");
    record(
        "K-M03",
        "M-03",
        "Queued cap raise survives a later guardian lowering and a stranger can apply it once the timelock ends",
        if survives { "EXPLOITABLE" } else { "NOT_EXPLOITABLE" },
        &format!("owner queued 10000 USDC, guardian lowered the cap to {} USDC (lowering ok: {}); get_config.pending_caps still lists the raise: {survives}. The timelock is 7 real days, which the sandbox cannot wait, so the final apply_seed_cap by a stranger was not executed: it is the existing permissionless path (admin.rs apply_seed_cap), which has no check against the lowering", lowered / U, low.is_success()),
        json!({ "cap_after_lowering": lowered.to_string(), "pending_caps_after_lowering": pending, "applied_in_sandbox": false }),
    );
    let _ = stranger;
    Ok(())
}

/// H-01 (sandbox part): a failed creation clears the rate limit. The refund of the factory deposit needs a factory that
/// returns a batch promise; the sandbox mock panics, so that half is measured on testnet (see the testnet evidence).
#[tokio::test]
async fn k_h01_failed_creation_clears_the_rate_limit() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let mut rounds = vec![];
    for i in 0..4 {
        let r = ix.create_raw(&ix.creator, ic::params("HFAI"), None).await?;
        let st = ix.status(&(ic::ID0 + i).to_string()).await;
        let rl = ic::has_code(&r, "R_RATE_LIMIT");
        let refundable = ic::n(&ix.inst(&(ic::ID0 + i).to_string()).await["deposit_refundable"]);
        let paid = ic::n(&ix.inst(&(ic::ID0 + i).to_string()).await["deposit_paid"]);
        rounds.push(json!({ "round": i, "status": st, "rate_limited": rl, "deposit_paid": paid.to_string(), "deposit_refundable": refundable.to_string(), "refund_includes_factory_deposit": refundable == paid - 20_000_000_000_000_000_000_000 }));
    }
    let cleared = rounds.iter().all(|r| r["status"] == "CreationFailed" && r["rate_limited"] == false);
    record(
        "K-H01",
        "H-01",
        "A failed factory call clears the per-account rate limit and is refunded including the factory deposit",
        if cleared { "EXPLOITABLE" } else { "NOT_EXPLOITABLE" },
        &format!("4 failed creations in a row by one account, none rate limited: {cleared}. Sandbox mock panics so the deposit really returns; the drain half (real factory keeps the deposit) is tested on testnet"),
        json!({ "rounds": rounds }),
    );
    Ok(())
}

/// M-04: needs an FT whose ft_transfer returns bytes. mock_ft returns nothing and contracts may not be edited here.
#[tokio::test]
async fn k_m04_market_resolve_payout_with_a_returning_ft() -> anyhow::Result<()> {
    let wasm = ic::wasm("mock_ft");
    let marker = wasm.windows(11).any(|w| w == b"ft_transfer");
    record(
        "K-M04",
        "M-04",
        "Market resolve_payout reads the ft_transfer result with max_len 0",
        "NOT_REPRODUCED",
        "No sandbox fixture can return bytes from ft_transfer (mock_ft returns nothing, and this workstream does not edit or add contracts). Checked instead on testnet against the real factory token: see evidence/instant-testnet.",
        json!({ "mock_ft_exports_ft_transfer": marker, "reason": "needs a returning-FT fixture" }),
    );
    Ok(())
}
