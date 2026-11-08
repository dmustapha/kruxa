//! Attack gallery (SEC-3, narrowed by CHANGE-ORDER-6 E-2): real attack attempts against the REAL core and market wasm in the
//! near-workspaces sandbox. Every attack is one named test that (1) tries the attack, (2) asserts it is refused with the expected
//! rule code (or, for the few that run but achieve nothing, that nothing changed), (3) asserts the victim invariants still hold,
//! (4) writes an evidence record under KRUXA_GALLERY_OUT (default evidence/attack-gallery/records) with the sandbox tx hashes.
//! Run through `make attack-gallery`; `scripts/attack-gallery.sh` aggregates the records into attack-gallery.json.
//! Red mode: KRUXA_GALLERY_SABOTAGE=<attack id> makes that one attack succeed (a test-only switch) to prove the gallery can fail.
mod market_common;
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use market_common as mc;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

// ---------------------------------------------------------------- evidence recorder

/// What the attack is expected to do, declared up front so a wrong outcome cannot be relabelled afterwards.
#[derive(Clone, Copy)]
enum Expect {
    /// Every attack transaction must be refused with the stated rule code.
    Refused,
    /// The attack runs but achieves nothing (idempotent replay, donation, trapped-exit attempt): state is asserted unchanged.
    NoEffect,
    /// The attack is not blocked; it is limited by a stated bound. A disclosed limit, never counted as a win.
    Bounded,
}

impl Expect {
    fn label(self) -> &'static str {
        match self {
            Expect::Refused => "REFUSED",
            Expect::NoEffect => "NO_EFFECT",
            Expect::Bounded => "BOUNDED",
        }
    }
}

struct Attack {
    id: &'static str,
    co4: &'static str,
    title: &'static str,
    target: &'static str,
    attempt: &'static str,
    expect: Expect,
    rule: &'static str,
    txs: Vec<Value>,
    checks: Vec<Value>,
    wrong: bool,
    breached: bool,
}

fn sabotaged(id: &str) -> bool {
    std::env::var("KRUXA_GALLERY_SABOTAGE").map(|v| v == id).unwrap_or(false)
}

/// First rule code in the execution's logs or failures: `R_*`, the bare `STREAM_CAP`, or a near-sdk private-method refusal.
fn code_in(r: &ExecutionFinalResult) -> Option<String> {
    let text = format!("{}\n{:?}", r.logs().join("\n"), r.failures());
    if let Some(c) = scan_rule_code(&text) {
        return Some(c);
    }
    if text.contains("STREAM_CAP") {
        return Some("STREAM_CAP".into());
    }
    text.contains("is private").then(|| "PRIVATE_METHOD".into())
}

fn scan_rule_code(t: &str) -> Option<String> {
    let b = t.as_bytes();
    (0..b.len().saturating_sub(2))
        .filter(|&i| &b[i..i + 2] == b"R_" && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')))
        .find_map(|i| {
            let end = b[i + 2..].iter().position(|c| !(c.is_ascii_uppercase() || *c == b'_')).map_or(b.len(), |p| i + 2 + p);
            (end > i + 2).then(|| t[i..end].trim_end_matches('_').to_string())
        })
}

fn tx_hash(r: &ExecutionFinalResult) -> String {
    r.outcome().transaction_hash.to_string()
}

impl Attack {
    fn new(id: &'static str, co4: &'static str, title: &'static str, target: &'static str, expect: Expect, rule: &'static str) -> Self {
        Attack { id, co4, title, target, attempt: "", expect, rule, txs: vec![], checks: vec![], wrong: false, breached: false }
    }

    fn attempt(mut self, text: &'static str) -> Self {
        self.attempt = text;
        self
    }

    fn row(&mut self, role: &str, label: &str, r: &ExecutionFinalResult, want: &str) {
        let observed = code_in(r);
        let status = if r.is_success() { "succeeded" } else { "failed" };
        self.txs.push(json!({ "role": role, "label": label, "tx": tx_hash(r), "network": "SANDBOX", "status": status,
                              "rule_code": observed, "expected_rule_code": (!want.is_empty()).then_some(want) }));
        if role == "attack" && !want.is_empty() {
            self.wrong |= observed.as_deref() != Some(want);
            self.breached |= observed.is_none() && r.is_success();
        }
    }

    /// An attack transaction. `want` is the rule code it must be refused with; "" when the attack is expected to run and do nothing.
    fn attack(&mut self, label: &str, r: &ExecutionFinalResult, want: &str) {
        self.row("attack", label, r, want);
    }

    /// A supporting transaction (setup the attacker depends on, or a victim exit used as proof). Not judged.
    fn step(&mut self, label: &str, r: &ExecutionFinalResult) {
        self.row("support", label, r, "");
    }

    fn check(&mut self, what: &str, ok: bool) {
        self.checks.push(json!({ "what": what, "ok": ok }));
        self.wrong |= !ok;
    }

    /// Writes the evidence record first (so a red run is recorded), then fails the test if anything went wrong.
    fn finish(self, invariants: Value, invariants_ok: bool) {
        let result = if self.breached {
            "SUCCEEDED_UNEXPECTEDLY"
        } else if self.wrong || !invariants_ok {
            "FAILED"
        } else {
            self.expect.label()
        };
        let rec = json!({ "id": self.id, "co4": self.co4, "title": self.title, "target": self.target, "attempt": self.attempt,
                          "expected_result": self.expect.label(), "expected_rule_code": self.rule, "result": result,
                          "network": "SANDBOX", "transactions": self.txs, "checks": self.checks,
                          "invariants_after": invariants, "invariants_ok": invariants_ok });
        let dir = std::env::var("KRUXA_GALLERY_OUT")
            .unwrap_or_else(|_| format!("{}/../evidence/attack-gallery/records", env!("CARGO_MANIFEST_DIR")));
        std::fs::create_dir_all(&dir).expect("create records dir");
        std::fs::write(format!("{dir}/{}.json", self.id), serde_json::to_string_pretty(&rec).unwrap()).expect("write record");
        assert_eq!(result, self.expect.label(), "{} {}: {rec:#}", self.id, self.title);
    }
}

async fn core_inv(env: &Env) -> (Value, bool) {
    let mut all = vec![];
    for id in 1..env.next_id.get() {
        all.push(json!({ "launch_id": id, "get_invariants": env.view("get_invariants", lid(id)).await }));
    }
    let ok = all.iter().all(|v| v["get_invariants"]["all_ok"] == true);
    (json!(all), ok)
}

async fn market_inv(mk: &mc::Mk, ids: &[u64]) -> (Value, bool) {
    let global = mk.view("get_invariants", json!({})).await;
    let mut ok = global["usdc_custody_identity"] == true;
    let mut pools = vec![];
    for id in ids {
        let p = mk.view("pool_invariants", json!({ "launch_id": id.to_string() })).await;
        ok &= p["token_custody_identity"] == true && p["k_ge_k0"] == true;
        pools.push(json!({ "launch_id": id, "pool_invariants": p }));
    }
    (json!({ "market": global, "pools": pools }), ok)
}

// ---------------------------------------------------------------- core fixtures

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

async fn buyers(env: &Env, id: u64, n: usize, each: u128) -> anyhow::Result<Vec<Account>> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, each, None).await.is_success());
        users.push(u);
    }
    Ok(users)
}

/// A launch with 12 buyers of 40 USDC, settled PASS with every position settled and the residue swept (stream open).
async fn passed_launch(env: &Env, sym: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let id = env.create_launch(&params(sym)).await?;
    let users = buyers(env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.json::<bool>()?, "480 USDC from 12 funders must PASS");
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    Ok((id, users))
}

/// A launch with 5 buyers of 30 USDC (150 is under the soft cap), settled FAIL.
async fn failed_launch(env: &Env, sym: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let id = env.create_launch(&params(sym)).await?;
    let users = buyers(env, id, 5, 30 * USDC).await?;
    env.advance_to(id, "Ready").await;
    assert!(!env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?, "150 USDC is below the soft cap");
    Ok((id, users))
}

async fn stranger(env: &Env, name: &str) -> anyhow::Result<Account> {
    env.user(name, 0).await
}

// ---------------------------------------------------------------- core attacks: creator stream

#[tokio::test]
async fn a01_draw_before_pass() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A01")).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    let mut a = Attack::new("A01", "A5", "Creator draws before PASS", "core", Expect::Refused, "R_NOT_CLEAR")
        .attempt("The stream recipient calls draw while the launch is still Open (no verdict), once with an amount and once for everything.");
    let (core_before, creator_before) = (env.usdc_balance(env.core.id()).await, env.usdc_balance(env.creator.id()).await);
    let r1 = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1000000" }), ZERO).await;
    a.attack("draw(1 USDC) on an Open launch", &r1, "R_NOT_CLEAR");
    let r2 = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": null }), ZERO).await;
    a.attack("draw(all) on an Open launch", &r2, "R_NOT_CLEAR");
    a.check("core USDC balance unchanged", env.usdc_balance(env.core.id()).await == core_before);
    a.check("creator USDC balance unchanged", env.usdc_balance(env.creator.id()).await == creator_before);
    a.check("ledger shows nothing drawn", env.view("get_ledger", lid(id)).await["stream_drawn"] == "0");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

async fn stream_attempt(sym: &'static str, id: &'static str, title: &'static str, half: bool) -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (launch, _) = passed_launch(&env, sym).await?;
    let text = if half {
        "Right after PASS the creator asks draw() for half of the whole stream, far above the linearly unlocked amount."
    } else {
        "Right after PASS the creator asks draw() for the whole stream at once (withdraw-all)."
    };
    let mut a = Attack::new(id, "A4", title, "core", Expect::Refused, "STREAM_CAP").attempt(text);
    let s = env.view("stream_status", lid(launch)).await;
    let total: u128 = s["total"].as_str().unwrap().parse()?;
    let want = if half { total / 2 } else { total };
    let cap: u128 = s["cap"].as_str().unwrap().parse()?;
    a.check("precondition: the unlocked cap is below the requested amount", cap < want);
    let (core_before, creator_before) = (env.usdc_balance(env.core.id()).await, env.usdc_balance(env.creator.id()).await);
    let r = env.call(&env.creator, "draw", json!({ "launch_id": launch.to_string(), "amount": want.to_string() }), ZERO).await;
    a.attack(if half { "draw(half of stream_total)" } else { "draw(stream_total)" }, &r, "STREAM_CAP");
    a.check("creator USDC balance unchanged", env.usdc_balance(env.creator.id()).await == creator_before);
    a.check("core USDC balance unchanged", env.usdc_balance(env.core.id()).await == core_before);
    let after = env.view("stream_status", lid(launch)).await;
    a.check("stream drawn and inflight both zero", after["drawn"] == "0" && after["inflight"] == "0");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a02_draw_all_after_pass() -> anyhow::Result<()> {
    stream_attempt("A02", "A02", "Creator draws the whole stream right after PASS", false).await
}

#[tokio::test]
async fn a03_draw_half_after_pass() -> anyhow::Result<()> {
    stream_attempt("A03", "A03", "Creator draws half the stream right after PASS", true).await
}

#[tokio::test]
async fn a04_draw_by_non_recipient_and_recipient_stays_fixed() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _) = passed_launch(&env, "A04").await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("A04", "A6", "Non-recipient draws the creator stream (redirect of the payout)", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("An unrelated account calls draw on a PASSed launch, hoping to pull the stream to itself; the stream recipient must stay the creator.");
    let before = env.view("stream_status", lid(id)).await["recipient"].clone();
    let eve_before = env.usdc_balance(eve.id()).await;
    let r = env.call(&eve, "draw", json!({ "launch_id": id.to_string(), "amount": "1000000" }), ZERO).await;
    a.attack("draw by an unrelated account", &r, "R_NOT_AUTHORIZED");
    a.check("attacker received nothing", env.usdc_balance(eve.id()).await == eve_before);
    a.check("stream recipient is still the creator", env.view("stream_status", lid(id)).await["recipient"] == before && before == json!(env.creator.id()));
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- core attacks: verdict

#[tokio::test]
async fn a05_settle_before_the_deadline() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A05")).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    let mut a = Attack::new("A05", "A7", "Forged verdict: settle before the deadline", "core", Expect::Refused, "R_TOO_EARLY")
        .attempt("settle() is called while the commit window is open and again during the Walk tail, to fix the verdict early.");
    let eve = stranger(&env, "eve").await?;
    a.attack("settle during the commit window", &env.call(&eve, "settle", lid(id), ZERO).await, "R_TOO_EARLY");
    env.advance_to(id, "Closing").await;
    a.attack("settle during the Walk tail", &env.call(&eve, "settle", lid(id), ZERO).await, "R_TOO_EARLY");
    a.check("launch is still Open with no settlement", env.view("get_settlement", lid(id)).await.is_null() && env.state(id).await["status"] == "Open");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a06_settle_twice_replays_the_same_verdict() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A06")).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Ready").await;
    let mut a = Attack::new("A06", "", "Replayed verdict: settle called twice", "core", Expect::NoEffect, "")
        .attempt("After the verdict is fixed a second account calls settle again, hoping to re-run allocation or flip the outcome.");
    let first = env.call(&env.creator, "settle", lid(id), ZERO).await;
    a.step("first settle (PASS)", &first);
    let snap = (env.view("get_settlement", lid(id)).await, env.view("get_ledger", lid(id)).await, env.view("get_verdict_inputs", lid(id)).await);
    let eve = stranger(&env, "eve").await?;
    let again = env.call(&eve, "settle", lid(id), ZERO).await;
    a.attack("second settle by another account", &again, "");
    a.check("no second verdict event emitted", !again.logs().iter().any(|l| l.contains("\"verdict\"")));
    a.check("returns the same PASS", again.json::<bool>().unwrap_or(false));
    a.check("settlement, ledger and verdict inputs byte-identical", snap == (env.view("get_settlement", lid(id)).await, env.view("get_ledger", lid(id)).await, env.view("get_verdict_inputs", lid(id)).await));
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a07_replayed_settlement_steps() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _) = passed_launch(&env, "A07").await?;
    let mut a = Attack::new("A07", "", "Replayed settlement steps after the sweep", "core", Expect::Refused, "R_NOT_CLEAR")
        .attempt("sweep_residue is called a second time to move the rounding residue twice; settle_positions_page is replayed over the same range.");
    let eve = stranger(&env, "eve").await?;
    let snap = (env.view("get_ledger", lid(id)).await, env.view("get_settlement", lid(id)).await);
    a.attack("second sweep_residue", &env.call(&eve, "sweep_residue", lid(id), ZERO).await, "R_NOT_CLEAR");
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    let replay = env.call(&eve, "settle_positions_page", page, ZERO).await;
    a.attack("replayed settle_positions_page (runs, settles nothing)", &replay, "");
    a.check("ledger and settlement unchanged", snap == (env.view("get_ledger", lid(id)).await, env.view("get_settlement", lid(id)).await));
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a08_donation_cannot_flip_the_verdict() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A08")).await?;
    let users = buyers(&env, id, 5, 30 * USDC).await?;
    let whale = env.user("whale", 5_000 * USDC).await?;
    let mut a = Attack::new("A08", "", "Manipulated book: donate USDC to core to push a failing launch over the soft cap", "core", Expect::NoEffect, "")
        .attempt("A whale sends 2,000 USDC straight to core (no commit message) before the deadline so held funds exceed the soft cap.");
    let inputs_before = env.view("get_verdict_inputs", lid(id)).await;
    let ledger_before = env.view("get_ledger", lid(id)).await;
    let donate = whale
        .call(env.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": env.core.id(), "amount": (2_000 * USDC).to_string() }))
        .deposit(ONE)
        .transact()
        .await?;
    a.attack("ft_transfer 2,000 USDC to core with no message", &donate, "");
    a.check("the donation really arrived at core", env.usdc_balance(env.core.id()).await == (150 + 2_000) * USDC);
    a.check("verdict inputs unchanged", env.view("get_verdict_inputs", lid(id)).await == inputs_before);
    a.check("ledger credited and open counters unchanged", env.view("get_ledger", lid(id)).await == ledger_before);
    env.advance_to(id, "Ready").await;
    let settled = env.call(&env.creator, "settle", lid(id), ZERO).await;
    a.step("settle", &settled);
    a.check("verdict is still FAIL", !settled.json::<bool>()?);
    let r = env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    a.step("buyer claims refund", &r);
    a.check("refund equals the commit exactly", env.usdc_balance(users[0].id()).await == 1_000 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- core attacks: callbacks and tokens

async fn deploy_fake_usdc(env: &Env, attacker: &Account) -> anyhow::Result<near_workspaces::Contract> {
    let root = env.worker.root_account()?;
    let acct = root.create_subaccount("fake").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let wasm = std::fs::read(format!("{}/../target/near/mock_ft/mock_ft.wasm", env!("CARGO_MANIFEST_DIR")))?;
    let fake = acct.deploy(&wasm).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": env.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    fake.call("mint").args_json(json!({ "account_id": attacker.id(), "amount": (500 * USDC).to_string() })).transact().await?.into_result()?;
    let reg = json!({ "account_id": env.core.id() });
    env.owner.call(fake.id(), "storage_deposit").args_json(reg).deposit(NearToken::from_millinear(2)).transact().await?.into_result()?;
    Ok(fake)
}

#[tokio::test]
async fn a09_fake_token_calls_the_core_intake() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A09")).await?;
    let eve = stranger(&env, "eve").await?;
    let fake = deploy_fake_usdc(&env, &eve).await?;
    let mut a = Attack::new("A09", "A8", "Fake token pays into core intake", "core", Expect::Refused, "R_UNEXPECTED_TOKEN")
        .attempt("A look-alike FT contract the attacker controls sends 50 'USDC' to core with a valid commit message.");
    let r = eve
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": env.core.id(), "amount": (50 * USDC).to_string(), "msg": msg(id, None, None) }))
        .deposit(ONE)
        .gas(GAS)
        .transact()
        .await?;
    a.attack("fake.ft_transfer_call(core, 50, commit)", &r, "R_UNEXPECTED_TOKEN");
    a.check("no position credited (total_active zero)", env.state(id).await["total_active"] == "0");
    let bal: String = fake.view("ft_balance_of").args_json(json!({ "account_id": eve.id() })).await?.json()?;
    a.check("fake tokens handed back to the attacker", bal == (500 * USDC).to_string());
    env.assert_invariants().await;
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a10_direct_callbacks_on_core() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A10")).await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("A10", "A9", "Direct calls to the Intents hook and to the payout callback", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("An attacker calls mt_on_transfer directly (pretending to be intents.near), on_payout directly (to settle a fake payout), and ft_on_transfer directly (pretending to be USDC).");
    let mt = json!({ "sender_id": eve.id(), "previous_owner_ids": [eve.id()], "token_ids": [format!("nep141:{}", env.usdc.id())], "amounts": ["30000000"], "msg": msg(id, None, None) });
    a.attack("direct mt_on_transfer", &env.worker_call(&eve, env.core.id(), "mt_on_transfer", mt).await, "R_NOT_AUTHORIZED");
    let op = json!({ "op": { "kind": "Stream", "launch_id": id.to_string(), "holder": null, "amount": "1" } });
    a.attack("direct on_payout", &env.worker_call(&eve, env.core.id(), "on_payout", op).await, "PRIVATE_METHOD");
    let ft = json!({ "sender_id": eve.id(), "amount": "30000000", "msg": msg(id, None, None) });
    let r = env.worker_call(&eve, env.core.id(), "ft_on_transfer", ft).await;
    a.attack("direct ft_on_transfer from a plain account", &r, "R_UNEXPECTED_TOKEN");
    a.check("nothing credited", env.state(id).await["total_active"] == "0");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a11_non_owner_calls_owner_only_methods() -> anyhow::Result<()> {
    let env = Env::new().await?;
    env.create_launch(&params("A11")).await?;
    let mut a = Attack::new("A11", "", "Non-owner calls the owner-only admin methods (pause, caps, unpause)", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("The creator and the guardian call methods that need the owner (or owner or guardian): pause, freeze, unpause, queue_global_cap, queue_launch_cap, lower_global_cap.");
    let cfg_before = env.view("get_config", json!({})).await;
    let first_actor = if sabotaged("A11") { &env.owner } else { &env.creator };
    let calls: Vec<(&Account, &str, Value)> = vec![
        (first_actor, "pause", json!({})),
        (&env.creator, "freeze", json!({})),
        (&env.guardian, "unpause", json!({})),
        (&env.creator, "queue_global_cap", json!({ "value": "999000000000" })),
        (&env.guardian, "queue_launch_cap", json!({ "value": "999000000000" })),
        (&env.creator, "lower_global_cap", json!({ "value": "1" })),
    ];
    for (who, method, args) in calls {
        let r = env.call(who, method, args, ZERO).await;
        a.attack(&format!("{method} by {}", who.id()), &r, "R_NOT_AUTHORIZED");
    }
    a.check("config unchanged: not paused, global cap and pending cap as before", env.view("get_config", json!({})).await == cfg_before);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- core attacks: refunds

#[tokio::test]
async fn a12_double_refund_claim() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "A12").await?;
    let mut a = Attack::new("A12", "", "Double claim of a refund (holder and keeper)", "core", Expect::NoEffect, "")
        .attempt("A refunded buyer claims again, and so does a third party acting as keeper, to be paid twice.");
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) });
    a.step("first claim_refund (legitimate)", &env.call(&users[0], "claim_refund", key.clone(), ZERO).await);
    let again = env.call(&users[0], "claim_refund", key.clone(), ZERO).await;
    a.attack("second claim_refund by the holder", &again, "");
    let keeper = env.call(&env.creator, "claim_refund", key, ZERO).await;
    a.attack("third claim_refund by a keeper", &keeper, "");
    a.check("both repeat claims returned false", !again.json::<bool>()? && !keeper.json::<bool>()?);
    a.check("holder holds exactly the original 1,000 USDC", env.usdc_balance(users[0].id()).await == 1_000 * USDC);
    a.check("ledger refunded exactly one commit", env.view("get_ledger", lid(id)).await["refunded"] == "30000000");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a13_reentrant_refund_claim() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "A13").await?;
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) });
    env.usdc
        .call("set_reenter")
        .args_json(json!({ "account": env.core.id(), "method": "claim_refund", "args": key.to_string() }))
        .transact()
        .await?
        .into_result()?;
    let mut a = Attack::new("A13", "", "Reentrant refund claim from inside the token transfer", "core", Expect::NoEffect, "")
        .attempt("The USDC contract (made hostile for this test) calls claim_refund again from inside ft_transfer, before core's payout callback has run.");
    let r = env.call(&users[1], "claim_refund", key.clone(), ZERO).await;
    a.attack("claim_refund with a reentering token", &r, "");
    a.check("the reentrant call paid nothing (refunded once, 30 USDC)", env.view("get_ledger", lid(id)).await["refunded"] == "30000000");
    a.check("holder refunded exactly once", env.usdc_balance(users[0].id()).await == 1_000 * USDC);
    a.check("position record deleted after the single payment", env.view("get_position", key).await.is_null());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a14_claim_another_holders_refund() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "A14").await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("A14", "A11", "Claim another holder's refund to redirect the money", "core", Expect::NoEffect, "")
        .attempt("An attacker calls claim_refund naming a victim's position, hoping the refund lands in the attacker's account.");
    let key = json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) });
    let r = env.call(&eve, "claim_refund", key, ZERO).await;
    a.attack("claim_refund(victim) called by the attacker", &r, "");
    a.check("attacker received nothing", env.usdc_balance(eve.id()).await == 0);
    a.check("victim paid to their own account, exactly the commit", env.usdc_balance(users[0].id()).await == 1_000 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- core attacks: exits, caps, windows

#[tokio::test]
async fn a15_pause_cannot_trap_exits() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A15")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    let mut a = Attack::new("A15", "", "Pause used to trap holder funds", "core", Expect::NoEffect, "")
        .attempt("The guardian pauses the protocol while a holder is inside; the holder tries to Walk out.");
    a.step("guardian pause", &env.call(&env.guardian, "pause", json!({}), ZERO).await);
    a.step("new commit while paused is refused (R_PAUSED)", &env.commit_native(&u, id, 40 * USDC, None).await);
    let walk = env.call(&u, "walk", lid(id), ONE).await;
    a.attack("holder Walk while PAUSED", &walk, "");
    a.check("Walk succeeded and returned the whole commit", walk.is_success() && env.usdc_balance(u.id()).await == 1_000 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a16_freeze_blocks_exits_but_only_for_seven_days() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A16")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    let mut a = Attack::new("A16", "", "Freeze blocks exits (disclosed limit: bounded to 7 days)", "core", Expect::Bounded, "R_FROZEN")
        .attempt("The guardian freezes the protocol and the holder tries to Walk. This is NOT blocked by design; it is bounded by auto-expiry and an owner unpause.");
    a.step("guardian freeze", &env.call(&env.guardian, "freeze", json!({}), ZERO).await);
    a.attack("holder Walk while FROZEN", &env.call(&u, "walk", lid(id), ONE).await, "R_FROZEN");
    a.check("config reports Frozen", env.view("get_config", json!({})).await["pause"] == "Frozen");
    let until = kruxa_logic::frozen_until(1_000);
    a.check("bound (pure-logic check, not a sandbox wait): freeze ends 7 days after it starts", until - 1_000 == 7 * 86_400 * 1_000_000_000 && until == kruxa_logic::FREEZE_MAX_NS + 1_000);
    a.check("bound (pure-logic check): effective level at the end of the freeze is Paused, not Frozen", kruxa_logic::pause_at(kruxa_logic::Pause::Frozen, until, until) == kruxa_logic::Pause::Paused);
    a.step("owner unpause", &env.call(&env.owner, "unpause", json!({}), ZERO).await);
    let walk = env.call(&u, "walk", lid(id), ONE).await;
    a.step("holder Walk after unpause", &walk);
    a.check("after the owner lifts it the holder exits with the full commit", env.usdc_balance(u.id()).await == 1_000 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a17_oversubscription_beyond_the_ceiling() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("A17");
    p.hard_cap = 500 * USDC;
    let id = env.create_launch(&p).await?;
    let mut a = Attack::new("A17", "", "Oversubscription beyond twice the hard cap", "core", Expect::Refused, "R_CAP_LAUNCH")
        .attempt("Ten wallets fill the 1,000 USDC ceiling (twice the 500 hard cap); an eleventh tries to add 100 USDC more.");
    for i in 0..10u8 {
        let h = sol_holder(100 + i);
        env.fund_intents(&h.hex, 100 * USDC).await?;
        assert!(env.commit_s3(&h, id, 100 * USDC, 0).await.is_success());
    }
    let late = sol_holder(120);
    env.fund_intents(&late.hex, 100 * USDC).await?;
    a.attack("eleventh commit over the ceiling", &env.commit_s3(&late, id, 100 * USDC, 0).await, "R_CAP_LAUNCH");
    a.check("total_active stays at the 1,000 USDC ceiling", env.state(id).await["total_active"] == (1_000 * USDC).to_string());
    a.check("the refused amount is back on the attacker's Intents balance", env.intents_balance(&late.hex).await == 100 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a18_one_wallet_over_the_per_wallet_cap() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A18")).await?;
    let u = env.user("whale", 1_000 * USDC).await?;
    let mut a = Attack::new("A18", "", "One wallet exceeds the per-wallet cap (single and cumulative)", "core", Expect::Refused, "R_CAP_ACCOUNT")
        .attempt("One wallet commits 101 USDC at once, then 60 + 50 USDC across two commits, to exceed the 100 USDC per-wallet cap.");
    a.attack("single commit of 101 USDC", &env.commit_native(&u, id, 101 * USDC, None).await, "R_CAP_ACCOUNT");
    a.step("commit 60 USDC (inside the cap)", &env.commit_native(&u, id, 60 * USDC, None).await);
    a.attack("second commit pushes the wallet to 110 USDC", &env.commit_native(&u, id, 50 * USDC, None).await, "R_CAP_ACCOUNT");
    a.check("wallet holds exactly the 60 USDC that was accepted", env.state(id).await["total_active"] == (60 * USDC).to_string());
    a.check("the refused amounts came back", env.usdc_balance(u.id()).await == 940 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a19_sybil_split_across_wallets_is_bounded_not_blocked() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A19")).await?;
    let mut a = Attack::new("A19", "", "Sybil: one actor splits capital over 12 wallets", "core", Expect::Bounded, "R_CAP_ACCOUNT")
        .attempt("One actor tries 360 USDC from a single wallet (refused), then splits it into 12 wallets of 30 USDC to reach the soft cap and the funder minimum. The contract cannot see identity, so the split is NOT blocked.");
    let one = env.user("sybil-main", 1_000 * USDC).await?;
    a.attack("single wallet, 360 USDC", &env.commit_native(&one, id, 360 * USDC, None).await, "R_CAP_ACCOUNT");
    for i in 0..12 {
        let w = env.user(&format!("sybil{i}"), 100 * USDC).await?;
        let r = env.commit_native(&w, id, 30 * USDC, None).await;
        a.attack(&format!("split commit {i} of 30 USDC"), &r, "");
    }
    env.advance_to(id, "Ready").await;
    let verdict = env.call(&env.creator, "settle", lid(id), ZERO).await;
    a.step("settle", &verdict);
    a.check("DISCLOSED LIMIT: the split reaches PASS (the contract cannot tell the 12 wallets are one actor)", verdict.json::<bool>()?);
    a.check("bound: total accepted is exactly the capital the actor put at risk (360 USDC), under the per-launch ceiling", env.state(id).await["total_active"] == (360 * USDC).to_string());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a20_late_walk_after_the_deadline() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A20")).await?;
    let users = buyers(&env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Ready").await;
    let mut a = Attack::new("A20", "", "Late Walk after the Walk window closed", "core", Expect::Refused, "R_WALK_CLOSED")
        .attempt("A holder who sees the book heading to PASS calls walk after the Walk tail ended, to shrink the book and grief the verdict.");
    let bal = env.usdc_balance(users[1].id()).await;
    a.attack("walk after walk_end", &env.call(&users[1], "walk", lid(id), ONE).await, "R_WALK_CLOSED");
    a.check("position kept, book unchanged (12 funders, 480 USDC)", env.state(id).await["active_funders"] == 12 && env.state(id).await["total_active"] == (480 * USDC).to_string());
    a.check("no funds moved", env.usdc_balance(users[1].id()).await == bal);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a21_commit_after_the_window() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A21")).await?;
    let users = buyers(&env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Closing").await;
    let mut a = Attack::new("A21", "", "Late commit after the commit window", "core", Expect::Refused, "R_WRONG_PHASE")
        .attempt("A buyer sends a commit after commit_end to tip the book after seeing the Walk tail.");
    let late = env.user("late", 1_000 * USDC).await?;
    a.attack("commit during the Walk tail", &env.commit_native(&late, id, 40 * USDC, None).await, "R_WRONG_PHASE");
    a.check("late buyer refunded in full", env.usdc_balance(late.id()).await == 1_000 * USDC);
    a.check("book unchanged", env.state(id).await["total_active"] == (480 * USDC).to_string() && users.len() == 12);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a22_token_claim_before_pass() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A22")).await?;
    let users = buyers(&env, id, 3, 40 * USDC).await?;
    let mut a = Attack::new("A22", "", "Claim launch tokens before PASS (open and failed launches)", "core", Expect::Refused, "R_WRONG_PHASE")
        .attempt("A holder calls claim_tokens while the launch is still Open, then again after it FAILED, to extract tokens without a verdict.");
    a.attack("claim_tokens while Open", &env.call(&users[0], "claim_tokens", lid(id), ONE).await, "R_WRONG_PHASE");
    env.advance_to(id, "Ready").await;
    a.step("settle (FAIL: 3 funders)", &env.call(&env.creator, "settle", lid(id), ZERO).await);
    a.attack("claim_tokens after FAIL", &env.call(&users[0], "claim_tokens", lid(id), ONE).await, "R_WRONG_PHASE");
    a.check("no launch tokens moved to the attacker", env.token_balance("A22", users[0].id()).await == 0);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a23_creator_buys_their_own_launch() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A23")).await?;
    env.usdc.call("mint").args_json(json!({ "account_id": env.creator.id(), "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    let mut a = Attack::new("A23", "", "Creator wash-buys their own launch", "core", Expect::Refused, "R_SELF_BUY")
        .attempt("The creator commits 30 USDC to their own launch to fake demand.");
    a.attack("creator commit", &env.commit_native(&env.creator, id, 30 * USDC, None).await, "R_SELF_BUY");
    a.check("book empty and creator refunded", env.state(id).await["total_active"] == "0" && env.usdc_balance(env.creator.id()).await == 100 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a24_forged_and_replayed_signed_walk() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A24")).await?;
    let h = sol_holder(9);
    env.fund_intents(&h.hex, 100 * USDC).await?;
    assert!(env.commit_s3(&h, id, 60 * USDC, 0).await.is_success());
    let mut a = Attack::new("A24", "", "Forged, expired and replayed signed Walk", "core", Expect::Refused, "R_SIG")
        .attempt("An attacker submits walk_signed for a Solana holder with (1) a signature from the attacker's own key, (2) an expired deadline, then replays the victim's valid signed walk.");
    let far = u64::MAX / 2;
    let pre = |n: u64, d: u64| format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env.core.id(), id, h.key(), n, d);
    let call = |n: u64, d: u64, sig: String| {
        let args = json!({ "launch_id": id.to_string(), "holder": h.key(), "nonce": n.to_string(), "deadline": d.to_string(), "signature": sig });
        env.worker_call(&env.creator, env.core.id(), "walk_signed", args)
    };
    a.attack("signature made by the attacker's key", &call(1, far, sol_holder(10).sign(&pre(1, far))).await, "R_SIG");
    a.attack("expired deadline", &call(1, 5, h.sign(&pre(1, 5))).await, "R_DEADLINE");
    a.check("position untouched by the forged attempts", env.intents_balance(&h.hex).await == 40 * USDC);
    let good = call(1, far, h.sign(&pre(1, far))).await;
    a.step("victim's own valid signed Walk", &good);
    a.attack("replay of the victim's signed Walk (same nonce)", &call(1, far, h.sign(&pre(1, far))).await, "R_NONCE");
    a.check("refunded exactly once to the holder's Intents balance", env.intents_balance(&h.hex).await == 100 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a25_second_trial_and_symbol_squat() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("A25")).await?;
    let mut a = Attack::new("A25", "", "Creator opens a second trial while one is active", "core", Expect::Refused, "R_ACTIVE_TRIAL")
        .attempt("The same creator calls create_trial again with a new symbol to hold more than one slot against the global cap.");
    let p = params("A25B");
    let need: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
    let r = env.call(&env.creator, "create_trial", json!({ "params": p, "stream_recipient": null }), NearToken::from_yoctonear(need.parse()?)).await;
    a.attack("second create_trial by the same creator", &r, "R_ACTIVE_TRIAL");
    a.check("only launch 1 exists", env.view("get_state", lid(id + 1)).await.is_null());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- market attacks

#[tokio::test]
async fn m01_fake_token_calls_the_market() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let root = mk.worker.root_account()?;
    let fake = mc::deploy_ft(&root, "fake").await?;
    mk.mint(&fake, mk.market.id(), 0).await?;
    let eve = mk.user("eve", 0).await?;
    mk.mint(&fake, eve.id(), 500 * mc::USDC).await?;
    let mut a = Attack::new("M01", "A8", "Fake token buys, sells and seeds on the market", "market", Expect::Refused, "R_UNEXPECTED_TOKEN")
        .attempt("A look-alike token is used as 'USDC' for a buy, as the launch token for a sell, and as the seed quote leg for a new pool.");
    let pool_before = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    a.attack("fake-USDC buy", &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::buy_msg(1, 1)).await?, "R_UNEXPECTED_TOKEN");
    a.attack("fake-token sell", &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::sell_msg(1, 1)).await?, "R_UNEXPECTED_TOKEN");
    mk.mint(&fake, mk.core.id(), mc::SEED_Q).await?;
    a.attack("fake seed leg for launch 2", &mk.send(&mk.core, &fake, mc::SEED_Q, mk.seed_msg(2, fake.id())).await?, "R_UNEXPECTED_TOKEN");
    a.check("attacker's fake tokens refunded", mk.bal(&fake, eve.id()).await == 500 * mc::USDC);
    a.check("pool 1 unchanged and no pool 2", mk.view("get_pool", json!({ "launch_id": "1" })).await == pool_before && mk.view("get_pool", json!({ "launch_id": "2" })).await.is_null());
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m02_redirect_the_market_payout_recipient() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    let eve = mk.user("eve", 2_000 * mc::USDC).await?;
    let mut a = Attack::new("M02", "A12", "Redirect the market payout recipient at pool opening", "market", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("An attacker seeds a pool for launch 1 naming themselves as payout recipient; after the real handoff they try to seed again over the open pool.");
    let mut seed: Value = serde_json::from_str(&mk.seed_msg(1, mk.token.id()))?;
    seed["payout_recipient"] = json!(eve.id());
    a.attack("seed_quote from a non-core sender naming the attacker as recipient", &mk.send(&eve, &mk.usdc, mc::SEED_Q, seed.to_string()).await?, "R_NOT_AUTHORIZED");
    a.check("no pool was created and the attacker keeps their USDC", mk.view("get_pool", json!({ "launch_id": "1" })).await.is_null() && mk.bal(&mk.usdc, eve.id()).await == 2_000 * mc::USDC);
    mk.open_pool(1).await?;
    mk.mint(&mk.usdc, mk.core.id(), mc::SEED_Q).await?;
    let mut again: Value = serde_json::from_str(&mk.seed_msg(1, mk.token.id()))?;
    again["payout_recipient"] = json!(eve.id());
    a.attack("second seed over the open pool", &mk.send(&mk.core, &mk.usdc, mc::SEED_Q, again.to_string()).await?, "R_DUP_LAUNCH");
    let p = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    a.check("payout recipient is still the creator", p["payout_recipient"] == json!(mk.creator.id()));
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m03_direct_callbacks_on_the_market() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let eve = mk.user("eve", 10 * mc::USDC).await?;
    let mut a = Attack::new("M03", "A9", "Direct calls to the market callback and intake", "market", Expect::Refused, "PRIVATE_METHOD")
        .attempt("An attacker calls resolve_payout directly (to forge a re-credit), calls ft_on_transfer as a plain account, and sends malformed messages.");
    let pool_before = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    let r = eve
        .call(mk.market.id(), "resolve_payout")
        .args_json(json!({ "token": mk.usdc.id(), "account": eve.id(), "amount": "1000000", "reason": "x" }))
        .transact()
        .await?;
    a.attack("direct resolve_payout", &r, "PRIVATE_METHOD");
    let r = eve.call(mk.market.id(), "ft_on_transfer").args_json(json!({ "sender_id": eve.id(), "amount": "100000000", "msg": mc::Mk::buy_msg(1, 1) })).transact().await?;
    a.attack("direct ft_on_transfer from a plain account", &r, "R_UNEXPECTED_TOKEN");
    a.attack("malformed message", &mk.send(&eve, &mk.usdc, 5 * mc::USDC, "{".to_string()).await?, "R_BAD_MSG");
    a.check("pool unchanged and attacker's USDC intact", mk.view("get_pool", json!({ "launch_id": "1" })).await == pool_before && mk.bal(&mk.usdc, eve.id()).await == 10 * mc::USDC);
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m04_non_owner_calls_market_admin_and_claims() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let alice = mk.user("alice", 1_000 * mc::USDC).await?;
    mk.buy(&alice, 1, 500 * mc::USDC, 1).await?.into_result()?;
    let eve = mk.user("eve", 0).await?;
    let mut a = Attack::new("M04", "A12", "Non-recipient and non-owner calls on the market (claim, platform withdraw, pause)", "market", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("An attacker calls claim (creator slice), withdraw_platform, pause and (as the guardian) unpause.");
    let call = |who: &Account, m: &str, args: Value| {
        let (w, id) = (who.clone(), mk.market.id().clone());
        let m = m.to_string();
        async move { w.call(&id, &m).args_json(args).gas(mc::GAS).transact().await.unwrap() }
    };
    let before = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    let who = if sabotaged("M04") { &mk.creator } else { &eve };
    a.attack("claim by a non-recipient", &call(who, "claim", json!({ "launch_id": "1" })).await, "R_NOT_AUTHORIZED");
    a.attack("withdraw_platform by a stranger", &call(&eve, "withdraw_platform", json!({})).await, "R_NOT_AUTHORIZED");
    a.attack("pause by a stranger", &call(&eve, "pause", json!({})).await, "R_NOT_AUTHORIZED");
    a.step("guardian pause", &call(&mk.guardian, "pause", json!({})).await);
    a.attack("unpause by the guardian (owner only)", &call(&mk.guardian, "unpause", json!({})).await, "R_NOT_AUTHORIZED");
    a.check("attacker received nothing", mk.bal(&mk.usdc, eve.id()).await == 0 && mk.bal(&mk.usdc, mk.treasury.id()).await == 0);
    a.check("creator slice untouched", mk.view("creator_status", json!({ "launch_id": "1" })).await["paid"] == before["paid"]);
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m05_reentrant_and_double_creator_claim() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let alice = mk.user("alice", 2_000 * mc::USDC).await?;
    mk.buy(&alice, 1, 500 * mc::USDC, 1).await?.into_result()?;
    let mut a = Attack::new("M05", "", "Reentrant claim from the token contract and a double creator claim", "market", Expect::NoEffect, "")
        .attempt("The launch token is made hostile: during every transfer it calls claim on the market. The creator then claims twice in a row.");
    let hostile = json!({ "account": mk.market.id(), "method": "claim", "args": json!({ "launch_id": "1" }).to_string() });
    mk.token.call("set_reenter").args_json(hostile).transact().await?.into_result()?;
    let r = mk.buy(&alice, 1, 100 * mc::USDC, 1).await?;
    a.attack("buy with a reentering token", &r, "");
    a.check("swap completed once", mc::events(&r, "swap").len() == 1);
    a.check("the token contract, not being the recipient, was paid nothing", mk.bal(&mk.usdc, mk.creator.id()).await == 0);
    let claim = |c: &Account| c.call(mk.market.id(), "claim").args_json(json!({ "launch_id": "1" })).gas(mc::GAS).transact();
    let (c1, c2) = (claim(&mk.creator).await?, claim(&mk.creator).await?);
    a.step("first creator claim (legitimate)", &c1);
    a.attack("second creator claim", &c2, "R_NOTHING_TO_CLAIM");
    let st = mk.view("creator_status", json!({ "launch_id": "1" })).await;
    a.check("creator paid once, never above what has unlocked", mc::n(&st["paid"]) == mk.bal(&mk.usdc, mk.creator.id()).await && mc::n(&st["paid"]) <= mc::n(&st["unlocked"]));
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m06_sandwich_without_min_out() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let victim = mk.user("victim", 500 * mc::USDC).await?;
    let attacker = mk.user("attacker", 1_500 * mc::USDC).await?;
    let mut a = Attack::new("M06", "", "Sandwich: front-run a buy, and trades without min_out", "market", Expect::Refused, "R_MIN_OUT")
        .attempt("The attacker pushes the price up before the victim's buy (which carries a 0.5% slippage bound), and the victim-style buys with no or zero min_out are refused outright.");
    let quote = mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (100 * mc::USDC).to_string() })).await;
    let min_out = mc::n(&quote["out"]) * 995 / 1000;
    a.step("attacker front-run buy (800 USDC)", &mk.buy(&attacker, 1, 800 * mc::USDC, 1).await?);
    a.attack("victim buy after the front-run (min_out breached)", &mk.buy(&victim, 1, 100 * mc::USDC, min_out).await?, "R_MIN_OUT");
    a.check("victim refunded in full, holds no tokens", mk.bal(&mk.usdc, victim.id()).await == 500 * mc::USDC && mk.bal(&mk.token, victim.id()).await == 0);
    let no_min = json!({ "v": 1, "op": "buy", "launch_id": "1" }).to_string();
    a.attack("buy with min_out missing", &mk.send(&victim, &mk.usdc, 10 * mc::USDC, no_min).await?, "R_MIN_OUT");
    a.attack("buy with min_out zero", &mk.send(&victim, &mk.usdc, 10 * mc::USDC, mc::Mk::buy_msg(1, 0)).await?, "R_MIN_OUT");
    a.check("victim balance still 500 USDC", mk.bal(&mk.usdc, victim.id()).await == 500 * mc::USDC);
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m07_donation_to_the_pool_reserves() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    async fn q(mk: &mc::Mk) -> Value {
        mk.view("quote_buy", json!({ "launch_id": "1", "amount_in": (50 * mc::USDC).to_string(), "now_ns": "9999999999999999999" })).await
    }
    let q0 = q(&mk).await;
    let eve = mk.user("eve", 1_000 * mc::USDC).await?;
    let mut a = Attack::new("M07", "", "Donation attack on pool reserves", "market", Expect::NoEffect, "")
        .attempt("An attacker transfers 900 USDC straight to the market (not through a swap) to skew the reserve ratio and the price.");
    let r = eve
        .call(mk.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": mk.market.id(), "amount": (900 * mc::USDC).to_string() }))
        .deposit(ONE)
        .transact()
        .await?;
    a.attack("ft_transfer 900 USDC to the market", &r, "");
    a.check("quote identical before and after (a transfer is not a deposit)", q0 == q(&mk).await);
    let p = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    a.check("reserves unchanged", mc::n(&p["q"]) == mc::SEED_Q && mc::n(&p["t"]) == mc::SEED_T);
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m08_pause_cannot_trap_market_sells() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.open_pool(1).await?;
    let alice = mk.user("alice", 500 * mc::USDC).await?;
    mk.buy(&alice, 1, 100 * mc::USDC, 1).await?.into_result()?;
    let mut a = Attack::new("M08", "", "Pause used to trap holders in the market", "market", Expect::NoEffect, "")
        .attempt("The guardian pauses the market; the holder tries to sell back out.");
    let p = mk.guardian.call(mk.market.id(), "pause").transact().await?;
    a.step("guardian pause", &p);
    let blocked = mk.buy(&alice, 1, 50 * mc::USDC, 1).await?;
    a.check("new buys are refused while paused (R_PAUSED)", has_code(&blocked, "R_PAUSED"));
    let held = mk.bal(&mk.token, alice.id()).await;
    let sell = mk.sell(&alice, 1, held, 1).await?;
    a.attack("holder sells everything while PAUSED", &sell, "");
    a.check("the sell executed and returned USDC", mc::events(&sell, "swap").len() == 1 && mk.bal(&mk.token, alice.id()).await == 0);
    let (inv, ok) = market_inv(&mk, &[1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn m09_global_reserve_cap_across_pools() -> anyhow::Result<()> {
    let mk = mc::Mk::new(Some((5_000 * mc::USDC, 2_100 * mc::USDC))).await?;
    mk.open_pool(1).await?;
    let root = mk.worker.root_account()?;
    let tok2 = mc::deploy_ft(&root, "tok2").await?;
    mk.mint(&tok2, mk.market.id(), 0).await?;
    mk.mint(&tok2, mk.core.id(), mc::SEED_T).await?;
    mk.mint(&mk.usdc, mk.core.id(), mc::SEED_Q).await?;
    mk.send(&mk.core, &mk.usdc, mc::SEED_Q, mk.seed_msg(2, tok2.id())).await?.into_result()?;
    mk.send(&mk.core, &tok2, mc::SEED_T, mc::Mk::leg_msg(2)).await?.into_result()?;
    let alice = mk.user("alice", 1_000 * mc::USDC).await?;
    let mut a = Attack::new("M09", "", "Oversubscription: buy past the global reserve cap", "market", Expect::Refused, "R_MARKET_CAP")
        .attempt("With two pools holding 2,000 USDC against a 2,100 USDC global cap, a buyer sends 150 USDC to one pool.");
    a.attack("buy of 150 USDC past the cap", &mk.buy(&alice, 1, 150 * mc::USDC, 1).await?, "R_MARKET_CAP");
    a.check("buyer refunded in full", mk.bal(&mk.usdc, alice.id()).await == 1_000 * mc::USDC);
    a.step("a 50 USDC buy inside the cap still works", &mk.buy(&alice, 2, 50 * mc::USDC, 1).await?);
    let (inv, ok) = market_inv(&mk, &[1, 2]).await;
    a.finish(inv, ok);
    Ok(())
}

// ---------------------------------------------------------------- creator gate (D-1), payout recipient (D-2), genesis (4.4)

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

async fn create_as(env: &Env, who: &Account, p: TrialParams, extra: Value) -> ExecutionFinalResult {
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await.unwrap().json().unwrap();
    let mut args = json!({ "params": p, "stream_recipient": null });
    args.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
    who.call(env.core.id(), "create_trial")
        .args_json(args)
        .deposit(NearToken::from_yoctonear(required.parse().unwrap()))
        .gas(GAS)
        .transact()
        .await
        .unwrap()
}

#[tokio::test]
async fn g01_creator_gate_bypass() -> anyhow::Result<()> {
    let env = Env::new_with_profile("mainnet").await?;
    let mut a = Attack::new("G01", "", "Creator-gate bypass: non-owner create_trial, open_beta by the wrong caller", "core", Expect::Refused, "R_CREATOR_GATE")
        .attempt("On the mainnet profile a non-owner calls create_trial (plainly, naming the owner as recipient, and with a genesis plan); the guardian and the creator call open_beta; the guardian pauses and the owner unpauses hoping that reopens creation. Then the owner opens the beta and the same creator succeeds.");
    async fn cfg(env: &Env) -> Value {
        env.view("get_config", json!({})).await["creator_gate"].clone()
    }
    a.check("precondition: creator_gate is true on the mainnet profile", cfg(&env).await == true);
    a.attack("create_trial by a non-owner", &create_as(&env, &env.creator, TrialParams::example("G01A"), json!({})).await, "R_CREATOR_GATE");
    let to_owner = json!({ "stream_recipient": env.owner.id() });
    a.attack("create_trial by a non-owner naming the owner as recipient", &create_as(&env, &env.creator, TrialParams::example("G01B"), to_owner).await, "R_CREATOR_GATE");
    a.attack("create_trial by a non-owner with a genesis plan", &create_as(&env, &env.creator, TrialParams::example("G01C"), json!({ "genesis": {} })).await, "R_CREATOR_GATE");
    a.attack("open_beta by the guardian", &env.call(&env.guardian, "open_beta", json!({}), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack("open_beta by the creator", &env.call(&env.creator, "open_beta", json!({}), ZERO).await, "R_NOT_AUTHORIZED");
    a.step("guardian pause", &env.call(&env.guardian, "pause", json!({}), ZERO).await);
    a.step("owner unpause", &env.call(&env.owner, "unpause", json!({}), ZERO).await);
    a.attack("create_trial after pause and unpause", &create_as(&env, &env.creator, TrialParams::example("G01D"), json!({})).await, "R_CREATOR_GATE");
    a.check("gate still closed and no launch exists", cfg(&env).await == true && env.view("get_state", lid(1)).await.is_null());
    a.step("owner open_beta (legitimate)", &env.call(&env.owner, "open_beta", json!({}), ZERO).await);
    a.attack("second open_beta has nothing to do", &env.call(&env.owner, "open_beta", json!({}), ZERO).await, "R_NOTHING");
    let after = create_as(&env, &env.creator, TrialParams::example("G01E"), json!({})).await;
    a.step("non-owner create_trial after open_beta", &after);
    a.check("after open_beta the same non-owner creation passes", after.is_success() && cfg(&env).await == false);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

struct GRound {
    env: Env,
    id: u64,
    relayer: Account,
    leaves: Vec<([u8; 32], u64)>,
}

impl GRound {
    async fn call(&self, who: &Account, method: &str, args: Value) -> ExecutionFinalResult {
        self.env.call(who, method, args, ZERO).await
    }
    fn page(&self, leaves: &[([u8; 32], u64)]) -> Value {
        json!({ "launch_id": self.id.to_string(), "leaves": leaves.iter().map(|(k, a)| json!([kruxa_logic::hex(k), a.to_string()])).collect::<Vec<_>>() })
    }
    fn commit(&self) -> Value {
        json!({ "launch_id": self.id.to_string(), "g_pub": kruxa_logic::hex(&[5u8; 32]) })
    }
    fn confirm(&self, mint: &str) -> Value {
        json!({ "launch_id": self.id.to_string(), "mint": mint, "sigs": ["sig1"], "slot": "777", "ceremony_hash": kruxa_logic::hex(&[4u8; 32]) })
    }
    async fn genesis(&self) -> Value {
        self.env.view("get_genesis", lid(self.id)).await
    }
}

/// PASSED launch with 9 NEAR buyers and 3 Solana buyers (30 USDC each), settled and swept; the owner named `relayer`.
async fn genesis_round(sym: &str) -> anyhow::Result<GRound> {
    let env = Env::new().await?;
    let relayer = env.user("relayer", 0).await?;
    env.owner.call(env.core.id(), "set_genesis_relayer").args_json(json!({ "account": relayer.id() })).transact().await?.into_result()?;
    let id = env.create_launch(&params(sym)).await?;
    for i in 0..9 {
        let u = env.user(&format!("n{i}"), 1_000 * USDC).await?;
        env.commit_native(&u, id, 30 * USDC, None).await.into_result()?;
    }
    let keys: Vec<_> = (0..3).map(|i| sol_holder(40 + i)).collect();
    for h in &keys {
        env.fund_intents(&h.hex, 40 * USDC).await?;
        env.commit_s3(h, id, 30 * USDC, 0).await.into_result()?;
    }
    env.advance_to(id, "Ready").await;
    assert!(env.call(&env.creator, "settle", lid(id), ZERO).await.json::<bool>()?);
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let mut leaves = Vec::new();
    for h in &keys {
        let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
        let amt = |k: &str| pos[k].as_str().unwrap().parse::<u64>().unwrap();
        leaves.push((unhex(&h.hex).try_into().unwrap(), amt("tokens_entitled") + amt("bonus_entitled")));
    }
    leaves.sort();
    Ok(GRound { env, id, relayer, leaves })
}

#[tokio::test]
async fn g02_genesis_calls_by_the_wrong_relayer() -> anyhow::Result<()> {
    let r = genesis_round("G02").await?;
    let eve = stranger(&r.env, "eve").await?;
    let mut a = Attack::new("G02", "", "Genesis ceremony driven by the wrong account", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("A stranger, the owner and the guardian call the relayer-only ceremony methods; a stranger also tries to name a new relayer, abort, and pause or resume the ceremony.");
    let abort = json!({ "launch_id": r.id.to_string(), "reason": "x" });
    let calls: Vec<(&Account, &str, Value)> = vec![
        (&eve, "commit_genesis", r.commit()),
        (&r.env.owner, "commit_genesis", r.commit()),
        (&r.env.guardian, "commit_genesis", r.commit()),
        (&eve, "build_root_page", r.page(&[])),
        (&eve, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[0u8; 32]))),
        (&eve, "attest_log_append", json!({ "launch_id": r.id.to_string(), "attestation_hash": kruxa_logic::hex(&[1u8; 32]) })),
        (&eve, "abort_genesis", abort),
        (&eve, "set_genesis_relayer", json!({ "account": eve.id() })),
        (&eve, "pause_genesis", json!({})),
        (&r.env.guardian, "resume_genesis", json!({})),
    ];
    for (who, method, args) in calls {
        a.attack(&format!("{method} by {}", who.id()), &r.call(who, method, args).await, "R_NOT_AUTHORIZED");
    }
    a.check("genesis still not started", r.genesis().await["status"] == "None");
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g03_genesis_out_of_order_and_twice() -> anyhow::Result<()> {
    let r = genesis_round("G03").await?;
    let mut a = Attack::new("G03", "A2", "Genesis steps out of order, commit twice, abort or confirm with no commit", "core", Expect::Refused, "R_GENESIS_STATE")
        .attempt("The relayer confirms and aborts before any commit, sends root pages before commit, then commits twice.");
    let abort = json!({ "launch_id": r.id.to_string(), "reason": "early" });
    a.attack("confirm_genesis without a commit", &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[0u8; 32]))).await, "R_GENESIS_STATE");
    a.attack("abort_genesis without a commit", &r.call(&r.relayer, "abort_genesis", abort).await, "R_GENESIS_STATE");
    a.attack("build_root_page before commit", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..1])).await, "R_GENESIS_STATE");
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.attack("second commit_genesis", &r.call(&r.relayer, "commit_genesis", r.commit()).await, "R_GENESIS_ALREADY");
    let other = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[6u8; 32]) });
    a.attack("commit_genesis again with a different key (swap the mint)", &r.call(&r.relayer, "commit_genesis", other).await, "R_GENESIS_ALREADY");
    let g = r.genesis().await;
    a.check("committed key and mint unchanged", g["g_pub"] == kruxa_logic::hex(&[5u8; 32]) && g["status"] == "Committed");
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g04_forged_root_page_or_leaf() -> anyhow::Result<()> {
    let r = genesis_round("G04").await?;
    let mut a = Attack::new("G04", "", "Forged Merkle root page or leaf", "core", Expect::Refused, "R_GENESIS_LEAF")
        .attempt("After a valid commit the relayer submits pages with an inflated amount, an invented claimant, out-of-order leaves, an overlapping replay and an oversize page, to get a different Merkle root.");
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    let mut inflated = r.leaves.clone();
    inflated[0].1 += 1;
    a.attack("leaf amount inflated by 1", &r.call(&r.relayer, "build_root_page", r.page(&inflated[..1])).await, "R_GENESIS_LEAF");
    a.attack("invented claimant", &r.call(&r.relayer, "build_root_page", r.page(&[([7u8; 32], 1_000_000)])).await, "R_GENESIS_LEAF");
    let swapped = vec![r.leaves[1], r.leaves[0]];
    a.attack("leaves not ascending", &r.call(&r.relayer, "build_root_page", r.page(&swapped)).await, "R_GENESIS_ORDER");
    a.step("first valid leaf", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..1])).await);
    a.attack("replay of the first leaf (overlap)", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..2])).await, "R_GENESIS_ORDER");
    let oversize: Vec<_> = (0..26u8).map(|i| ([i; 32], 1u64)).collect();
    a.attack("26 leaves in one page", &r.call(&r.relayer, "build_root_page", r.page(&oversize)).await, "R_GENESIS_ARG");
    a.check("only the one valid leaf was accepted, root not ready", r.genesis().await["leaf_count"] == 1 && r.genesis().await["root_ready"] == false);
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g05_confirm_misuse_and_abort_after_confirm() -> anyhow::Result<()> {
    let r = genesis_round("G05").await?;
    let mint = kruxa_logic::hex(&kruxa_logic::genesis::mint_address(&[5u8; 32], &r.id.to_string(), &kruxa_logic::genesis::TOKEN_PROGRAM));
    let mut a = Attack::new("G05", "", "Confirm before the root is complete, wrong mint, abort or re-confirm after confirm", "core", Expect::Refused, "R_GENESIS_STATE")
        .attempt("The relayer confirms with an incomplete root, confirms a mint that is not the committed address, and after a legitimate confirm tries to confirm again, abort, add a page and swap the root.");
    a.step("commit_genesis", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.attack("confirm with an incomplete root", &r.call(&r.relayer, "confirm_genesis", r.confirm(&mint)).await, "R_GENESIS_STATE");
    a.step("all leaves", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await);
    a.attack("confirm naming a different mint", &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[9u8; 32]))).await, "R_GENESIS_ARG");
    a.step("confirm_genesis (legitimate)", &r.call(&r.relayer, "confirm_genesis", r.confirm(&mint)).await);
    let root = r.genesis().await["merkle_root"].clone();
    a.attack("second confirm_genesis", &r.call(&r.relayer, "confirm_genesis", r.confirm(&mint)).await, "R_GENESIS_STATE");
    let abort = json!({ "launch_id": r.id.to_string(), "reason": "late" });
    a.attack("abort_genesis by the relayer after confirm", &r.call(&r.relayer, "abort_genesis", abort.clone()).await, "R_GENESIS_STATE");
    a.attack("abort_genesis by the guardian after confirm", &r.call(&r.env.guardian, "abort_genesis", abort).await, "R_GENESIS_STATE");
    a.attack("build_root_page after confirm", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..1])).await, "R_GENESIS_STATE");
    let g = r.genesis().await;
    a.check("status Confirmed, root and slot unchanged", g["status"] == "Confirmed" && g["merkle_root"] == root && g["slot"] == "777");
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g06_genesis_on_an_open_or_failed_launch() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let relayer = env.user("relayer", 0).await?;
    env.owner.call(env.core.id(), "set_genesis_relayer").args_json(json!({ "account": relayer.id() })).transact().await?.into_result()?;
    let (open_id, _) = {
        let id = env.create_launch(&params("G06A")).await?;
        (id, buyers(&env, id, 3, 40 * USDC).await?)
    };
    let mut a = Attack::new("G06", "A1", "Genesis on an Open launch and on a FAILED launch", "core", Expect::Refused, "R_GENESIS_STATE")
        .attempt("The relayer calls commit_genesis for a launch that is still Open, then for a launch that FAILED, to mint a Solana token for a trial that never passed.");
    let args = |id: u64| json!({ "launch_id": id.to_string(), "g_pub": kruxa_logic::hex(&[5u8; 32]) });
    a.attack("commit_genesis on an Open launch", &env.call(&relayer, "commit_genesis", args(open_id), ZERO).await, "R_GENESIS_STATE");
    env.advance_to(open_id, "Ready").await;
    a.step("settle (FAIL: 3 funders)", &env.call(&env.creator, "settle", lid(open_id), ZERO).await);
    a.attack("commit_genesis on a FAILED launch", &env.call(&relayer, "commit_genesis", args(open_id), ZERO).await, "R_GENESIS_STATE");
    a.check("genesis status None", env.view("get_genesis", lid(open_id)).await["status"] == "None");
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g07_genesis_mint_state_errors_at_create_trial() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut a = Attack::new("G07", "", "Genesis plan that keeps a mint or freeze authority, allows extensions, or breaks the plan rules", "core", Expect::Refused, "R_GENESIS_AUTH")
        .attempt("A creator asks for a plan that leaves the mint authority, the freeze authority or token extensions in place (so the Solana supply could be inflated or frozen), or a reserve, a zero clawback, or an F0 plan with no MPC key.");
    let cases: Vec<(&str, Value, &str)> = vec![
        ("mint authority kept", json!({ "mint_authority_none": false }), "R_GENESIS_AUTH"),
        ("freeze authority kept", json!({ "freeze_authority_none": false }), "R_GENESIS_AUTH"),
        ("extensions allowed", json!({ "extensions_allowed": true }), "R_GENESIS_AUTH"),
        ("reserve_bps above zero", json!({ "reserve_bps": 100 }), "R_GENESIS_ARG"),
        ("clawback_days zero", json!({ "clawback_days": 0 }), "R_GENESIS_ARG"),
        ("F0 mode without an MPC key", json!({ "mode": "F0" }), "R_GENESIS_ARG"),
    ];
    for (label, plan, code) in cases {
        let sym = format!("G07{}", label.len());
        a.attack(label, &create_as(&env, &env.creator, params(&sym), json!({ "genesis": plan })).await, code);
    }
    a.check("no launch was created", env.view("get_state", lid(1)).await.is_null());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g08_abort_is_final_and_pause_stops_the_ceremony() -> anyhow::Result<()> {
    let r = genesis_round("G08").await?;
    let mut a = Attack::new("G08", "", "Re-commit after abort, confirm after abort, ceremony while paused", "core", Expect::Refused, "R_GENESIS_ALREADY")
        .attempt("After the relayer aborts, someone tries to commit again with a fresh key and to confirm; while genesis is paused the relayer tries to commit.");
    a.step("guardian pause_genesis", &r.call(&r.env.guardian, "pause_genesis", json!({})).await);
    a.attack("commit_genesis while genesis is paused", &r.call(&r.relayer, "commit_genesis", r.commit()).await, "R_PAUSED");
    a.step("owner resume_genesis", &r.call(&r.env.owner, "resume_genesis", json!({})).await);
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.step("guardian abort_genesis", &r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "test" })).await);
    let fresh = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[8u8; 32]) });
    a.attack("commit_genesis with a fresh key after abort", &r.call(&r.relayer, "commit_genesis", fresh).await, "R_GENESIS_ALREADY");
    a.attack("confirm_genesis after abort", &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[0u8; 32]))).await, "R_GENESIS_STATE");
    a.attack("build_root_page after abort", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..1])).await, "R_GENESIS_STATE");
    a.check("status stays Aborted", r.genesis().await["status"] == "Aborted");
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn g09_payout_recipient_views_cannot_be_redirected() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = env.user("payee", 0).await?;
    let id = env.create_launch_to(&env.creator, &params("G09"), Some(payee.id())).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    env.call(&env.creator, "settle_positions_page", page, ZERO).await.into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let mut a = Attack::new("G09", "A6", "Redirect the payout recipient (creator and stranger draw; views stay fixed)", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("The creator (who named someone else as payout recipient) and a stranger both call draw on a PASSed launch; afterwards get_charter, get_state and stream_status must still name the payee.");
    let eve = stranger(&env, "eve").await?;
    async fn views(env: &Env, id: u64) -> (Value, Value, Value) {
        (env.view("get_charter", lid(id)).await["payout_recipient"].clone(), env.state(id).await["payout_recipient"].clone(), env.view("stream_status", lid(id)).await["recipient"].clone())
    }
    let before = views(&env, id).await;
    let call = json!({ "launch_id": id.to_string(), "amount": "1000000" });
    a.attack("draw by the creator who is not the recipient", &env.call(&env.creator, "draw", call.clone(), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack("draw by a stranger", &env.call(&eve, "draw", call, ZERO).await, "R_NOT_AUTHORIZED");
    let want = json!(payee.id());
    a.check("get_charter, get_state and stream_status all name the payee before", before.0 == want && before.1 == want && before.2 == want);
    a.check("and are identical after the attacks", views(&env, id).await == before);
    a.check("neither attacker received USDC", env.usdc_balance(eve.id()).await == 0);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}
