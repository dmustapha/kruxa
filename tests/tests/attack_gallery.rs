//! Attack gallery (SEC-3, narrowed by CHANGE-ORDER-6 E-2): real attack attempts against the REAL core and market wasm in the
//! near-workspaces sandbox. Every attack is one named test that (1) tries the attack, (2) asserts it is refused with the expected
//! rule code (or, for the few that run but achieve nothing, that nothing changed), (3) asserts the victim invariants still hold,
//! (4) writes an evidence record under KRUXA_GALLERY_OUT (default evidence/attack-gallery/records) with the sandbox tx hashes.
//! Run through `make attack-gallery`; `scripts/attack-gallery.sh` aggregates the records into attack-gallery.json.
//! Red mode: KRUXA_GALLERY_SABOTAGE=<attack id> makes that one attack succeed (a test-only switch) to prove the gallery can fail.
mod instant_common;
mod market_common;
use instant_common as ic;
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
    let mut a = Attack::new("A01", "A5", "Creator draws before PASS", "core", Expect::Refused, "R_NOT_CLEAR").attempt(
        "The stream recipient calls draw while the launch is still Open (no verdict), once with an amount and once for everything.",
    );
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
    a.check(
        "stream recipient is still the creator",
        env.view("stream_status", lid(id)).await["recipient"] == before && before == json!(env.creator.id()),
    );
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
    a.check(
        "launch is still Open with no settlement",
        env.view("get_settlement", lid(id)).await.is_null() && env.state(id).await["status"] == "Open",
    );
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
    let snap =
        (env.view("get_settlement", lid(id)).await, env.view("get_ledger", lid(id)).await, env.view("get_verdict_inputs", lid(id)).await);
    let eve = stranger(&env, "eve").await?;
    let again = env.call(&eve, "settle", lid(id), ZERO).await;
    a.attack("second settle by another account", &again, "");
    a.check("no second verdict event emitted", !again.logs().iter().any(|l| l.contains("\"verdict\"")));
    a.check("returns the same PASS", again.json::<bool>().unwrap_or(false));
    a.check(
        "settlement, ledger and verdict inputs byte-identical",
        snap == (
            env.view("get_settlement", lid(id)).await,
            env.view("get_ledger", lid(id)).await,
            env.view("get_verdict_inputs", lid(id)).await,
        ),
    );
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn a07_replayed_settlement_steps() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _) = passed_launch(&env, "A07").await?;
    let mut a = Attack::new("A07", "", "Replayed settlement steps after the sweep", "core", Expect::Refused, "R_NOT_CLEAR").attempt(
        "sweep_residue is called a second time to move the rounding residue twice; settle_positions_page is replayed over the same range.",
    );
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
    let mut a = Attack::new(
        "A08",
        "",
        "Manipulated book: donate USDC to core to push a failing launch over the soft cap",
        "core",
        Expect::NoEffect,
        "",
    )
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
    fake.call("mint")
        .args_json(json!({ "account_id": attacker.id(), "amount": (500 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
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
    a.check(
        "bound (pure-logic check, not a sandbox wait): freeze ends 7 days after it starts",
        until - 1_000 == 7 * 86_400 * 1_000_000_000 && until == kruxa_logic::FREEZE_MAX_NS + 1_000,
    );
    a.check(
        "bound (pure-logic check): effective level at the end of the freeze is Paused, not Frozen",
        kruxa_logic::pause_at(kruxa_logic::Pause::Frozen, until, until) == kruxa_logic::Pause::Paused,
    );
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
    let mut a =
        Attack::new("A18", "", "One wallet exceeds the per-wallet cap (single and cumulative)", "core", Expect::Refused, "R_CAP_ACCOUNT")
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
    a.check(
        "bound: total accepted is exactly the capital the actor put at risk (360 USDC), under the per-launch ceiling",
        env.state(id).await["total_active"] == (360 * USDC).to_string(),
    );
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
    let mut a = Attack::new("A20", "", "Late Walk after the Walk window closed", "core", Expect::Refused, "R_WALK_CLOSED").attempt(
        "A holder who sees the book heading to PASS calls walk after the Walk tail ended, to shrink the book and grief the verdict.",
    );
    let bal = env.usdc_balance(users[1].id()).await;
    a.attack("walk after walk_end", &env.call(&users[1], "walk", lid(id), ONE).await, "R_WALK_CLOSED");
    a.check(
        "position kept, book unchanged (12 funders, 480 USDC)",
        env.state(id).await["active_funders"] == 12 && env.state(id).await["total_active"] == (480 * USDC).to_string(),
    );
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
    let mut a =
        Attack::new("A22", "", "Claim launch tokens before PASS (open and failed launches)", "core", Expect::Refused, "R_WRONG_PHASE")
            .attempt(
            "A holder calls claim_tokens while the launch is still Open, then again after it FAILED, to extract tokens without a verdict.",
        );
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
    env.usdc
        .call("mint")
        .args_json(json!({ "account_id": env.creator.id(), "amount": (100 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    let mut a = Attack::new("A23", "", "Creator wash-buys their own launch", "core", Expect::Refused, "R_SELF_BUY")
        .attempt("The creator commits 30 USDC to their own launch to fake demand.");
    a.attack("creator commit", &env.commit_native(&env.creator, id, 30 * USDC, None).await, "R_SELF_BUY");
    a.check(
        "book empty and creator refunded",
        env.state(id).await["total_active"] == "0" && env.usdc_balance(env.creator.id()).await == 100 * USDC,
    );
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
        let args =
            json!({ "launch_id": id.to_string(), "holder": h.key(), "nonce": n.to_string(), "deadline": d.to_string(), "signature": sig });
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
    let r = env
        .call(&env.creator, "create_trial", json!({ "params": p, "stream_recipient": null }), NearToken::from_yoctonear(need.parse()?))
        .await;
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
        .attempt(
            "A look-alike token is used as 'USDC' for a buy, as the launch token for a sell, and as the seed quote leg for a new pool.",
        );
    let pool_before = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    a.attack("fake-USDC buy", &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::buy_msg(1, 1)).await?, "R_UNEXPECTED_TOKEN");
    a.attack("fake-token sell", &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::sell_msg(1, 1)).await?, "R_UNEXPECTED_TOKEN");
    mk.mint(&fake, mk.core.id(), mc::SEED_Q).await?;
    a.attack("fake seed leg for launch 2", &mk.send(&mk.core, &fake, mc::SEED_Q, mk.seed_msg(2, fake.id())).await?, "R_UNEXPECTED_TOKEN");
    a.check("attacker's fake tokens refunded", mk.bal(&fake, eve.id()).await == 500 * mc::USDC);
    a.check(
        "pool 1 unchanged and no pool 2",
        mk.view("get_pool", json!({ "launch_id": "1" })).await == pool_before
            && mk.view("get_pool", json!({ "launch_id": "2" })).await.is_null(),
    );
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
    a.attack(
        "seed_quote from a non-core sender naming the attacker as recipient",
        &mk.send(&eve, &mk.usdc, mc::SEED_Q, seed.to_string()).await?,
        "R_NOT_AUTHORIZED",
    );
    a.check(
        "no pool was created and the attacker keeps their USDC",
        mk.view("get_pool", json!({ "launch_id": "1" })).await.is_null() && mk.bal(&mk.usdc, eve.id()).await == 2_000 * mc::USDC,
    );
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
    let r = eve
        .call(mk.market.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": eve.id(), "amount": "100000000", "msg": mc::Mk::buy_msg(1, 1) }))
        .transact()
        .await?;
    a.attack("direct ft_on_transfer from a plain account", &r, "R_UNEXPECTED_TOKEN");
    a.attack("malformed message", &mk.send(&eve, &mk.usdc, 5 * mc::USDC, "{".to_string()).await?, "R_BAD_MSG");
    a.check(
        "pool unchanged and attacker's USDC intact",
        mk.view("get_pool", json!({ "launch_id": "1" })).await == pool_before && mk.bal(&mk.usdc, eve.id()).await == 10 * mc::USDC,
    );
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
    let mut a = Attack::new(
        "M04",
        "A12",
        "Non-recipient and non-owner calls on the market (claim, platform withdraw, pause)",
        "market",
        Expect::Refused,
        "R_NOT_AUTHORIZED",
    )
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
    let mut a =
        Attack::new("M05", "", "Reentrant claim from the token contract and a double creator claim", "market", Expect::NoEffect, "")
            .attempt(
            "The launch token is made hostile: during every transfer it calls claim on the market. The creator then claims twice in a row.",
        );
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
    a.check(
        "creator paid once, never above what has unlocked",
        mc::n(&st["paid"]) == mk.bal(&mk.usdc, mk.creator.id()).await && mc::n(&st["paid"]) <= mc::n(&st["unlocked"]),
    );
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
    a.check(
        "victim refunded in full, holds no tokens",
        mk.bal(&mk.usdc, victim.id()).await == 500 * mc::USDC && mk.bal(&mk.token, victim.id()).await == 0,
    );
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
    a.attack(
        "create_trial by a non-owner",
        &create_as(&env, &env.creator, TrialParams::example("G01A"), json!({})).await,
        "R_CREATOR_GATE",
    );
    let to_owner = json!({ "stream_recipient": env.owner.id() });
    a.attack(
        "create_trial by a non-owner naming the owner as recipient",
        &create_as(&env, &env.creator, TrialParams::example("G01B"), to_owner).await,
        "R_CREATOR_GATE",
    );
    a.attack(
        "create_trial by a non-owner with a genesis plan",
        &create_as(&env, &env.creator, TrialParams::example("G01C"), json!({ "genesis": {} })).await,
        "R_CREATOR_GATE",
    );
    a.attack("open_beta by the guardian", &env.call(&env.guardian, "open_beta", json!({}), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack("open_beta by the creator", &env.call(&env.creator, "open_beta", json!({}), ZERO).await, "R_NOT_AUTHORIZED");
    a.step("guardian pause", &env.call(&env.guardian, "pause", json!({}), ZERO).await);
    a.step("owner unpause", &env.call(&env.owner, "unpause", json!({}), ZERO).await);
    a.attack(
        "create_trial after pause and unpause",
        &create_as(&env, &env.creator, TrialParams::example("G01D"), json!({})).await,
        "R_CREATOR_GATE",
    );
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
    genesis_round_plan(sym, Value::Null).await
}

/// Same, with a genesis plan (an F0 plan names the MPC child key the relayer must commit).
async fn genesis_round_plan(sym: &str, plan: Value) -> anyhow::Result<GRound> {
    let env = Env::new().await?;
    let relayer = env.user("relayer", 0).await?;
    env.owner.call(env.core.id(), "set_genesis_relayer").args_json(json!({ "account": relayer.id() })).transact().await?.into_result()?;
    let id = env.create_launch_with_plan(&env.creator, &params(sym), None, plan).await?;
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
    let mut a = Attack::new(
        "G03",
        "A2",
        "Genesis steps out of order, commit twice, abort or confirm with no commit",
        "core",
        Expect::Refused,
        "R_GENESIS_STATE",
    )
    .attempt("The relayer confirms and aborts before any commit, sends root pages before commit, then commits twice.");
    let abort = json!({ "launch_id": r.id.to_string(), "reason": "early" });
    a.attack(
        "confirm_genesis without a commit",
        &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[0u8; 32]))).await,
        "R_GENESIS_STATE",
    );
    a.attack("abort_genesis without a commit", &r.call(&r.relayer, "abort_genesis", abort).await, "R_GENESIS_STATE");
    a.attack("build_root_page before commit", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves[..1])).await, "R_GENESIS_STATE");
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.attack("second commit_genesis", &r.call(&r.relayer, "commit_genesis", r.commit()).await, "R_GENESIS_ALREADY");
    let other = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[6u8; 32]) });
    a.attack(
        "commit_genesis again with a different key (swap the mint)",
        &r.call(&r.relayer, "commit_genesis", other).await,
        "R_GENESIS_ALREADY",
    );
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
    a.check(
        "only the one valid leaf was accepted, root not ready",
        r.genesis().await["leaf_count"] == 1 && r.genesis().await["root_ready"] == false,
    );
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
    a.attack(
        "confirm naming a different mint",
        &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[9u8; 32]))).await,
        "R_GENESIS_ARG",
    );
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
    a.step(
        "guardian abort_genesis",
        &r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "test" })).await,
    );
    let fresh = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[8u8; 32]) });
    a.attack("commit_genesis with a fresh key after abort", &r.call(&r.relayer, "commit_genesis", fresh).await, "R_GENESIS_ALREADY");
    a.attack(
        "confirm_genesis after abort",
        &r.call(&r.relayer, "confirm_genesis", r.confirm(&kruxa_logic::hex(&[0u8; 32]))).await,
        "R_GENESIS_STATE",
    );
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
        (
            env.view("get_charter", lid(id)).await["payout_recipient"].clone(),
            env.state(id).await["payout_recipient"].clone(),
            env.view("stream_status", lid(id)).await["recipient"].clone(),
        )
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

// ---------------------------------------------------------------- instant launcher and market 1.1.0 (CHANGE-ORDER-7)
// Ids I01.. attack the REAL instant launcher wasm (and, where stated, the REAL market 1.1.0 wasm). A "stub market" is the
// recording mock market (failure modes); a "real market" is kruxa_market_contract. The demo profile runs one "day" in 10 s.

const MS: u64 = 1_000_000;
const IUSDC: u128 = ic::USDC;

/// Launcher identities for the given launches plus real custody, and (real market only) the market identities.
async fn inst_inv(ix: &ic::Ix, ids: &[&str], real_market: bool) -> (Value, bool) {
    let global = ix.view("get_invariants", json!({})).await;
    let mut ok =
        global["usdc_custody_identity"] == true && global["seeds_held_le_cap"] == true && global["market_locked_consistent"] == true;
    ok &= ix.usdc_bal(ix.launcher.id()).await >= ic::n(&global["usdc_custody"]);
    let mut per = vec![];
    for id in ids {
        let inv = ix.view("get_invariants", ic::lid(id)).await;
        for k in ["usdc_custody_identity", "token_custody_identity", "supply_conservation", "claimed_le_unlocked", "vest_bounds"] {
            ok &= inv[k] == true;
        }
        let tok: near_workspaces::AccountId = inv["token"].as_str().unwrap().parse().unwrap();
        ok &= ix.bal(&tok, ix.launcher.id()).await >= ic::n(&inv["token_custody"]);
        per.push(json!({ "launch_id": id, "get_invariants": inv }));
    }
    let mut out = json!({ "launcher": global, "launches": per });
    if real_market {
        let m: Value = ix.market.view("get_invariants").await.unwrap().json().unwrap();
        ok &= m["usdc_custody_identity"] == true && m["instant_q_matches"] == true;
        let mut pools = vec![];
        for id in ids {
            let args = ic::lid(id);
            let pool: Value = ix.market.view("get_pool").args_json(args.clone()).await.unwrap().json().unwrap();
            if pool.is_null() {
                continue;
            }
            let p: Value = ix.market.view("pool_invariants").args_json(args).await.unwrap().json().unwrap();
            ok &= p["token_custody_identity"] == true && p["k_ge_k0"] == true;
            pools.push(json!({ "launch_id": id, "pool_invariants": p }));
        }
        out["market"] = json!({ "get_invariants": m, "pools": pools });
    }
    (out, ok)
}

async fn mk_get_pool(ix: &ic::Ix, id: &str) -> Value {
    ix.market.view("get_pool").args_json(ic::lid(id)).await.unwrap().json().unwrap()
}

/// create + seed with the declared amount (default 250 USDC), minting the creator's USDC. Returns the id (status Seeded).
async fn seeded(ix: &ic::Ix, who: &Account, p: Value) -> anyhow::Result<String> {
    let seed = p.get("seed_q").map_or(250 * IUSDC, ic::n);
    let id = ix.create_ready(who, p, None).await?;
    ix.mint_usdc(who.id(), seed).await?;
    ix.seed(who, &id, seed).await?.into_result()?;
    Ok(id)
}

/// A buy through the real market, optionally for another receiver.
async fn ibuy(ix: &ic::Ix, who: &Account, id: &str, amount: u128, receiver: Option<&Account>) -> ExecutionFinalResult {
    let msg = json!({ "v": 1, "op": "buy", "launch_id": id, "min_out": "1", "receiver": receiver.map(|r| r.id()) }).to_string();
    who.call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.market.id(), "amount": amount.to_string(), "msg": msg }))
        .deposit(ONE)
        .gas(ic::GAS)
        .transact()
        .await
        .unwrap()
}

/// A trader funded with USDC and registered on the launch token.
async fn itrader(ix: &ic::Ix, name: &str, symbol: &str, usdc: u128) -> anyhow::Result<Account> {
    let t = ix.user(name, usdc).await?;
    ix.register_on_token(&ix.token_id(symbol), t.id()).await?;
    Ok(t)
}

fn vest30(symbol: &str) -> Value {
    let mut p = ic::params(symbol);
    p["vest_days"] = json!(30);
    p
}

// ---- creator gate and symbols

#[tokio::test]
async fn i01_instant_gate_refuses_a_non_owner_on_the_mainnet_profile() -> anyhow::Result<()> {
    let ix = ic::Ix::new("mainnet", true).await?;
    ix.predeploy_token("GATE", ic::N_TOTAL).await?;
    let eve = ix.user("eve", 0).await?;
    let mut a = Attack::new("I01", "CO7", "create_instant by non-owners on the mainnet profile before open_beta", "instant", Expect::Refused, "R_CREATOR_GATE")
        .attempt("Two ordinary accounts call create_instant with the full deposit on a launcher running the mainnet profile whose creator gate is closed.");
    a.check("precondition: the gate is closed", ix.view("get_config", json!({})).await["creator_gate"] == true);
    for who in [&ix.creator, &eve] {
        a.attack(&format!("create_instant by {}", who.id()), &ix.create_raw(who, ic::params("GATE"), None).await?, "R_CREATOR_GATE");
    }
    a.check("nothing was created", ix.view("get_config", json!({})).await["next_launch_id"] == ic::ID0.to_string());
    let (inv, ok) = inst_inv(&ix, &[], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i02_instant_gate_refuses_the_owner_too_and_open_beta_is_owner_only() -> anyhow::Result<()> {
    let ix = ic::Ix::new("mainnet", true).await?;
    ix.predeploy_token("GATO", ic::N_TOTAL).await?;
    let mut a = Attack::new("I02", "CO7", "create_instant by the owner and the guardian before open_beta; open_beta by non-owners", "instant", Expect::Refused, "R_CREATOR_GATE")
        .attempt("The owner and the guardian try to launch while the gate is closed (no insider bypass), then the guardian and a creator try to open the gate themselves.");
    a.attack("create_instant by the owner", &ix.create_raw(&ix.owner, ic::params("GATO"), None).await?, "R_CREATOR_GATE");
    a.attack("create_instant by the guardian", &ix.create_raw(&ix.guardian, ic::params("GATO"), None).await?, "R_CREATOR_GATE");
    a.attack("open_beta by the guardian", &ix.call(&ix.guardian, "open_beta", json!({})).await?, "R_NOT_AUTHORIZED");
    a.attack("open_beta by a creator", &ix.call(&ix.creator, "open_beta", json!({})).await?, "R_NOT_AUTHORIZED");
    a.check("the gate is still closed", ix.view("get_config", json!({})).await["creator_gate"] == true);
    a.check("nothing was created", ix.view("get_config", json!({})).await["next_launch_id"] == ic::ID0.to_string());
    let (inv, ok) = inst_inv(&ix, &[], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i03_symbol_squat_on_a_used_symbol() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("SQAT"), None).await?;
    let squatter = ix.user("squatter", 0).await?;
    ix.predeploy_token("SQAU", ic::N_TOTAL).await?;
    let mut a =
        Attack::new("I03", "CO7", "Symbol squat: a second launch under a symbol already in use", "instant", Expect::Refused, "R_SYMBOL")
            .attempt("A second account creates a launch with the symbol of a live launch, then with the lower-case spelling of it.");
    a.attack("same symbol", &ix.create_raw(&squatter, ic::params("SQAT"), None).await?, "R_SYMBOL");
    a.attack("lower-case spelling", &ix.create_raw(&squatter, json!({ "name": "squat", "symbol": "sqat" }), None).await?, "R_SYMBOL");
    a.check("the symbol still belongs to the first launch", ix.inst(&id).await["creator"] == json!(ix.creator.id()));
    a.check("only one launch exists", ix.view("get_config", json!({})).await["next_launch_id"] == (ic::ID0 + 1).to_string());
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i04_the_reserved_kruxa_symbol_and_the_reserved_list() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let eve = ix.user("eve", 0).await?;
    ix.predeploy_token("KRUXA", ic::N_TOTAL).await?;
    let mut a = Attack::new(
        "I04",
        "CO7",
        "Squat the reserved symbol KRUXA and edit the reserved list",
        "instant",
        Expect::Refused,
        "R_SYMBOL_RESERVED",
    )
    .attempt("Two accounts launch under KRUXA (one naming a payout recipient) and a stranger tries to add a symbol to the reserved list.");
    a.attack("create_instant KRUXA", &ix.create_raw(&ix.creator, ic::params("KRUXA"), None).await?, "R_SYMBOL_RESERVED");
    a.attack(
        "create_instant KRUXA with a recipient",
        &ix.create_raw(&eve, ic::params("KRUXA"), Some(eve.id())).await?,
        "R_SYMBOL_RESERVED",
    );
    a.attack("reserve_symbol by a stranger", &ix.call(&eve, "reserve_symbol", json!({ "symbol": "FREE" })).await?, "R_NOT_AUTHORIZED");
    a.check("nothing was created", ix.view("get_config", json!({})).await["next_launch_id"] == ic::ID0.to_string());
    let (inv, ok) = inst_inv(&ix, &[], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i05_second_launch_within_24_hours() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("RAT1"), None).await?;
    ix.predeploy_token("RAT2", ic::N_TOTAL).await?;
    let mut a =
        Attack::new("I05", "CO7", "Second instant launch by the same account within 24 hours", "instant", Expect::Refused, "R_RATE_LIMIT")
            .attempt("An account that already has a launch creates another one with a fresh symbol right away.");
    a.attack("second create_instant", &ix.create_raw(&ix.creator, ic::params("RAT2"), None).await?, "R_RATE_LIMIT");
    a.check("still one launch", ix.view("get_config", json!({})).await["next_launch_id"] == (ic::ID0 + 1).to_string());
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i06_rate_limit_via_a_second_wallet_is_bounded_not_blocked() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id1 = ix.create_ready(&ix.creator, ic::params("SYB1"), None).await?;
    let second = ix.user("wallet2", 0).await?;
    let mut a = Attack::new("I06", "CO7", "Rate limit evaded with a second wallet (Sybil)", "instant", Expect::Bounded, "")
        .attempt("The creator funds a second wallet and launches again at once. The per-account limit does not link accounts; this is disclosed, not a win.");
    ix.predeploy_token("SYB2", ic::N_TOTAL).await?;
    let res = ix.create_raw(&second, ic::params("SYB2"), None).await?;
    a.attack("second wallet's create_instant (succeeds, as disclosed)", &res, "");
    let id2 = (ic::ID0 + 1).to_string();
    a.check("both launches exist (not blocked)", ix.status(&id1).await == "TokenReady" && ix.status(&id2).await == "TokenReady");
    a.check(
        "bound: each launch costs its own deposit, a unique symbol and a $100 to $1,000 seed, and the aggregate unconsumed-seed cap ($3,000) still applies",
        ic::n(&ix.inst(&id2).await["deposit_paid"]) >= ix.required_deposit().await && ic::n(&ix.view("get_config", json!({})).await["seed_cap_aggregate"]) == 3_000 * IUSDC,
    );
    let (inv, ok) = inst_inv(&ix, &[&id1, &id2], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- hostile terms and seeds

fn std_fees() -> Value {
    json!({ "total_fee_bps": 100, "creator_bps": 5000, "platform_bps": 1500, "holders_bps": 1500, "lp_bps": 1000, "referral_bps": 1000,
            "opening_fee_start_bps": 500, "opening_decay_minutes": 60, "fee_vest_bps": 5000, "fee_vest_days": 90 })
}

fn fees_with(edit: impl FnOnce(&mut Value)) -> Value {
    let mut f = std_fees();
    edit(&mut f);
    json!({ "name": "Hostile", "symbol": "HFEE", "fees": f })
}

#[tokio::test]
async fn i07_hostile_fee_terms_are_refused_field_by_field() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    ix.predeploy_token("HFEE", ic::N_TOTAL).await?;
    let mut a = Attack::new("I07", "CO7", "Hostile fee terms in create_instant (creator-set fees)", "instant", Expect::Refused, "R_FEE_*")
        .attempt("The creator submits fee terms that break each rule in turn: total over 2% or under 0.3%, creator share and take, platform floor and fixed share, holders, LP, referral, split sum, fee vest, opening fee.");
    let cases: Vec<(&str, &str, Value)> = vec![
        ("total 201 bps", "R_FEE_TOTAL", fees_with(|f| f["total_fee_bps"] = json!(201))),
        ("total 29 bps", "R_FEE_TOTAL", fees_with(|f| f["total_fee_bps"] = json!(29))),
        ("creator share 6001", "R_CREATOR_SHARE", fees_with(|f| f["creator_bps"] = json!(6001))),
        (
            "creator take over 1%",
            "R_CREATOR_TAKE",
            fees_with(|f| {
                f["total_fee_bps"] = json!(200);
                f["creator_bps"] = json!(5100);
            }),
        ),
        ("platform 1400", "R_PLATFORM_FLOOR", fees_with(|f| f["platform_bps"] = json!(1400))),
        ("platform 2100", "R_PLATFORM_FIXED", fees_with(|f| f["platform_bps"] = json!(2100))),
        ("holders 999", "R_HOLDER_RANGE", fees_with(|f| f["holders_bps"] = json!(999))),
        ("lp 3001", "R_LP_RANGE", fees_with(|f| f["lp_bps"] = json!(3001))),
        ("referral 2001", "R_REFERRAL", fees_with(|f| f["referral_bps"] = json!(2001))),
        ("split sums to 9400", "R_SPLIT_SUM", fees_with(|f| f["referral_bps"] = json!(400))),
        ("fee vest 2499", "R_FEE_VEST", fees_with(|f| f["fee_vest_bps"] = json!(2499))),
        ("opening fee 1001 bps", "R_OPENING", fees_with(|f| f["opening_fee_start_bps"] = json!(1001))),
    ];
    for (label, code, p) in cases {
        a.attack(label, &ix.create_raw(&ix.creator, p, None).await?, code);
    }
    a.check("nothing was created", ix.view("get_config", json!({})).await["next_launch_id"] == ic::ID0.to_string());
    let (inv, ok) = inst_inv(&ix, &[], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i08_seed_with_the_wrong_amount() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("SDAM"), None).await?;
    ix.mint_usdc(ix.creator.id(), 1_000 * IUSDC).await?;
    let mut a = Attack::new("I08", "CO7", "Seed with the wrong amount", "instant", Expect::Refused, "R_SEED_AMOUNT")
        .attempt("The creator seeds a launch declared at 250 USDC with 250 USDC plus 1 micro-USDC, 249 USDC, 1 USDC and 1,000 USDC.");
    for (label, amt) in [("250 USDC + 1", 250 * IUSDC + 1), ("249 USDC", 249 * IUSDC), ("1 USDC", IUSDC), ("1,000 USDC", 1_000 * IUSDC)] {
        a.attack(label, &ix.seed(&ix.creator, &id, amt).await?, "R_SEED_AMOUNT");
    }
    a.check("every amount came back to the creator", ix.usdc_bal(ix.creator.id()).await == 1_000 * IUSDC);
    a.check("the launcher kept nothing", ix.usdc_bal(ix.launcher.id()).await == 0);
    a.check("status is still TokenReady", ix.status(&id).await == "TokenReady");
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i09_seed_with_the_wrong_token_or_a_forged_call() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("SDTK"), None).await?;
    let root = ix.worker.root_account()?;
    let fake = root.create_subaccount("fakeusdc").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
    let fake = fake.deploy(&ic::wasm("mock_ft")).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": ix.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    ix.register(&fake, ix.launcher.id()).await?;
    ix.register(&fake, ix.creator.id()).await?;
    fake.call("mint").args_json(json!({ "account_id": ix.creator.id(), "amount": "250000000" })).transact().await?.into_result()?;
    let mut a = Attack::new("I09", "CO7", "Seed with a look-alike token, and a forged ft_on_transfer", "instant", Expect::Refused, "R_UNEXPECTED_TOKEN")
        .attempt("The creator seeds with 250 units of a look-alike USDC contract, then calls ft_on_transfer on the launcher directly with the right message.");
    a.attack("fake-USDC seed", &ix.seed_via(&ix.creator, fake.id(), &id, 250 * IUSDC).await?, "R_UNEXPECTED_TOKEN");
    let msg = json!({ "v": 1, "op": "seed_instant", "launch_id": id }).to_string();
    let direct = ix
        .creator
        .call(ix.launcher.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": ix.creator.id(), "amount": "250000000", "msg": msg }))
        .gas(ic::GAS)
        .transact()
        .await?;
    a.attack("direct ft_on_transfer from a non-token account", &direct, "R_UNEXPECTED_TOKEN");
    a.check("direct call returned the full amount", direct.json::<String>().map(|s| s == "250000000").unwrap_or(false));
    a.check("fake tokens refunded", ix.bal(fake.id(), ix.creator.id()).await == 250 * IUSDC);
    a.check(
        "status is still TokenReady and nothing is held",
        ix.status(&id).await == "TokenReady" && ix.usdc_bal(ix.launcher.id()).await == 0,
    );
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i10_seed_before_the_token_exists() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    ix.create_raw(&ix.creator, ic::params("NTOK"), None).await?;
    let dead = ic::ID0.to_string();
    let live_creator = ix.user("live", 0).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    let live = ix.create_ready(&live_creator, ic::params("LIVE"), None).await?;
    ix.mint_usdc(ix.creator.id(), 500 * IUSDC).await?;
    let mut a = Attack::new("I10", "CO7", "Seed before the token exists (unknown id, failed creation, malformed message)", "instant", Expect::Refused, "R_INSTANT_STATE")
        .attempt("The creator seeds an id that was never created, the id of a launch whose token creation failed, and sends a seed message with the wrong version and op.");
    a.check("precondition: the first launch is CreationFailed", ix.status(&dead).await == "CreationFailed");
    a.attack("seed an id that does not exist", &ix.seed(&ix.creator, "1999999999", 250 * IUSDC).await?, "R_INSTANT_STATE");
    a.attack("seed the next id, not yet created", &ix.seed(&ix.creator, &(ic::ID0 + 2).to_string(), 250 * IUSDC).await?, "R_INSTANT_STATE");
    a.attack("seed a CreationFailed launch", &ix.seed(&ix.creator, &dead, 250 * IUSDC).await?, "R_INSTANT_STATE");
    let bad = json!({ "v": 2, "op": "seed_quote", "launch_id": live }).to_string();
    let r = ix
        .creator
        .call(ix.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.launcher.id(), "amount": "250000000", "msg": bad }))
        .deposit(ONE)
        .gas(ic::GAS)
        .transact()
        .await?;
    a.attack("wrong version and op in the seed message", &r, "R_BAD_MSG");
    a.check("everything came back", ix.usdc_bal(ix.creator.id()).await == 500 * IUSDC && ix.usdc_bal(ix.launcher.id()).await == 0);
    a.check("the dead launch stays CreationFailed", ix.status(&dead).await == "CreationFailed");
    let (inv, ok) = inst_inv(&ix, &[&live], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i11_a_stranger_seeds_someone_elses_launch() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("FRNT"), None).await?;
    let eve = ix.user("eve", 250 * IUSDC).await?;
    let mut a = Attack::new("I11", "CO7", "A stranger seeds the creator's launch (front-run the seed)", "instant", Expect::Refused, "R_NOT_CREATOR")
        .attempt("An account that is not the creator sends the exact seed amount with the right launch id, hoping to take over the seed and its refund rights.");
    a.attack("seed by a stranger with the exact amount", &ix.seed(&eve, &id, 250 * IUSDC).await?, "R_NOT_CREATOR");
    a.check("the stranger was refunded in full", ix.usdc_bal(eve.id()).await == 250 * IUSDC);
    a.check("status unchanged", ix.status(&id).await == "TokenReady");
    ix.mint_usdc(ix.creator.id(), 250 * IUSDC).await?;
    a.step("the real creator seeds afterwards", &ix.seed(&ix.creator, &id, 250 * IUSDC).await?);
    a.check("the creator's seed is accepted", ix.status(&id).await == "Seeded");
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- open_instant

#[tokio::test]
async fn i12_double_open_instant() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let id = seeded(&ix, &ix.creator, ic::params("DOPN")).await?;
    let first = ix.open(&ix.creator, &id).await?;
    let stranger = ix.user("stranger", 0).await?;
    let mut a = Attack::new("I12", "CO7", "open_instant called again after the pool is open", "instant+market", Expect::Refused, "R_INSTANT_STATE")
        .attempt("After the pool opened, the creator and a stranger call open_instant again, hoping to push the seed or the token bucket a second time.");
    a.step("first open_instant", &first);
    let q = ic::n(&mk_get_pool(&ix, &id).await["q"]);
    a.attack("second open_instant by the creator", &ix.open(&ix.creator, &id).await?, "R_INSTANT_STATE");
    a.attack("third open_instant by a stranger", &ix.open(&stranger, &id).await?, "R_INSTANT_STATE");
    a.check("pool reserve unchanged", ic::n(&mk_get_pool(&ix, &id).await["q"]) == q && q == 250 * IUSDC);
    a.check("market holds exactly the seed", ix.usdc_bal(ix.market.id()).await == 250 * IUSDC);
    a.check("the launcher paid the pool bucket once", ix.bal(&ix.token_id("DOPN"), ix.market.id()).await == ic::N_TOTAL / 20 * 19);
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i13_three_concurrent_open_instant_calls() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = seeded(&ix, &ix.creator, ic::params("CONC")).await?;
    let (x, y, z) = (ix.user("x", 0).await?, ix.user("y", 0).await?, ix.user("z", 0).await?);
    let mut a = Attack::new("I13", "CO7", "Three open_instant calls in the same block", "instant", Expect::NoEffect, "")
        .attempt("Three accounts call open_instant for the same seeded launch at once, hoping each leg is sent more than once.");
    let (rx, ry, rz) = tokio::join!(ix.open(&x, &id), ix.open(&y, &id), ix.open(&z, &id));
    for (who, r) in [("x", rx?), ("y", ry?), ("z", rz?)] {
        a.attack(&format!("concurrent open_instant by {who}"), &r, "");
    }
    let legs: Vec<Value> = ix.market.view("get_legs").await?.json()?;
    a.check("the seed leg was sent exactly once", legs.iter().filter(|l| l["msg"]["op"] == "seed_quote").count() == 1);
    a.check("the token leg was sent exactly once", legs.iter().filter(|l| l["msg"]["op"] == "open_pool_token").count() == 1);
    a.check(
        "market holds one seed and one bucket",
        ix.usdc_bal(ix.market.id()).await == 250 * IUSDC && ix.bal(&ix.token_id("CONC"), ix.market.id()).await == ic::N_TOTAL / 20 * 19,
    );
    a.check("status is Open", ix.status(&id).await == "Open");
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- vesting claims (IL-5)

#[tokio::test]
async fn i14_claim_vested_before_the_cliff() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.launch_to_open(&ix.creator, vest30("CLF1")).await?;
    let tok = ix.token_id("CLF1");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let mut a = Attack::new("I14", "CO7", "claim_vested before the cliff", "instant", Expect::Refused, "R_NOTHING_TO_CLAIM")
        .attempt("Right after the pool opens the payout recipient claims the whole allocation, a quarter of it, and 1 base unit.");
    let n_alloc = ic::n(&ix.inst(&id).await["n_alloc"]);
    a.attack("claim all (no amount)", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?, "R_NOTHING_TO_CLAIM");
    a.attack(
        "claim n_alloc / 4",
        &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": (n_alloc / 4).to_string() })).await?,
        "STREAM_CAP",
    );
    a.attack("claim 1 base unit", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": "1" })).await?, "STREAM_CAP");
    a.check("nothing was paid", ix.bal(&tok, ix.creator.id()).await == 0);
    a.check("claimed stays zero", ic::n(&ix.view("get_vesting", ic::lid(&id)).await["claimed"]) == 0);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i15_claim_vested_above_the_claimable_amount() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.launch_to_open(&ix.creator, vest30("CLF2")).await?;
    let tok = ix.token_id("CLF2");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let r = ix.inst(&id).await;
    let (opened, n_alloc) = (ic::n(&r["opened_at_ns"]) as u64, ic::n(&r["n_alloc"]));
    ix.wait_until(opened + 72_000 * MS).await;
    let mut a = Attack::new(
        "I15",
        "CO7",
        "claim_vested above the claimable amount (just after the cliff)",
        "instant",
        Expect::Refused,
        "STREAM_CAP",
    )
    .attempt(
        "Just after the cliff only a sliver has unlocked; the recipient asks for half the allocation, the whole allocation and u128::MAX.",
    );
    let v = ix.view("get_vesting", ic::lid(&id)).await;
    a.check("precondition: claimable is far below half", ic::n(&v["claimable"]) < n_alloc / 2);
    for (label, amt) in [("half", n_alloc / 2), ("all", n_alloc), ("u128::MAX", u128::MAX)] {
        a.attack(label, &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": amt.to_string() })).await?, "STREAM_CAP");
    }
    a.check("nothing was paid", ix.bal(&tok, ix.creator.id()).await == 0);
    a.check("claimed stays zero", ic::n(&ix.view("get_vesting", ic::lid(&id)).await["claimed"]) == 0);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i16_claim_vested_by_a_non_recipient() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let rec = ix.user("recipient", 0).await?;
    let id = {
        let id = ix.create_ready(&ix.creator, vest30("CLF3"), Some(rec.id())).await?;
        ix.mint_usdc(ix.creator.id(), 250 * IUSDC).await?;
        ix.seed(&ix.creator, &id, 250 * IUSDC).await?.into_result()?;
        ix.open(&ix.creator, &id).await?.into_result()?;
        id
    };
    let tok = ix.token_id("CLF3");
    for w in [ix.creator.id(), rec.id()] {
        ix.register_on_token(&tok, w).await?;
    }
    let eve = ix.user("eve", 0).await?;
    ix.register_on_token(&tok, eve.id()).await?;
    let opened = ic::n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 150_000 * MS).await;
    let mut a = Attack::new(
        "I16",
        "CO7",
        "claim_vested by someone other than the payout recipient",
        "instant",
        Expect::Refused,
        "R_NOT_AUTHORIZED",
    )
    .attempt("After the cliff the creator (who named a separate recipient) and a stranger both call claim_vested.");
    a.check("precondition: something is claimable", ic::n(&ix.view("get_vesting", ic::lid(&id)).await["claimable"]) > 0);
    a.attack(
        "claim by the creator who is not the recipient",
        &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?,
        "R_NOT_AUTHORIZED",
    );
    a.attack("claim by a stranger", &ix.call(&eve, "claim_vested", json!({ "launch_id": id })).await?, "R_NOT_AUTHORIZED");
    a.check("neither received tokens", ix.bal(&tok, ix.creator.id()).await == 0 && ix.bal(&tok, eve.id()).await == 0);
    a.check("the recipient is still the named account", ix.view("get_vesting", ic::lid(&id)).await["recipient"] == json!(rec.id()));
    a.step("the real recipient claims", &ix.call(&rec, "claim_vested", json!({ "launch_id": id })).await?);
    a.check("the recipient was paid", ix.bal(&tok, rec.id()).await > 0);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i17_claim_vested_again_after_the_full_claim() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.launch_to_open(&ix.creator, vest30("CLF4")).await?;
    let tok = ix.token_id("CLF4");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let r = ix.inst(&id).await;
    let (opened, n_alloc) = (ic::n(&r["opened_at_ns"]) as u64, ic::n(&r["n_alloc"]));
    ix.wait_until(opened + 302_000 * MS).await;
    let mut a = Attack::new(
        "I17",
        "CO7",
        "claim_vested again after the allocation was claimed in full",
        "instant",
        Expect::Refused,
        "R_NOTHING_TO_CLAIM",
    )
    .attempt("The recipient claims everything after the vest ends, then claims again, with and without an amount.");
    a.step("full claim after the vest", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?);
    a.check("the recipient holds exactly n_alloc", ix.bal(&tok, ix.creator.id()).await == n_alloc);
    a.attack("second claim (no amount)", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?, "R_NOTHING_TO_CLAIM");
    a.attack(
        "third claim of 1 base unit",
        &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": "1" })).await?,
        "STREAM_CAP",
    );
    a.check("balance still exactly n_alloc", ix.bal(&tok, ix.creator.id()).await == n_alloc);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i18_claim_vested_before_the_pool_is_open() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("CLF5"), None).await?;
    let mut a = Attack::new(
        "I18",
        "CO7",
        "claim_vested while the launch is not Open (TokenReady, Seeded)",
        "instant",
        Expect::Refused,
        "R_INSTANT_STATE",
    )
    .attempt("The creator claims the allocation before the pool exists: once right after create, once right after the seed.");
    a.attack("claim in TokenReady", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?, "R_INSTANT_STATE");
    ix.mint_usdc(ix.creator.id(), 250 * IUSDC).await?;
    ix.seed(&ix.creator, &id, 250 * IUSDC).await?.into_result()?;
    a.attack("claim in Seeded", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id, "amount": "1" })).await?, "R_INSTANT_STATE");
    a.check("the creator holds no launch token", ix.bal(&ix.token_id("CLF5"), ix.creator.id()).await == 0);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- abort, abandon, reclaim

async fn stub_mode(ix: &ic::Ix, mode: &str) {
    ix.market.call("set_mode").args_json(json!({ "mode": mode })).transact().await.unwrap().into_result().unwrap();
}

#[tokio::test]
async fn i19_abort_abuse() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = seeded(&ix, &ix.creator, ic::params("ABRT")).await?;
    stub_mode(&ix, "refuse_seed").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let stranger = ix.user("stranger", 0).await?;
    let mut a = Attack::new("I19", "CO7", "abort_instant abuse: too early, by a stranger, twice, then reuse of the dead launch", "instant", Expect::Refused, "R_TOO_EARLY")
        .attempt("The seed was refused by the market. A stranger and the creator abort early, a stranger aborts after the wait, the creator aborts twice, then open_instant, claim_vested and a new seed are tried on the aborted launch.");
    a.attack("abort by the creator before the wait", &ix.call(&ix.creator, "abort_instant", ic::lid(&id)).await?, "R_TOO_EARLY");
    let seeded_at = ic::n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded_at + 31_000 * MS).await;
    a.attack("abort by a stranger after the wait", &ix.call(&stranger, "abort_instant", ic::lid(&id)).await?, "R_NOT_AUTHORIZED");
    a.step("abort by the creator after the wait (legitimate)", &ix.call(&ix.creator, "abort_instant", ic::lid(&id)).await?);
    a.check("the whole seed came back once", ix.usdc_bal(ix.creator.id()).await == 250 * IUSDC && ix.status(&id).await == "Aborted");
    a.attack("second abort", &ix.call(&ix.creator, "abort_instant", ic::lid(&id)).await?, "R_INSTANT_STATE");
    a.attack("open_instant on the aborted launch", &ix.open(&stranger, &id).await?, "R_INSTANT_STATE");
    a.attack(
        "claim_vested on the aborted launch",
        &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?,
        "R_INSTANT_STATE",
    );
    a.attack("seed the aborted launch again", &ix.seed(&ix.creator, &id, 250 * IUSDC).await?, "R_INSTANT_STATE");
    a.check(
        "the creator still holds exactly the one refund",
        ix.usdc_bal(ix.creator.id()).await == 250 * IUSDC && ix.usdc_bal(ix.launcher.id()).await == 0,
    );
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i20_abort_after_the_market_consumed_the_seed() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = seeded(&ix, &ix.creator, ic::params("IL8Y")).await?;
    stub_mode(&ix, "refuse_token").await;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let seeded_at = ic::n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded_at + 31_000 * MS).await;
    let mut a = Attack::new("I20", "CO7", "Abort to take the seed back after the market already consumed it (IL-8)", "instant", Expect::Refused, "R_INSTANT_STATE")
        .attempt("The market consumed the seed but refused the token bucket. After the wait the creator calls abort_instant to pull the seed back out of a half-open pool.");
    a.check("precondition: the market holds the seed", ix.usdc_bal(ix.market.id()).await == 250 * IUSDC);
    a.attack("abort_instant after the seed was consumed", &ix.call(&ix.creator, "abort_instant", ic::lid(&id)).await?, "R_INSTANT_STATE");
    a.check("creator got nothing back", ix.usdc_bal(ix.creator.id()).await == 0);
    a.check(
        "the launch is still Handoff with seed_sent = 250 USDC",
        ix.status(&id).await == "Handoff" && ic::n(&ix.inst(&id).await["seed_sent"]) == 250 * IUSDC,
    );
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i21_reclaim_deposit_abuse() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    ix.create_raw(&ix.creator, ic::params("RCL1"), None).await?;
    ix.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    let dead = ic::ID0.to_string();
    let other = ix.user("other", 0).await?;
    let live = ix.create_ready(&other, ic::params("RCL2"), None).await?;
    let eve = ix.user("eve", 0).await?;
    let mut a = Attack::new(
        "I21",
        "CO7",
        "reclaim_deposit abuse: stranger, live launch, double reclaim",
        "instant",
        Expect::Refused,
        "R_NOT_AUTHORIZED",
    )
    .attempt("A stranger reclaims another creator's refund; the owner of a live launch reclaims its deposit; the refund is claimed twice.");
    a.check(
        "precondition: first launch CreationFailed, second TokenReady",
        ix.status(&dead).await == "CreationFailed" && ix.status(&live).await == "TokenReady",
    );
    a.attack("reclaim by a stranger", &ix.call(&eve, "reclaim_deposit", ic::lid(&dead)).await?, "R_NOT_AUTHORIZED");
    a.attack("reclaim on a live TokenReady launch", &ix.call(&other, "reclaim_deposit", ic::lid(&live)).await?, "R_INSTANT_STATE");
    a.step("reclaim by the creator (legitimate)", &ix.call_gas(&ix.creator, "reclaim_deposit", ic::lid(&dead), 30).await?);
    a.attack("second reclaim", &ix.call(&ix.creator, "reclaim_deposit", ic::lid(&dead)).await?, "R_NOTHING_TO_CLAIM");
    a.check("refundable is now zero", ic::n(&ix.inst(&dead).await["deposit_refundable"]) == 0);
    a.check(
        "the live launch deposit is intact",
        ic::n(&ix.inst(&live).await["deposit_refundable"]) == 0 && ix.status(&live).await == "TokenReady",
    );
    let (inv, ok) = inst_inv(&ix, &[&live], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i22_abandon_abuse() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.create_ready(&ix.creator, ic::params("ABN1"), None).await?;
    let stranger = ix.user("stranger", 0).await?;
    let b_creator = ix.user("bcreator", 250 * IUSDC).await?;
    let seeded_id = ix.create_ready(&b_creator, ic::params("ABN2"), None).await?;
    ix.seed(&b_creator, &seeded_id, 250 * IUSDC).await?.into_result()?;
    let mut a = Attack::new("I22", "CO7", "abandon_instant abuse: stranger early, on a seeded launch, twice", "instant", Expect::Refused, "R_TOO_EARLY")
        .attempt("A stranger abandons a fresh launch inside the 24 h window; the creator abandons a launch that already holds a seed; an abandoned launch is abandoned again and then seeded.");
    a.attack("abandon by a stranger inside 24 h", &ix.call(&stranger, "abandon_instant", ic::lid(&id)).await?, "R_TOO_EARLY");
    a.attack("abandon a Seeded launch (creator)", &ix.call(&b_creator, "abandon_instant", ic::lid(&seeded_id)).await?, "R_INSTANT_STATE");
    a.step("abandon by the creator (legitimate)", &ix.call(&ix.creator, "abandon_instant", ic::lid(&id)).await?);
    a.attack("abandon again", &ix.call(&ix.creator, "abandon_instant", ic::lid(&id)).await?, "R_INSTANT_STATE");
    ix.mint_usdc(ix.creator.id(), 250 * IUSDC).await?;
    a.attack("seed the abandoned launch", &ix.seed(&ix.creator, &id, 250 * IUSDC).await?, "R_INSTANT_STATE");
    a.check("seed returned in full, abandoned launch holds nothing", ix.usdc_bal(ix.creator.id()).await == 250 * IUSDC);
    a.check("the seeded launch is still Seeded", ix.status(&seeded_id).await == "Seeded");
    let (inv, ok) = inst_inv(&ix, &[&id, &seeded_id], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- set_launcher, set_market, mode and namespace (market 1.1.0)

#[tokio::test]
async fn i23_set_launcher_by_a_non_owner_or_to_a_protected_account() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    let other = mk.user("other", 0).await?;
    let call = |who: &Account, acct: &near_workspaces::AccountId| {
        who.call(mk.market.id(), "set_launcher").args_json(json!({ "account": acct })).transact()
    };
    let mut a = Attack::new("I23", "CO7", "set_launcher by a non-owner, or pointing it at core, USDC or the treasury", "market", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("The guardian, a creator and a stranger name themselves as the launcher; the owner is also tried with the core, the USDC contract and the treasury (each would let a second sender open pools).");
    for (label, who) in [("guardian", &mk.guardian), ("creator", &mk.creator), ("stranger", &other)] {
        a.attack(&format!("set_launcher by the {label}"), &call(who, other.id()).await?, "R_NOT_AUTHORIZED");
    }
    for (label, bad) in [("core", mk.core.id()), ("USDC", mk.usdc.id()), ("treasury", mk.treasury.id())] {
        a.attack(&format!("owner points the launcher at the {label}"), &call(&mk.owner, bad).await?, "R_NOT_AUTHORIZED");
    }
    a.check("the market still has no launcher", mk.view("get_config", json!({})).await["launcher"].is_null());
    let (inv, ok) = market_inv(&mk, &[]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i24_re_point_the_launcher_after_the_first_instant_pool() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.set_launcher().await?;
    let other = mk.user("other", 0).await?;
    mk.open_instant(mc::INSTANT_BASE, 500 * mc::USDC, mk.creator.id(), mk.creator.id()).await?;
    let call =
        |acct: &near_workspaces::AccountId| mk.owner.call(mk.market.id(), "set_launcher").args_json(json!({ "account": acct })).transact();
    let mut a = Attack::new(
        "I24",
        "CO7",
        "Re-point the launcher after the first instant pool exists",
        "market",
        Expect::Refused,
        "R_LAUNCHER_LOCKED",
    )
    .attempt("Even the owner tries to switch the launcher to another account, and to re-set the same one, once a launcher pool is live.");
    a.attack("owner re-points the launcher", &call(other.id()).await?, "R_LAUNCHER_LOCKED");
    a.attack("owner re-sets the same launcher", &call(mk.launcher.id()).await?, "R_LAUNCHER_LOCKED");
    a.check(
        "get_config still names the original launcher",
        mk.view("get_config", json!({})).await["launcher"] == mk.launcher.id().as_str(),
    );
    let (inv, ok) = market_inv(&mk, &[mc::INSTANT_BASE]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i25_set_market_on_the_launcher_after_first_use_or_by_a_non_owner() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let id = seeded(&ix, &ix.creator, ic::params("SMKT")).await?;
    let evil = ix.user("evilmarket", 0).await?;
    let mut a = Attack::new("I25", "CO7", "set_market on the launcher: non-owner, then after the first open_instant", "instant", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("A creator and the guardian name an account of their own as the market; after the pool opened, the owner is asked to re-point the market (pool tokens would follow it).");
    a.attack("set_market by a creator", &ix.call(&ix.creator, "set_market", json!({ "account": evil.id() })).await?, "R_NOT_AUTHORIZED");
    a.attack(
        "set_market by the guardian",
        &ix.call(&ix.guardian, "set_market", json!({ "account": evil.id() })).await?,
        "R_NOT_AUTHORIZED",
    );
    a.step("first open_instant (locks the market)", &ix.open(&ix.creator, &id).await?);
    a.attack(
        "owner re-points the market after first use",
        &ix.call(&ix.owner, "set_market", json!({ "account": evil.id() })).await?,
        "R_NOTHING",
    );
    let cfg = ix.view("get_config", json!({})).await;
    a.check("market unchanged and locked", cfg["market"] == json!(ix.market.id()) && cfg["market_locked"] == true);
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i26_spoofed_mode_in_the_seed_message() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.set_launcher().await?;
    let mut a = Attack::new("I26", "CO7", "Spoofed mode in a seed_quote message (trial pool from the launcher, instant pool from core)", "market", Expect::NoEffect, "")
        .attempt("The launcher's seed message carries mode \"trial\" (mc::instant_seed_msg does); core's carries mode \"instant\". The market must derive the mode from the authenticated sender only.");
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * mc::USDC).await?;
    mk.mint(&mk.token, mk.launcher.id(), mc::SEED_T).await?;
    let m = mk.instant_seed_msg(mc::INSTANT_BASE, mk.token.id(), &c, &r);
    a.check("precondition: the message really says mode trial", serde_json::from_str::<Value>(&m)?["mode"] == "trial");
    a.attack("launcher seed with mode:\"trial\"", &mk.send(&mk.launcher, &mk.usdc, 500 * mc::USDC, m).await?, "");
    a.attack("launcher token leg", &mk.send(&mk.launcher, &mk.token, mc::SEED_T, mc::Mk::leg_msg(mc::INSTANT_BASE)).await?, "");
    let root = mk.worker.root_account()?;
    let tok2 = mc::deploy_ft(&root, "tok2").await?;
    mk.mint(&tok2, mk.market.id(), 0).await?;
    let mut core_msg: Value = serde_json::from_str(&mk.seed_msg(1, tok2.id()))?;
    core_msg["mode"] = json!("instant");
    mk.mint(&mk.usdc, mk.core.id(), mc::SEED_Q).await?;
    mk.mint(&tok2, mk.core.id(), mc::SEED_T).await?;
    a.attack("core seed with mode:\"instant\"", &mk.send(&mk.core, &mk.usdc, mc::SEED_Q, core_msg.to_string()).await?, "");
    a.attack("core token leg", &mk.send(&mk.core, &tok2, mc::SEED_T, mc::Mk::leg_msg(1)).await?, "");
    let pi = mk.view("get_pool", json!({ "launch_id": mc::INSTANT_BASE.to_string() })).await;
    let pt = mk.view("get_pool", json!({ "launch_id": "1" })).await;
    a.check("the launcher pool is instant despite mode:trial", pi["mode"] == "instant" && pi["state"] == "Open");
    a.check("the core pool is trial despite mode:instant", pt["mode"] == "trial" && pt["state"] == "Open");
    let (inv, ok) = market_inv(&mk, &[mc::INSTANT_BASE, 1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i27_wrong_id_namespace_on_either_leg() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.set_launcher().await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * mc::USDC).await?;
    mk.mint(&mk.token, mk.launcher.id(), mc::SEED_T).await?;
    mk.mint(&mk.usdc, mk.core.id(), mc::SEED_Q).await?;
    mk.mint(&mk.token, mk.core.id(), mc::SEED_T).await?;
    let mut a = Attack::new(
        "I27",
        "CO7",
        "Launcher below 1e9 and core at or above 1e9, on the seed leg and the token leg",
        "market",
        Expect::Refused,
        "R_ID_NAMESPACE",
    )
    .attempt(
        "The launcher sends a seed and a token leg for a core-range id (7); core sends a seed and a token leg for an instant-range id.",
    );
    a.attack(
        "launcher seed_quote for id 7",
        &mk.send(&mk.launcher, &mk.usdc, 500 * mc::USDC, mk.instant_seed_msg(7, mk.token.id(), &c, &r)).await?,
        "R_ID_NAMESPACE",
    );
    a.attack("launcher token leg for id 7", &mk.send(&mk.launcher, &mk.token, mc::SEED_T, mc::Mk::leg_msg(7)).await?, "R_ID_NAMESPACE");
    a.attack(
        "core seed_quote for id 1e9",
        &mk.send(&mk.core, &mk.usdc, mc::SEED_Q, mk.seed_msg(mc::INSTANT_BASE, mk.token.id())).await?,
        "R_ID_NAMESPACE",
    );
    a.attack(
        "core token leg for id 1e9",
        &mk.send(&mk.core, &mk.token, mc::SEED_T, mc::Mk::leg_msg(mc::INSTANT_BASE)).await?,
        "R_ID_NAMESPACE",
    );
    a.check(
        "everything was refunded",
        mk.bal(&mk.usdc, mk.launcher.id()).await == 500 * mc::USDC && mk.bal(&mk.usdc, mk.core.id()).await == mc::SEED_Q,
    );
    a.check(
        "no pool was created",
        mk.view("get_pool", json!({ "launch_id": "7" })).await.is_null()
            && mk.view("get_pool", json!({ "launch_id": mc::INSTANT_BASE.to_string() })).await.is_null(),
    );
    let (inv, ok) = market_inv(&mk, &[]).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- self-buy (declared wallets)

#[tokio::test]
async fn i28_self_buy_by_creator_recipient_and_receiver() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let rec = ix.user("recipient", 100 * IUSDC).await?;
    let id = ix.create_ready(&ix.creator, ic::params("SELF"), Some(rec.id())).await?;
    ix.mint_usdc(ix.creator.id(), 350 * IUSDC).await?;
    ix.seed(&ix.creator, &id, 250 * IUSDC).await?.into_result()?;
    ix.open(&ix.creator, &id).await?.into_result()?;
    let tok = ix.token_id("SELF");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    ix.register_on_token(&tok, rec.id()).await?;
    let bob = itrader(&ix, "bob", "SELF", 100 * IUSDC).await?;
    let mut a = Attack::new("I28", "CO7", "Self-buy by the creator, the payout recipient, and through the receiver field", "market", Expect::Refused, "R_SELF_BUY")
        .attempt("On an instant pool the creator buys, the separate payout recipient buys, and a third wallet buys with receiver set to the creator and to the recipient.");
    let q = ic::n(&mk_get_pool(&ix, &id).await["q"]);
    for (label, who, receiver) in [
        ("creator buys", &ix.creator, None),
        ("recipient buys", &rec, None),
        ("bob buys for the creator", &bob, Some(&ix.creator)),
        ("bob buys for the recipient", &bob, Some(&rec)),
    ] {
        a.attack(label, &ibuy(&ix, who, &id, 20 * IUSDC, receiver).await, "R_SELF_BUY");
    }
    a.check(
        "every buyer was refunded in full",
        ix.usdc_bal(ix.creator.id()).await == 100 * IUSDC
            && ix.usdc_bal(rec.id()).await == 100 * IUSDC
            && ix.usdc_bal(bob.id()).await == 100 * IUSDC,
    );
    a.check("pool reserve unchanged", ic::n(&mk_get_pool(&ix, &id).await["q"]) == q);
    a.check("pool names the declared wallets", mk_get_pool(&ix, &id).await["creator"] == json!(ix.creator.id()));
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i29_self_buy_through_an_undeclared_second_wallet_is_bounded() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, ic::params("SYBL")).await?;
    let alt = itrader(&ix, "altwallet", "SYBL", 100 * IUSDC).await?;
    let mut a = Attack::new("I29", "CO7", "Self-buy through an undeclared second wallet", "market", Expect::Bounded, "")
        .attempt("The creator funds a fresh wallet that is neither the creator nor the payout recipient and buys with it. The market cannot link wallets; this is a disclosed limit, never counted as a win.");
    a.attack("buy of 20 USDC from an undeclared wallet", &ibuy(&ix, &alt, &id, 20 * IUSDC, None).await, "");
    a.check("the buy went through (not blocked)", ix.bal(&ix.token_id("SYBL"), alt.id()).await > 0);
    a.check(
        "bound: the buyer pays the full opening-fee decay (500 bps falling to 100 over 60 minutes) and every fee slice, and the buy moves the price against itself",
        ic::n(&ix.market.view("quote_buy").args_json(json!({ "launch_id": id, "amount_in": "20000000" })).await?.json::<Value>()?["fee_bps"]) >= 100,
    );
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- caps

#[tokio::test]
async fn i30_seed_above_the_market_per_pool_cap() -> anyhow::Result<()> {
    let ix = ic::Ix::real("demo", Some((200 * IUSDC, 15_000 * IUSDC, 5_000 * IUSDC)), true).await?;
    let id = seeded(&ix, &ix.creator, ic::params("CAPP")).await?;
    let mut a = Attack::new("I30", "CO7", "Seed above the market's per-pool reserve cap", "instant+market", Expect::Refused, "R_MARKET_CAP")
        .attempt("A 250 USDC seed is handed to a market whose per-pool cap is 200 USDC. The leg is refused and the money must stay recoverable by the creator.");
    a.attack("open_instant with a 250 USDC seed against a 200 USDC cap", &ix.open(&ix.creator, &id).await?, "R_MARKET_CAP");
    a.check("no pool exists", mk_get_pool(&ix, &id).await.is_null());
    a.check(
        "the seed is back at the launcher",
        ix.usdc_bal(ix.launcher.id()).await == 250 * IUSDC && ix.usdc_bal(ix.market.id()).await == 0,
    );
    let seeded_at = ic::n(&ix.inst(&id).await["seeded_at_ns"]) as u64;
    ix.wait_until(seeded_at + 31_000 * MS).await;
    a.step("abort_instant by the creator", &ix.call(&ix.creator, "abort_instant", ic::lid(&id)).await?);
    a.check("the creator recovered the whole seed", ix.usdc_bal(ix.creator.id()).await == 250 * IUSDC);
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i31_buy_above_the_market_global_cap_on_an_instant_pool() -> anyhow::Result<()> {
    let ix = ic::Ix::real("demo", Some((5_000 * IUSDC, 1_200 * IUSDC, 5_000 * IUSDC)), true).await?;
    let mut p = ic::params("GLB1");
    p["seed_q"] = json!((1_000 * IUSDC).to_string());
    let first = ix.launch_to_open(&ix.creator, p).await?;
    let bob = itrader(&ix, "bob", "GLB1", 1_000 * IUSDC).await?;
    let q0 = ic::n(&mk_get_pool(&ix, &first).await["q"]);
    let mut a = Attack::new("I31", "CO7", "Buy that would push the market past the global reserve cap (instant pool)", "market", Expect::Refused, "R_MARKET_CAP")
        .attempt("With 1,000 USDC in an instant pool and a 1,200 USDC global cap, a buyer sends 300 USDC. (Market 1.1.1: instant seeds are no longer checked against the global cap, only buys are.)");
    a.attack("buy of 300 USDC past the global cap", &ibuy(&ix, &bob, &first, 300 * IUSDC, None).await, "R_MARKET_CAP");
    a.check("buyer refunded in full", ix.usdc_bal(bob.id()).await == 1_000 * IUSDC);
    a.check("the pool reserve is unchanged", ic::n(&mk_get_pool(&ix, &first).await["q"]) == q0);
    a.step("a 100 USDC buy inside the cap still works", &ibuy(&ix, &bob, &first, 100 * IUSDC, None).await);
    let (inv, ok) = inst_inv(&ix, &[&first], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i32_seeds_above_the_instant_sub_cap() -> anyhow::Result<()> {
    let ix = ic::Ix::real("demo", Some((5_000 * IUSDC, 15_000 * IUSDC, 300 * IUSDC)), true).await?;
    let first = ix.launch_to_open(&ix.creator, ic::params("SUB1")).await?;
    let b_creator = ix.user("creatorb", 250 * IUSDC).await?;
    let second = ix.create_ready(&b_creator, ic::params("SUB2"), None).await?;
    ix.seed(&b_creator, &second, 250 * IUSDC).await?.into_result()?;
    let bob = itrader(&ix, "bob", "SUB1", 1_000 * IUSDC).await?;
    let mut a = Attack::new("I32", "CO7", "Instant seeds crowd out the market: a seed above the instant sub-cap", "instant+market", Expect::Refused, "R_MARKET_CAP")
        .attempt("With a 300 USDC instant sub-cap (a cap on the SUM OF SEEDS since market 1.1.1) and one 250 USDC pool open, a second 250 USDC seed is sent. A buyer then pushes the first pool well past the sub-cap with a buy, which must no longer be blocked (trading cannot block seeding).");
    a.attack("second launch's seed past the sub-cap", &ix.open(&b_creator, &second).await?, "R_MARKET_CAP");
    a.step(
        "a 100 USDC buy that takes the reserve past the sub-cap (allowed since 1.1.1)",
        &ibuy(&ix, &bob, &first, 100 * IUSDC, None).await,
    );
    a.check("the buy was not blocked by the sub-cap", ix.bal(&ix.token_id("SUB1"), bob.id()).await > 0);
    a.check(
        "the second launch is still in Handoff, seed intact",
        ix.status(&second).await == "Handoff" && ix.usdc_bal(ix.launcher.id()).await == 250 * IUSDC,
    );
    let (inv, ok) = inst_inv(&ix, &[&first, &second], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i33_launcher_seed_caps_aggregate_and_per_launch() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let (c1, c2) = (ix.user("c1", 500 * IUSDC).await?, ix.user("c2", 500 * IUSDC).await?);
    let (id1, id2) = (ix.create_ready(&c1, ic::params("LCA1"), None).await?, ix.create_ready(&c2, ic::params("LCA2"), None).await?);
    ix.predeploy_token("LCA3", ic::N_TOTAL).await?;
    ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "400000000" })).await?.into_result()?;
    let c3 = ix.user("c3", 0).await?;
    let mut a = Attack::new("I33", "CO7", "Unconsumed seeds above the launcher's aggregate cap; a seed above the per-launch cap", "instant", Expect::Refused, "R_CAP_GLOBAL")
        .attempt("With the aggregate cap lowered to 400 USDC and one 250 USDC seed held, a second 250 USDC seed arrives; a third creator declares a 1,000.000001 USDC seed.");
    a.step("first seed (inside the cap)", &ix.seed(&c1, &id1, 250 * IUSDC).await?);
    a.attack("second seed above the aggregate cap", &ix.seed(&c2, &id2, 250 * IUSDC).await?, "R_CAP_GLOBAL");
    a.attack(
        "create_instant with seed_q above the per-launch cap",
        &ix.create_raw(&c3, json!({ "name": "Big", "symbol": "LCA3", "seed_q": "1000000001" }), None).await?,
        "R_SEED_RANGE",
    );
    a.check("second seed refunded in full", ix.usdc_bal(c2.id()).await == 500 * IUSDC && ix.status(&id2).await == "TokenReady");
    a.check("only one seed is held", ix.usdc_bal(ix.launcher.id()).await == 250 * IUSDC);
    let (inv, ok) = inst_inv(&ix, &[&id1, &id2], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- fake token, pause, freeze, cap timelock

#[tokio::test]
async fn i34_fake_launch_token_and_fake_usdc_against_an_instant_pool() -> anyhow::Result<()> {
    let mk = mc::Mk::new(None).await?;
    mk.set_launcher().await?;
    let iid = mc::INSTANT_BASE;
    mk.open_instant(iid, 500 * mc::USDC, mk.creator.id(), mk.creator.id()).await?;
    // a second instant pool whose seed landed but whose token leg has not
    mk.mint(&mk.usdc, mk.launcher.id(), 500 * mc::USDC).await?;
    let (c, r) = (mk.creator.id().clone(), mk.creator.id().clone());
    let root = mk.worker.root_account()?;
    let tok2 = mc::deploy_ft(&root, "tok2").await?;
    mk.mint(&tok2, mk.market.id(), 0).await?;
    mk.send(&mk.launcher, &mk.usdc, 500 * mc::USDC, mk.instant_seed_msg(iid + 1, tok2.id(), &c, &r)).await?.into_result()?;
    let fake = mc::deploy_ft(&root, "fake").await?;
    mk.mint(&fake, mk.market.id(), 0).await?;
    let eve = mk.user("eve", 0).await?;
    mk.mint(&fake, eve.id(), 500 * mc::USDC).await?;
    mk.mint(&fake, mk.launcher.id(), mc::SEED_T).await?;
    let mut a = Attack::new("I34", "CO7", "Fake launch token and fake USDC against instant pools", "market", Expect::Refused, "R_UNEXPECTED_TOKEN")
        .attempt("A look-alike token is used to buy, to sell, to open a new instant pool as 'USDC', and as the token bucket for a pool waiting for its token (once by a stranger, once even from the launcher account).");
    let before = mk.view("get_pool", json!({ "launch_id": iid.to_string() })).await;
    a.attack(
        "fake-USDC buy on the instant pool",
        &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::buy_msg(iid, 1)).await?,
        "R_UNEXPECTED_TOKEN",
    );
    a.attack(
        "fake-token sell on the instant pool",
        &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::sell_msg(iid, 1)).await?,
        "R_UNEXPECTED_TOKEN",
    );
    a.attack(
        "fake-USDC seed_quote for a new instant id",
        &mk.send(&eve, &fake, 100 * mc::USDC, mk.instant_seed_msg(iid + 2, fake.id(), &c, &r)).await?,
        "R_UNEXPECTED_TOKEN",
    );
    a.attack(
        "stranger sends a fake token as the token bucket",
        &mk.send(&eve, &fake, 100 * mc::USDC, mc::Mk::leg_msg(iid + 1)).await?,
        "R_NOT_AUTHORIZED",
    );
    a.attack(
        "launcher account sends a look-alike token as the bucket",
        &mk.send(&mk.launcher, &fake, mc::SEED_T, mc::Mk::leg_msg(iid + 1)).await?,
        "R_UNEXPECTED_TOKEN",
    );
    a.check("fakes refunded", mk.bal(&fake, eve.id()).await == 500 * mc::USDC && mk.bal(&fake, mk.launcher.id()).await == mc::SEED_T);
    a.check(
        "pool 1 unchanged, pool 2 still waiting for its token, no pool 3",
        mk.view("get_pool", json!({ "launch_id": iid.to_string() })).await == before
            && mk.view("get_pool", json!({ "launch_id": (iid + 1).to_string() })).await["state"] == "AwaitToken"
            && mk.view("get_pool", json!({ "launch_id": (iid + 2).to_string() })).await.is_null(),
    );
    mk.mint(&tok2, mk.launcher.id(), mc::SEED_T).await?;
    a.step("the real token bucket still completes pool 2", &mk.send(&mk.launcher, &tok2, mc::SEED_T, mc::Mk::leg_msg(iid + 1)).await?);
    a.check("pool 2 is Open", mk.view("get_pool", json!({ "launch_id": (iid + 1).to_string() })).await["state"] == "Open");
    let (inv, ok) = market_inv(&mk, &[iid, iid + 1]).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i35_launcher_pause_blocks_new_risk_but_not_the_exits() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let open_id = ix.launch_to_open(&ix.creator, vest30("PAUS")).await?;
    let tok = ix.token_id("PAUS");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let (b, c, d) = (ix.user("b", 250 * IUSDC).await?, ix.user("c", 250 * IUSDC).await?, ix.user("d", 0).await?);
    let b_id = ix.create_ready(&b, ic::params("PAUB"), None).await?;
    ix.seed(&b, &b_id, 250 * IUSDC).await?.into_result()?;
    let c_id = ix.create_ready(&c, ic::params("PAUC"), None).await?;
    ix.predeploy_token("PAUD", ic::N_TOTAL).await?;
    let mut a = Attack::new("I35", "CO7", "Pause: new launches, seeds and opens are refused; exits stay open", "instant", Expect::Refused, "R_PAUSED")
        .attempt("The launcher is paused. A new launch, a seed, and an open of an already seeded launch are tried; then the vesting claim, the abandon and the deposit reclaim (exits) are exercised.");
    a.step("guardian pause", &ix.call(&ix.guardian, "pause", json!({})).await?);
    a.attack("create_instant while paused", &ix.create_raw(&d, ic::params("PAUD"), None).await?, "R_PAUSED");
    a.attack("seed while paused", &ix.seed(&c, &c_id, 250 * IUSDC).await?, "R_PAUSED");
    a.attack("open_instant while paused", &ix.open(&b, &b_id).await?, "R_PAUSED");
    a.attack("unpause by the guardian", &ix.call(&ix.guardian, "unpause", json!({})).await?, "R_NOT_AUTHORIZED");
    let opened = ic::n(&ix.inst(&open_id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 100_000 * MS).await;
    a.step("claim_vested while paused (exit)", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": open_id })).await?);
    a.check("the vesting claim paid", ix.bal(&tok, ix.creator.id()).await > 0);
    a.step("abandon_instant while paused (exit)", &ix.call(&c, "abandon_instant", ic::lid(&c_id)).await?);
    a.check("abandon worked", ix.status(&c_id).await == "Abandoned");
    a.step("reclaim_deposit while paused (exit)", &ix.call_gas(&c, "reclaim_deposit", ic::lid(&c_id), 30).await?);
    a.check(
        "nothing new was created and c's seed was refunded",
        ix.view("get_config", json!({})).await["next_launch_id"] == (ic::ID0 + 3).to_string() && ix.usdc_bal(c.id()).await == 250 * IUSDC,
    );
    let (inv, ok) = inst_inv(&ix, &[&open_id, &b_id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i36_launcher_freeze_closes_exits_but_only_for_seven_days() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let id = ix.launch_to_open(&ix.creator, vest30("FRZN")).await?;
    let tok = ix.token_id("FRZN");
    ix.register_on_token(&tok, ix.creator.id()).await?;
    let c = ix.user("c", 0).await?;
    let c_id = ix.create_ready(&c, ic::params("FRZC"), None).await?;
    let opened = ic::n(&ix.inst(&id).await["opened_at_ns"]) as u64;
    ix.wait_until(opened + 100_000 * MS).await;
    let mut a = Attack::new("I36", "CO7", "Freeze closes the launcher's exits (disclosed limit: bounded to 7 days)", "instant", Expect::Bounded, "R_FROZEN")
        .attempt("The guardian freezes the launcher; the recipient claims and a creator abandons while frozen. This is NOT blocked by design; it ends by auto-expiry (7 days; the demo clock makes that 70 s) or an owner unpause.");
    let frozen = ix.call(&ix.guardian, "freeze", json!({})).await?;
    a.step("guardian freeze", &frozen);
    a.attack("claim_vested while FROZEN", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?, "R_FROZEN");
    a.attack("claim_owed while FROZEN", &ix.call(&ix.creator, "claim_owed", json!({ "token_id": ix.usdc.id() })).await?, "R_FROZEN");
    a.attack("withdraw_platform while FROZEN", &ix.call(&ix.treasury, "withdraw_platform", json!({})).await?, "R_FROZEN");
    a.check("config reports Frozen", ix.view("get_config", json!({})).await["paused"] == "Frozen");
    a.check("nothing was paid while frozen", ix.bal(&tok, ix.creator.id()).await == 0);
    let until = kruxa_logic::frozen_until(1_000);
    a.check(
        "bound (pure-logic check; the 7 days are real days, not demo units): freeze ends 7 days after it starts",
        until - 1_000 == 7 * 86_400 * 1_000_000_000,
    );
    a.check(
        "bound (pure-logic check): the effective level at the end is Paused, not Frozen",
        kruxa_logic::pause_at(kruxa_logic::Pause::Frozen, until, until) == kruxa_logic::Pause::Paused,
    );
    let ab = ix.call(&c, "abandon_instant", ic::lid(&c_id)).await?;
    a.step("abandon_instant while FROZEN (observation: the ABI says freeze closes it, the code does not gate it)", &ab);
    a.check(
        "observation recorded: abandon_instant is not closed by a freeze (doc and code differ, harmless to users)",
        ab.is_success() && ix.status(&c_id).await == "Abandoned",
    );
    a.step("owner unpause", &ix.call(&ix.owner, "unpause", json!({})).await?);
    a.step("claim_vested after the owner lifted the freeze", &ix.call(&ix.creator, "claim_vested", json!({ "launch_id": id })).await?);
    a.check("the recipient was paid after the unpause", ix.bal(&tok, ix.creator.id()).await > 0);
    let (inv, ok) = inst_inv(&ix, &[&id], false).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i37_market_pause_cannot_trap_sells_on_an_instant_pool() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", false).await?;
    let id = ix.launch_to_open(&ix.creator, ic::params("MPAU")).await?;
    let bob = itrader(&ix, "bob", "MPAU", 500 * IUSDC).await?;
    ibuy(&ix, &bob, &id, 100 * IUSDC, None).await.into_result()?;
    let tok = ix.token_id("MPAU");
    let held = ix.bal(&tok, bob.id()).await;
    let mut a = Attack::new("I37", "CO7", "Market pause used to trap holders of an instant pool", "market", Expect::NoEffect, "")
        .attempt("The guardian pauses the market; the holder tries to buy more (refused) and to sell everything back out (must succeed).");
    a.step("guardian pauses the market", &ix.guardian.call(ix.market.id(), "pause").transact().await?);
    a.check("a new buy is refused while paused (R_PAUSED)", has_code(&ibuy(&ix, &bob, &id, 10 * IUSDC, None).await, "R_PAUSED"));
    let msg = json!({ "v": 1, "op": "sell", "launch_id": id, "min_out": "1" }).to_string();
    let sell = bob
        .call(&tok, "ft_transfer_call")
        .args_json(json!({ "receiver_id": ix.market.id(), "amount": held.to_string(), "msg": msg }))
        .deposit(ONE)
        .gas(ic::GAS)
        .transact()
        .await?;
    a.attack("holder sells everything while the market is PAUSED", &sell, "");
    a.check("the sell executed and the holder is out", ix.bal(&tok, bob.id()).await == 0 && ix.usdc_bal(bob.id()).await > 400 * IUSDC);
    let (inv, ok) = inst_inv(&ix, &[&id], true).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn i38_seed_cap_raise_without_the_seven_day_timelock() -> anyhow::Result<()> {
    let ix = ic::Ix::new("demo", true).await?;
    let stranger = ix.user("stranger", 0).await?;
    let mut a = Attack::new("I38", "CO7", "Raise a seed cap without the 7-day timelock", "instant", Expect::Refused, "R_NOT_YET")
        .attempt("The guardian tries to raise the caps (owner only), the owner queues a raise and a stranger applies it at once, and the guardian lowers a cap below the minimum seed.");
    a.attack(
        "guardian raises the aggregate cap",
        &ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "aggregate", "value": "9000000000" })).await?,
        "R_NOT_AUTHORIZED",
    );
    a.attack(
        "stranger raises the per-launch cap",
        &ix.call(&stranger, "set_seed_cap", json!({ "kind": "per_launch", "value": "9000000000" })).await?,
        "R_NOT_AUTHORIZED",
    );
    let queued = ix.call(&ix.owner, "set_seed_cap", json!({ "kind": "aggregate", "value": "9000000000" })).await?;
    a.step("owner queues the raise (event cap_queued)", &queued);
    let ev = ic::events(&queued, "cap_queued");
    a.check(
        "the raise was queued, not applied",
        ev.len() == 1 && ic::n(&ix.view("get_config", json!({})).await["seed_cap_aggregate"]) == 3_000 * IUSDC,
    );
    let wait_ns = ev
        .first()
        .map(|e| e["effective_at"].as_u64().or_else(|| e["effective_at"].as_str().and_then(|x| x.parse().ok())).unwrap_or(0))
        .unwrap_or(0)
        .saturating_sub(ix.now().await);
    a.check(
        "the queued raise takes effect at least 6.9 days later (real days, not demo units)",
        wait_ns > 6 * 86_400 * 1_000_000_000 + 20 * 3_600 * 1_000_000_000,
    );
    a.attack("apply_seed_cap immediately", &ix.call(&stranger, "apply_seed_cap", json!({ "kind": "aggregate" })).await?, "R_NOT_YET");
    a.attack(
        "apply_seed_cap for a cap with nothing queued",
        &ix.call(&stranger, "apply_seed_cap", json!({ "kind": "per_launch" })).await?,
        "R_NOTHING",
    );
    a.attack(
        "guardian lowers the per-launch cap below the minimum seed",
        &ix.call(&ix.guardian, "set_seed_cap", json!({ "kind": "per_launch", "value": "50000000" })).await?,
        "R_CAP_GLOBAL",
    );
    a.check(
        "caps unchanged",
        ic::n(&ix.view("get_config", json!({})).await["seed_cap_aggregate"]) == 3_000 * IUSDC
            && ic::n(&ix.view("get_config", json!({})).await["seed_max"]) == 1_000 * IUSDC,
    );
    let (inv, ok) = inst_inv(&ix, &[], false).await;
    a.finish(inv, ok);
    Ok(())
}

// ================================================================ C: the core's newer surface (ids C01 and up)
// Genesis reopen and the F0 gate, the solvency anchor, token claims, governance with a delay, and the exit conveniences.

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    kruxa_logic::hex(&Sha256::digest(bytes))
}

fn core_wasm() -> Vec<u8> {
    kruxa_tests::core_wasm_bytes()
}

/// The same program with one extra custom section: a different hash, identical behaviour (and it has `migrate`).
fn core_wasm_v2() -> Vec<u8> {
    let mut code = core_wasm();
    code.extend_from_slice(&[0, 5, 2, b'k', b'x', b'v', b'2']);
    code
}

async fn upgrade_call(env: &Env, who: &Account, code: Vec<u8>) -> ExecutionFinalResult {
    who.call(env.core.id(), "upgrade_core").args(code).gas(GAS).transact().await.unwrap()
}

async fn wait_secs(env: &Env, secs: u64) {
    let start = env.worker.view_block().await.unwrap().timestamp();
    while env.worker.view_block().await.unwrap().timestamp() - start < secs * 1_000_000_000 {
        env.worker.fast_forward(20).await.unwrap();
    }
}

fn key_of(a: &Account) -> String {
    format!("near:{}", a.id())
}

fn num_of(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

fn mint_of(r: &GRound) -> String {
    kruxa_logic::hex(&kruxa_logic::genesis::mint_address(&[5u8; 32], &r.id.to_string(), &kruxa_logic::genesis::TOKEN_PROGRAM))
}

#[tokio::test]
async fn c01_reopen_genesis_by_anyone_but_the_owner_or_outside_an_aborted_genesis() -> anyhow::Result<()> {
    let r = genesis_round("C01").await?;
    let eve = stranger(&r.env, "eve").await?;
    let mut a = Attack::new("C01", "", "reopen_genesis by the relayer, guardian, creator or a stranger, and outside an aborted genesis", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("The relayer, the guardian, the creator and a stranger try to reopen an aborted genesis (to re-run the ceremony with a key of their choice); the owner's reopen is tried before any commit, while committed, and after a confirm, where it must be refused.");
    a.attack("owner reopen before any commit", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE");
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.attack("owner reopen while committed (not aborted)", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE");
    let abort = json!({ "launch_id": r.id.to_string(), "reason": "relayer host compromised" });
    a.step("guardian abort_genesis", &r.call(&r.env.guardian, "abort_genesis", abort).await);
    for (who, label) in [(&r.relayer, "relayer"), (&r.env.guardian, "guardian"), (&r.env.creator, "creator"), (&eve, "stranger")] {
        a.attack(&format!("reopen_genesis by the {label}"), &r.call(who, "reopen_genesis", lid(r.id)).await, "R_NOT_AUTHORIZED");
    }
    a.check("the guardian's abort is still final", r.genesis().await["status"] == "Aborted");
    a.step("owner reopen_genesis (legitimate)", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await);
    a.step("commit_genesis again", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.step("all leaves", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await);
    a.step("confirm_genesis", &r.call(&r.relayer, "confirm_genesis", r.confirm(&mint_of(&r))).await);
    let root = r.genesis().await["merkle_root"].clone();
    a.attack("owner reopen after confirm", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await, "R_GENESIS_STATE");
    a.attack("relayer reopen after confirm", &r.call(&r.relayer, "reopen_genesis", lid(r.id)).await, "R_NOT_AUTHORIZED");
    let g = r.genesis().await;
    a.check("a confirmed genesis keeps its status and root", g["status"] == "Confirmed" && g["merkle_root"] == root);
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c02_commit_after_a_guardian_abort_and_a_stale_ceremony_after_the_reopen() -> anyhow::Result<()> {
    let r = genesis_round("C02").await?;
    let mut a = Attack::new("C02", "", "Re-commit after a guardian abort, and a stale ceremony replayed after the owner reopens", "core", Expect::Refused, "R_GENESIS_ALREADY")
        .attempt("After the guardian aborts a committed genesis the relayer commits again (same key, fresh key), pages and confirms, and the guardian itself commits. After the owner reopens, a confirm that names the OLD attempt's mint is sent against the NEW commit.");
    a.step("commit_genesis (legitimate)", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    let old_mint = mint_of(&r);
    a.step(
        "guardian abort_genesis",
        &r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "drill" })).await,
    );
    a.attack(
        "commit_genesis with the same key after the abort",
        &r.call(&r.relayer, "commit_genesis", r.commit()).await,
        "R_GENESIS_ALREADY",
    );
    let fresh = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[8u8; 32]) });
    a.attack(
        "commit_genesis with a fresh key after the abort",
        &r.call(&r.relayer, "commit_genesis", fresh.clone()).await,
        "R_GENESIS_ALREADY",
    );
    a.attack("build_root_page after the abort", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await, "R_GENESIS_STATE");
    a.attack("confirm_genesis after the abort", &r.call(&r.relayer, "confirm_genesis", r.confirm(&old_mint)).await, "R_GENESIS_STATE");
    a.attack("the guardian commits", &r.call(&r.env.guardian, "commit_genesis", fresh.clone()).await, "R_NOT_AUTHORIZED");
    a.check("status stays Aborted", r.genesis().await["status"] == "Aborted");
    a.step("owner reopen_genesis", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await);
    let g = r.genesis().await;
    a.check(
        "the reopened genesis starts clean: no key, no mint, no root, no leaves",
        g["status"] == "None" && g["g_pub"].is_null() && g["mint_address"].is_null() && g["root_ready"] == false && g["leaf_count"] == 0,
    );
    a.attack(
        "confirm_genesis before the new commit",
        &r.call(&r.relayer, "confirm_genesis", r.confirm(&old_mint)).await,
        "R_GENESIS_STATE",
    );
    a.step("commit_genesis with the fresh key", &r.call(&r.relayer, "commit_genesis", fresh).await);
    a.step("all leaves", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await);
    a.attack("confirm naming the old attempt's mint", &r.call(&r.relayer, "confirm_genesis", r.confirm(&old_mint)).await, "R_GENESIS_ARG");
    a.check("the new commit is still unconfirmed", r.genesis().await["status"] == "Committed");
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

fn f0_plan() -> Value {
    json!({ "mode": "F0", "mint_pubkey_f0": kruxa_logic::hex(&[5u8; 32]) })
}

fn sign_args(id: u64, index: u8, message: &[u8]) -> Value {
    json!({ "launch_id": id.to_string(), "tx_index": index, "message_hex": kruxa_logic::hex(message) })
}

fn register_args(id: u64, index: u8, message: &[u8]) -> Value {
    json!({ "launch_id": id.to_string(), "tx_index": index, "message_sha256": sha256_hex(message) })
}

#[tokio::test]
async fn c03_f0_sign_genesis_with_an_unregistered_or_mismatched_message() -> anyhow::Result<()> {
    let r = genesis_round_plan("C03", f0_plan()).await?;
    let eve = stranger(&r.env, "eve").await?;
    let (msg_a, msg_b) = (b"tx1 message as compiled".to_vec(), b"a transaction that drains the mint".to_vec());
    let mut a = Attack::new("C03", "", "F0 policy gate: sign_genesis with an unregistered hash, a mismatched message, the wrong slot, a stranger, or the wrong MPC key", "core", Expect::Refused, "R_GENESIS_ARG")
        .attempt("On an F0 launch the relayer asks the MPC signer to sign a message nobody registered, then a different message than the registered one, then the tx1 message as tx2, an oversize packet; strangers register and sign; and commit_genesis names a key other than the MPC child key.");
    let other_key = json!({ "launch_id": r.id.to_string(), "g_pub": kruxa_logic::hex(&[6u8; 32]) });
    a.attack(
        "commit_genesis with a key other than the plan's MPC child key",
        &r.call(&r.relayer, "commit_genesis", other_key).await,
        "R_GENESIS_ARG",
    );
    a.attack("sign_genesis before any commit", &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_a)).await, "R_GENESIS_STATE");
    a.step("commit_genesis with the MPC child key", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.step("all leaves (the gate opens once the root is complete)", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await);
    for (who, label) in [(&eve, "stranger"), (&r.env.owner, "owner"), (&r.env.guardian, "guardian"), (&r.env.creator, "creator")] {
        a.attack(
            &format!("register_f0_message by the {label}"),
            &r.call(who, "register_f0_message", register_args(r.id, 0, &msg_a)).await,
            "R_NOT_AUTHORIZED",
        );
        a.attack(
            &format!("sign_genesis by the {label}"),
            &r.call(who, "sign_genesis", sign_args(r.id, 0, &msg_a)).await,
            "R_NOT_AUTHORIZED",
        );
    }
    a.attack(
        "register_f0_message for tx index 2",
        &r.call(&r.relayer, "register_f0_message", register_args(r.id, 2, &msg_a)).await,
        "R_GENESIS_STATE",
    );
    a.attack(
        "sign_genesis with nothing registered",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_a)).await,
        "R_GENESIS_ARG",
    );
    a.step("register_f0_message (tx1)", &r.call(&r.relayer, "register_f0_message", register_args(r.id, 0, &msg_a)).await);
    a.attack(
        "sign_genesis with a different message",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_b)).await,
        "R_GENESIS_ARG",
    );
    a.attack("sign the tx1 message as tx2", &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 1, &msg_a)).await, "R_GENESIS_ARG");
    let huge = vec![7u8; 1233];
    a.step("register an oversize packet for tx2", &r.call(&r.relayer, "register_f0_message", register_args(r.id, 1, &huge)).await);
    a.attack(
        "sign_genesis with a message over one packet",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 1, &huge)).await,
        "R_GENESIS_ARG",
    );
    let g = r.genesis().await;
    a.check("nothing was signed", g["f0_gate"]["signed"] == json!([false, false]));
    a.check("the registered hash for tx1 is still the honest one", g["f0_gate"]["registered"][0] == sha256_hex(&msg_a));
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c04_f0_double_sign_swap_after_sign_and_a_gate_that_does_not_survive_the_reopen() -> anyhow::Result<()> {
    let r = genesis_round_plan("C04", f0_plan()).await?;
    let (msg_a, msg_b) = (b"tx1 message as compiled".to_vec(), b"a replacement message".to_vec());
    let mut a = Attack::new("C04", "", "F0 policy gate: a second signature, a swap after signing, signing while paused or aborted, and a registration that survives the reopen", "core", Expect::Refused, "R_GENESIS_STATE")
        .attempt("After one legitimate signature request for tx1 the relayer asks again with the same message, re-registers a replacement message on the spent slot, and signs while the ceremony is paused and after it is aborted; after the owner reopens, the old registration must be gone.");
    a.step("commit_genesis", &r.call(&r.relayer, "commit_genesis", r.commit()).await);
    a.step("all leaves (the gate opens once the root is complete)", &r.call(&r.relayer, "build_root_page", r.page(&r.leaves)).await);
    a.step("register_f0_message (tx1)", &r.call(&r.relayer, "register_f0_message", register_args(r.id, 0, &msg_a)).await);
    a.step("sign_genesis (legitimate, one per registration)", &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_a)).await);
    a.check("the slot is spent", r.genesis().await["f0_gate"]["signed"] == json!([true, false]));
    a.attack(
        "sign_genesis a second time with the same message",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_a)).await,
        "R_GENESIS_STATE",
    );
    a.attack(
        "re-register a replacement message on the signed slot",
        &r.call(&r.relayer, "register_f0_message", register_args(r.id, 0, &msg_b)).await,
        "R_GENESIS_STATE",
    );
    a.attack("sign the replacement message", &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 0, &msg_b)).await, "R_GENESIS_ARG");
    a.step("register_f0_message (tx2)", &r.call(&r.relayer, "register_f0_message", register_args(r.id, 1, &msg_b)).await);
    a.step("guardian pause_genesis", &r.call(&r.env.guardian, "pause_genesis", json!({})).await);
    a.attack(
        "sign_genesis (tx2) while genesis is paused",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 1, &msg_b)).await,
        "R_PAUSED",
    );
    a.step("owner resume_genesis", &r.call(&r.env.owner, "resume_genesis", json!({})).await);
    a.step(
        "guardian abort_genesis",
        &r.call(&r.env.guardian, "abort_genesis", json!({ "launch_id": r.id.to_string(), "reason": "drill" })).await,
    );
    a.attack(
        "sign_genesis (tx2) after the abort",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 1, &msg_b)).await,
        "R_GENESIS_STATE",
    );
    a.step("owner reopen_genesis", &r.call(&r.env.owner, "reopen_genesis", lid(r.id)).await);
    let g = r.genesis().await;
    a.check(
        "the reopened gate is empty and unsigned",
        g["f0_gate"]["registered"] == json!([null, null]) && g["f0_gate"]["signed"] == json!([false, false]),
    );
    a.attack(
        "sign_genesis with the old registration after the reopen",
        &r.call(&r.relayer, "sign_genesis", sign_args(r.id, 1, &msg_b)).await,
        "R_GENESIS_STATE",
    );
    let (inv, ok) = core_inv(&r.env).await;
    a.finish(inv, ok);
    Ok(())
}

async fn solvency_check(env: &Env, who: &Account) -> ExecutionFinalResult {
    who.call(env.core.id(), "check_solvency").gas(GAS).transact().await.unwrap()
}

#[tokio::test]
async fn c05_check_solvency_spam_is_rate_limited_and_cannot_hold_the_cooldown() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("C05")).await?;
    buyers(&env, id, 3, 40 * USDC).await?;
    let spammers = [stranger(&env, "eve").await?, stranger(&env, "mallory").await?, env.creator.clone()];
    let mut a = Attack::new("C05", "", "check_solvency spam: many callers, both entry points, to starve the keeper or bloat the logs", "core", Expect::Refused, "R_TOO_EARLY")
        .attempt("One check is served; then three accounts call check_solvency and reconcile_intents back to back inside the 30 second cooldown, and keep trying after the keeper's turn would have come.");
    a.step("first check_solvency (served)", &solvency_check(&env, &spammers[0]).await);
    let served = env.view("solvency_report", json!({})).await["last_check"].clone();
    for i in 0..9 {
        let who = &spammers[i % 3];
        a.attack(&format!("check_solvency spam #{i}"), &solvency_check(&env, who).await, "R_TOO_EARLY");
    }
    let recon = spammers[1].call(env.core.id(), "reconcile_intents").gas(GAS).transact().await?;
    a.attack("reconcile_intents inside the cooldown (shared limiter)", &recon, "R_TOO_EARLY");
    let after = env.view("solvency_report", json!({})).await;
    a.check("the stored report is the one the first check wrote (refused calls wrote nothing)", after["last_check"] == served);
    a.check("counters still equal the recomputation", after["counters_ok"] == true);
    env.worker.fast_forward(100).await?;
    let keeper = stranger(&env, "keeper").await?;
    let turn = solvency_check(&env, &keeper).await;
    a.step("the keeper's check after the cooldown", &turn);
    a.check("spam did not extend or hold the cooldown: the keeper is served", turn.is_success());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c06_forged_solvency_callback_and_attempts_to_raise_the_intents_alert() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("C06S")).await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("C06", "", "Forged on_solvency_checked and a fake shortfall to raise the Intents alert (griefing the Intents commit path)", "core", Expect::Refused, "PRIVATE_METHOD")
        .attempt("A stranger calls the private solvency callback directly with a huge pre-call Intents liability, to make core report a shortfall and refuse every Intents commit; a donation to core's balance is also tried to disturb the counters.");
    let forged = json!({ "pre_native": "0", "pre_intents": "999999999999999", "with_native": false });
    a.attack("direct on_solvency_checked", &env.worker_call(&eve, env.core.id(), "on_solvency_checked", forged).await, "PRIVATE_METHOD");
    env.usdc
        .call("mint")
        .args_json(json!({ "account_id": env.core.id(), "amount": (25 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    a.step("honest check_solvency after a 25 USDC donation to core", &solvency_check(&env, &eve).await);
    let rep = env.view("solvency_report", json!({})).await;
    a.check("no alert was raised", rep["intents_alert"] == false);
    a.check("counters equal the recomputation after the donation", rep["counters_ok"] == true);
    let h = sol_holder(61);
    env.fund_intents(&h.hex, 40 * USDC).await?;
    let commit = env.commit_s3(&h, id, 30 * USDC, 0).await;
    a.step("an Intents commit still goes through", &commit);
    a.check("the Intents commit was credited", env.view("get_ledger", lid(id)).await["open_intents"] == (30 * USDC).to_string());
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c07_claim_tokens_reentry_and_double_claim() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = passed_launch(&env, "C07").await?;
    let holder = &users[0];
    env.register_on_token("C07", holder.id()).await?;
    let eve = stranger(&env, "eve").await?;
    let token = env.token_id("C07");
    let reenter = json!({ "account": env.core.id(), "method": "claim_tokens", "args": lid(id).to_string() });
    env.owner.call(&token, "set_reenter").args_json(reenter).transact().await?.into_result()?;
    let mut a = Attack::new("C07", "", "claim_tokens: re-entry from inside the token transfer, a second claim at once, and a stranger's claim", "core", Expect::NoEffect, "")
        .attempt("The launch token (made hostile for this test) calls claim_tokens again from inside ft_transfer, before core's callback ran; the holder then claims a second time immediately; a stranger with no position claims.");
    let first = env.call(holder, "claim_tokens", lid(id), ONE).await;
    a.attack("claim_tokens with a reentering token", &first, "");
    let got = env.token_balance("C07", holder.id()).await;
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key_of(holder) })).await;
    let entitled = num_of(&pos, "tokens_entitled") + num_of(&pos, "bonus_entitled");
    a.check("the holder received tokens once, equal to the position's claimed counter", got > 0 && got == num_of(&pos, "claimed"));
    a.check("never more than the entitlement", got <= entitled);
    env.owner
        .call(&token, "set_reenter")
        .args_json(json!({ "account": env.core.id(), "method": "", "args": "" }))
        .transact()
        .await?
        .into_result()?;
    let second = env.call(holder, "claim_tokens", lid(id), ONE).await;
    a.attack("second claim_tokens straight after (linear bonus only)", &second, "");
    let pos2 = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key_of(holder) })).await;
    a.check(
        "the second claim added only what vested since (a few seconds of linear bonus), never the sale share again",
        env.token_balance("C07", holder.id()).await - got < entitled / 100 && num_of(&pos2, "claimed") <= entitled,
    );
    a.attack("claim_tokens by a stranger", &env.call(&eve, "claim_tokens", lid(id), ONE).await, "R_NO_POSITION");
    a.check("the stranger received nothing", env.token_balance("C07", eve.id()).await == 0);
    let cust = env.view("get_token_custody", lid(id)).await;
    a.check("claimed_total equals what the holder holds", num_of(&cust, "claimed_total") == env.token_balance("C07", holder.id()).await);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c08_claim_creator_alloc_by_a_stranger_the_creator_or_before_the_cliff() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = stranger(&env, "payee").await?;
    let eve = stranger(&env, "eve").await?;
    let id = env.create_launch_to(&env.creator, &params("C08"), Some(payee.id())).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    let mut a = Attack::new("C08", "", "claim_creator_alloc by a stranger, by the creator who is not the payout recipient, early, or without a deposit", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("The creator allocation belongs to the payout recipient. A stranger and the creator (a different account) claim it; the recipient claims before PASS, with no deposit, and at the cliff.");
    a.attack("recipient claims on an Open launch", &env.call(&payee, "claim_creator_alloc", lid(id), ONE).await, "R_WRONG_PHASE");
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    a.attack("stranger claims", &env.call(&eve, "claim_creator_alloc", lid(id), ONE).await, "R_NOT_AUTHORIZED");
    a.attack(
        "the creator (not the recipient) claims",
        &env.call(&env.creator, "claim_creator_alloc", lid(id), ONE).await,
        "R_NOT_AUTHORIZED",
    );
    a.attack("recipient claims with no attached deposit", &env.call(&payee, "claim_creator_alloc", lid(id), ZERO).await, "R_DEPOSIT");
    a.attack("recipient claims at the cliff, nothing vested", &env.call(&payee, "claim_creator_alloc", lid(id), ONE).await, "R_NOTHING");
    let cust = env.view("get_token_custody", lid(id)).await;
    a.check("nothing was claimed", num_of(&cust, "alloc_claimed") == 0);
    a.check(
        "no wallet received launch tokens",
        env.token_balance("C08", payee.id()).await == 0 && env.token_balance("C08", eve.id()).await == 0,
    );
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c09_sweep_tokens_before_the_vest_and_window_end() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, _) = passed_launch(&env, "C09").await?;
    let other = env.user("creator2", 0).await?;
    let open_id = env.create_launch_as(&other, &params("C09B")).await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("C09", "", "sweep_tokens early: on a PASSED launch inside the bonus window, on an Open launch, on an unknown launch", "core", Expect::Refused, "R_NOTHING")
        .attempt("A stranger calls sweep_tokens to pull unclaimed supply to the burn sink before the bonus vest and the sweep window ended, on a launch with no verdict, and on a launch that does not exist.");
    let deposit = NearToken::from_millinear(10);
    a.attack("sweep_tokens on a PASSED launch inside the window", &env.call(&eve, "sweep_tokens", lid(id), deposit).await, "R_NOTHING");
    a.attack("sweep_tokens on an Open launch", &env.call(&eve, "sweep_tokens", lid(open_id), deposit).await, "R_NOTHING");
    a.attack("sweep_tokens on an unknown launch", &env.call(&eve, "sweep_tokens", lid(99), deposit).await, "R_NO_LAUNCH");
    let cust = env.view("get_token_custody", lid(id)).await;
    a.check("nothing was swept and nothing is sweepable yet", num_of(&cust, "swept") == 0 && num_of(&cust, "sweepable_now") == 0);
    a.check("burn_mode is still unlocked (a refused sweep must not lock it)", cust["burn_mode_locked"] == false);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c10_set_burn_mode_to_a_reserved_account_by_a_non_owner_and_after_the_lock() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("C10")).await?;
    let eve = stranger(&env, "eve").await?;
    let graveyard = stranger(&env, "graveyard").await?;
    let mut a = Attack::new("C10", "", "set_burn_mode: by a non-owner, to a Kruxa-controlled sink, to burn, and again after the lock", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("A stranger and the guardian set the burn mode; the owner (or a key thief acting as the owner) points the sink at the owner, guardian, treasury, relay-fee, or core accounts, asks for burn, and tries to change the mode again once it is locked.");
    a.attack("set_burn_mode by a stranger", &env.call(&eve, "set_burn_mode", json!({ "mode": "hold" }), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack(
        "set_burn_mode by the guardian",
        &env.call(&env.guardian, "set_burn_mode", json!({ "mode": "hold" }), ZERO).await,
        "R_NOT_AUTHORIZED",
    );
    for reserved in [env.owner.id(), env.guardian.id(), env.treasury.id(), env.relay_fees.id(), env.core.id()] {
        let r = env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{reserved}") }), ZERO).await;
        a.attack(&format!("sink:{reserved}"), &r, "R_NOT_AUTHORIZED");
    }
    a.attack(
        "mode burn (the factory token has no ft_burn)",
        &env.call(&env.owner, "set_burn_mode", json!({ "mode": "burn" }), ZERO).await,
        "R_BURN_UNSUPPORTED",
    );
    a.attack("an unparsable mode", &env.call(&env.owner, "set_burn_mode", json!({ "mode": "garbage" }), ZERO).await, "R_NOTHING");
    let before = env.view("get_token_custody", lid(id)).await;
    a.check("still the default and unlocked after every refusal", before["burn_mode"] == "hold" && before["burn_mode_locked"] == false);
    let sink = format!("sink:{}", graveyard.id());
    a.step("owner sets a public sink (legitimate, locks)", &env.call(&env.owner, "set_burn_mode", json!({ "mode": sink }), ZERO).await);
    a.attack(
        "owner changes the mode after the lock",
        &env.call(&env.owner, "set_burn_mode", json!({ "mode": "hold" }), ZERO).await,
        "R_NOTHING",
    );
    a.attack(
        "owner re-points the sink after the lock",
        &env.call(&env.owner, "set_burn_mode", json!({ "mode": format!("sink:{}", eve.id()) }), ZERO).await,
        "R_NOTHING",
    );
    let after = env.view("get_token_custody", lid(id)).await;
    a.check("the sink is the public one and locked", after["burn_mode"] == sink.as_str() && after["burn_mode_locked"] == true);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c11_upgrade_queue_by_the_guardian_with_a_bad_hash_or_before_the_seven_day_delay() -> anyhow::Result<()> {
    let env = Env::new_with_profile("testnet").await?;
    let eve = stranger(&env, "eve").await?;
    let v2 = core_wasm_v2();
    let h = sha256_hex(&v2);
    let before = sha256_hex(&env.worker.view_code(env.core.id()).await?);
    let mut a = Attack::new("C11", "", "Upgrade queue: queued by the guardian or a stranger, with a malformed hash, deployed by a non-owner, or deployed before the 7 day delay", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("A compromised guardian and a stranger queue a code hash; the owner's queue is tried with malformed hashes; a guardian and a stranger deploy a queued wasm; the owner deploys the queued wasm at once and after a few minutes, on the profile that uses the real 7 day delay.");
    for (who, label) in [(&env.guardian, "guardian"), (&eve, "stranger"), (&env.creator, "creator")] {
        a.attack(
            &format!("queue_upgrade by the {label}"),
            &env.call(who, "queue_upgrade", json!({ "code_hash": h }), ZERO).await,
            "R_NOT_AUTHORIZED",
        );
    }
    for bad in ["", "abc", &h.to_uppercase(), &format!("{h}0")] {
        a.attack(
            &format!("queue_upgrade with hash {:?}", &bad[..bad.len().min(8)]),
            &env.call(&env.owner, "queue_upgrade", json!({ "code_hash": bad }), ZERO).await,
            "R_UPGRADE_HASH",
        );
    }
    a.attack("upgrade_core with nothing queued", &upgrade_call(&env, &env.owner, v2.clone()).await, "R_NOTHING");
    let queued = env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await;
    a.step("owner queue_upgrade (legitimate)", &queued);
    a.attack("upgrade_core by the guardian", &upgrade_call(&env, &env.guardian, v2.clone()).await, "R_NOT_AUTHORIZED");
    a.attack("upgrade_core by a stranger", &upgrade_call(&env, &eve, v2.clone()).await, "R_NOT_AUTHORIZED");
    a.attack("upgrade_core by the owner immediately", &upgrade_call(&env, &env.owner, v2.clone()).await, "R_NOT_YET");
    env.worker.fast_forward(300).await?;
    a.attack("upgrade_core by the owner a few minutes later", &upgrade_call(&env, &env.owner, v2).await, "R_NOT_YET");
    a.attack("cancel_upgrade by a stranger", &env.call(&eve, "cancel_upgrade", json!({}), ZERO).await, "R_NOT_AUTHORIZED");
    let pending = env.view("get_ops_state", json!({})).await["pending_upgrade"].clone();
    let eff: u64 = pending["effective_at"].as_str().unwrap().parse()?;
    let now = env.worker.view_block().await?.timestamp();
    a.check(
        "the queued deploy is more than 6.9 days away (real days, not demo seconds)",
        eff.saturating_sub(now) > 6 * 86_400 * 1_000_000_000 + 20 * 3_600 * 1_000_000_000,
    );
    a.check("the deployed code is unchanged", sha256_hex(&env.worker.view_code(env.core.id()).await?) == before);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c12_upgrade_with_a_different_wasm_after_the_delay_and_a_requeue_that_restarts_the_clock() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let v2 = core_wasm_v2();
    let h = sha256_hex(&v2);
    let before = sha256_hex(&env.worker.view_code(env.core.id()).await?);
    let mut a = Attack::new("C12", "", "Upgrade bait and switch: deploy a wasm that is not the queued hash after the delay, deploy as the guardian after the delay, or re-queue and deploy at the old time", "core", Expect::Refused, "R_UPGRADE_HASH")
        .attempt("The delay on the demo clock is 60 seconds. After it, a different wasm (the unmodified build) is supplied against the queued hash, the guardian tries to deploy the right wasm, and the owner re-queues and deploys at the old time.");
    a.step("owner queue_upgrade", &env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await);
    wait_secs(&env, 61).await;
    a.attack("deploy a wasm that is not the queued one", &upgrade_call(&env, &env.owner, core_wasm()).await, "R_UPGRADE_HASH");
    a.attack(
        "the guardian deploys the right wasm after the delay",
        &upgrade_call(&env, &env.guardian, v2.clone()).await,
        "R_NOT_AUTHORIZED",
    );
    a.step("owner re-queues the same hash", &env.call(&env.owner, "queue_upgrade", json!({ "code_hash": h }), ZERO).await);
    a.attack("deploy at the old time after the re-queue", &upgrade_call(&env, &env.owner, v2).await, "R_NOT_YET");
    a.check("the deployed code is still the original", sha256_hex(&env.worker.view_code(env.core.id()).await?) == before);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c13_halt_launch_then_commit_is_refused_while_walk_refund_verdict_and_claims_still_work() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("C13")).await?;
    let mut users = Vec::new();
    for i in 0..13 {
        let u = env.user(&format!("h{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, 30 * USDC, None).await.is_success());
        users.push(u);
    }
    let outsider = env.user("outsider", 1_000 * USDC).await?;
    let mut a = Attack::new("C13", "", "halt_launch: commit into a halted launch, creator payouts while halted, and halt or resume by the wrong account", "core", Expect::Refused, "R_HALTED")
        .attempt("The guardian halts one launch. A new commit, the creator's pay_launch_fee, consolidate and draw are tried while halted (refused); the creator and a stranger try to halt; the guardian tries to resume. Walk, the verdict, the position pages and a holder's claim_tokens must still work.");
    a.attack(
        "halt_launch by the creator",
        &env.call(&env.creator, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "x" }), ZERO).await,
        "R_NOT_AUTHORIZED",
    );
    a.attack(
        "halt_launch by a stranger",
        &env.call(&outsider, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "x" }), ZERO).await,
        "R_NOT_AUTHORIZED",
    );
    a.step(
        "guardian halt_launch",
        &env.call(&env.guardian, "halt_launch", json!({ "launch_id": id.to_string(), "reason": "exploit report" }), ZERO).await,
    );
    a.attack("a new commit into the halted launch", &env.commit_native(&outsider, id, 30 * USDC, None).await, "R_HALTED");
    a.check("the refused commit went straight back", env.usdc_balance(outsider.id()).await == 1_000 * USDC);
    let walk = env.call(&users[0], "walk", lid(id), ONE).await;
    a.step("Walk while halted", &walk);
    a.check("Walk refunded in full while halted", env.usdc_balance(users[0].id()).await == 1_000 * USDC);
    env.advance_to(id, "Ready").await;
    let settled = env.call(&outsider, "settle", lid(id), ZERO).await;
    a.step("settle while halted", &settled);
    a.check("the verdict is not held back (PASS: 12 funders, 360 USDC)", settled.json::<bool>().unwrap_or(false));
    let hash = env.view("get_settlement", lid(id)).await["inputs_hash"].clone();
    let page = json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 });
    a.step("settle_positions_page while halted", &env.call(&outsider, "settle_positions_page", page, ZERO).await);
    a.step("sweep_residue while halted", &env.call(&outsider, "sweep_residue", lid(id), ZERO).await);
    for m in ["pay_launch_fee", "consolidate"] {
        a.attack(&format!("{m} by the creator while halted"), &env.call(&env.creator, m, lid(id), ZERO).await, "R_HALTED");
    }
    a.attack(
        "draw by the creator while halted",
        &env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": "1" }), ZERO).await,
        "R_HALTED",
    );
    env.register_on_token("C13", users[1].id()).await?;
    a.step("a holder's claim_tokens while halted", &env.call(&users[1], "claim_tokens", lid(id), ONE).await);
    a.check("the holder got tokens: token claims are exits and stay open", env.token_balance("C13", users[1].id()).await > 0);
    a.attack("resume_launch by the guardian", &env.call(&env.guardian, "resume_launch", lid(id), ZERO).await, "R_NOT_AUTHORIZED");
    a.check("a halt never changes a verdict", env.view("get_settlement", lid(id)).await["inputs_hash"] == hash);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- force_resolve_op: the only way to move a stuck leg, with no destination argument.

fn u128_at(v: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(v[o..o + 16].try_into().unwrap())
}

fn put_u128(v: &mut [u8], o: usize, x: u128) {
    v[o..o + 16].copy_from_slice(&x.to_le_bytes());
}

/// Offset of `Ledger.credited` inside a borsh `LaunchState` of a FAILED launch (same math as tests/force_resolve.rs).
fn ledger_offset(v: &[u8]) -> usize {
    let mut o = 32;
    o += if v[o] == 4 { 2 } else { 1 };
    o += 2;
    o += if v[o] == 1 { 1 + 4 + u32::from_le_bytes(v[o + 1..o + 5].try_into().unwrap()) as usize } else { 1 };
    o + 16 + 4 * 4 + 1 + 16 + 1 + 32
}

/// Two buyers fail the soft cap; the first buyer's 30 USDC refund is turned into an in-flight leg (state patch).
async fn stuck_leg(env: &Env, symbol: &str) -> anyhow::Result<(u64, Vec<Account>)> {
    let moved = 30 * USDC;
    let id = env.create_launch(&params(symbol)).await?;
    let mut users = Vec::new();
    for i in 0..2 {
        let u = env.user(&format!("f{i}"), 1_000 * USDC).await?;
        assert!(env.commit_native(&u, id, moved, None).await.is_success());
        users.push(u);
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    let state = env.worker.view_state(env.core.id()).await?;
    let mut pkey = vec![2u8];
    pkey.extend_from_slice(&id.to_le_bytes());
    pkey.push(0);
    let name = users[0].id().as_str();
    pkey.extend_from_slice(&(name.len() as u32).to_le_bytes());
    pkey.extend_from_slice(name.as_bytes());
    let mut pos = state.get(&pkey).expect("position record").clone();
    let o = 4 + 1 + 4 + name.len() + 1 + 16 * 3;
    assert_eq!(u128_at(&pos, o), moved, "due_native is where the offset math says");
    put_u128(&mut pos, o, 0);
    put_u128(&mut pos, o + 32, moved);
    env.worker.patch_state(env.core.id(), &pkey, &pos).await?;
    let mut skey = vec![1u8];
    skey.extend_from_slice(&id.to_le_bytes());
    let mut st = state.get(&skey).expect("launch state").clone();
    let l = ledger_offset(&st);
    assert_eq!(u128_at(&st, l + 3 * 16), 2 * moved, "ledger.due_native");
    put_u128(&mut st, l + 3 * 16, moved);
    put_u128(&mut st, l + 5 * 16, moved);
    env.worker.patch_state(env.core.id(), &skey, &st).await?;
    Ok((id, users))
}

fn force_args(id: u64, kind: &str, holder: Option<String>, amount: u128, ok: bool) -> Value {
    json!({ "launch_id": id.to_string(), "kind": kind, "holder": holder, "amount": amount.to_string(), "ok": ok, "evidence": "receipt 4xYz: ft_transfer failed" })
}

#[tokio::test]
async fn c14_force_resolve_op_cannot_redirect_inflate_or_be_called_by_others() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = stuck_leg(&env, "C14").await?;
    let moved = 30 * USDC;
    let eve = stranger(&env, "eve").await?;
    let victim = key_of(&users[0]);
    let mut a = Attack::new("C14", "", "force_resolve_op: a non-owner, a destination of the attacker's choice, an amount above what is in flight, a bucket with nothing in flight", "core", Expect::Refused, "R_NOT_AUTHORIZED")
        .attempt("One holder's refund is stuck in flight. The guardian, the creator and a stranger call force_resolve_op; a compromised owner then names the attacker as the holder, asks for more than is in flight, for every other kind of leg, for zero and for a launch that does not exist. None of these may queue anything or move money.");
    let legit = force_args(id, "RefundNative", Some(victim.clone()), moved, false);
    for (who, label) in [(&env.guardian, "guardian"), (&env.creator, "creator"), (&eve, "stranger")] {
        a.attack(
            &format!("force_resolve_op by the {label}"),
            &env.call(who, "force_resolve_op", legit.clone(), ZERO).await,
            "R_NOT_AUTHORIZED",
        );
    }
    let owner_try = |kind: &str, holder: Option<String>, amount: u128| force_args(id, kind, holder, amount, true);
    let cases: Vec<(&str, Value, &str)> = vec![
        ("RefundNative naming the attacker as the holder", owner_try("RefundNative", Some(key_of(&eve)), moved), "R_NOTHING"),
        (
            "RefundNative for the victim, double the in-flight amount",
            owner_try("RefundNative", Some(victim.clone()), 2 * moved),
            "R_NOTHING",
        ),
        ("RefundNative for the victim, zero", owner_try("RefundNative", Some(victim.clone()), 0), "R_NOTHING"),
        ("RefundIntents for the victim (nothing in flight there)", owner_try("RefundIntents", Some(victim.clone()), moved), "R_NOTHING"),
        ("LaunchFee with the attacker as the holder", owner_try("LaunchFee", Some(key_of(&eve)), moved), "R_NOTHING"),
        ("Stream", owner_try("Stream", None, moved), "R_NOTHING"),
        ("Consolidate", owner_try("Consolidate", None, moved), "R_NOTHING"),
        ("Claim (token legs cannot be resolved from here)", owner_try("Claim", Some(victim.clone()), moved), "R_NOTHING"),
        ("a launch that does not exist", force_args(99, "RefundNative", Some(victim.clone()), moved, true), "R_NO_LAUNCH"),
    ];
    for (label, args, code) in cases {
        a.attack(label, &env.call(&env.owner, "force_resolve_op", args, ZERO).await, code);
    }
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": victim })).await;
    a.check("the victim's leg is still in flight, untouched", pos["inflight"] == moved.to_string() && num_of(&pos, "refunded") == 0);
    a.check(
        "nobody was paid: attacker, owner and creator hold no USDC",
        env.usdc_balance(eve.id()).await == 0 && env.usdc_balance(env.owner.id()).await == 0,
    );
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c15_claim_refund_batch_size_input_and_frozen_refusals() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "C15").await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("C15", "", "claim_refund_batch: oversize and empty batches, a malformed holder, an unknown launch, and a batch while FROZEN", "core", Expect::Refused, "R_BATCH_SIZE")
        .attempt("A stranger sends a 26 holder batch, an empty batch, a holder that is not near:<account> or sol:<key>, a batch for a launch that does not exist, and (after a guardian freeze) a valid batch.");
    let batch = |holders: Vec<String>| json!({ "launch_id": id.to_string(), "holders": holders });
    let too_many: Vec<String> = (0..26).map(|i| format!("near:nobody{i}.test.near")).collect();
    a.attack("26 holders", &env.call(&eve, "claim_refund_batch", batch(too_many), ZERO).await, "R_BATCH_SIZE");
    a.attack("0 holders", &env.call(&eve, "claim_refund_batch", batch(vec![]), ZERO).await, "R_BATCH_SIZE");
    a.attack(
        "a holder that is not near:<account> or sol:<key>",
        &env.call(&eve, "claim_refund_batch", batch(vec!["eve".into()]), ZERO).await,
        "R_NO_POSITION",
    );
    let unknown = json!({ "launch_id": "99", "holders": [key_of(&users[0])] });
    a.attack("a launch that does not exist", &env.call(&eve, "claim_refund_batch", unknown, ZERO).await, "R_NO_LAUNCH");
    a.step("guardian freeze", &env.call(&env.guardian, "freeze", json!({}), ZERO).await);
    a.attack("a valid batch while FROZEN", &env.call(&eve, "claim_refund_batch", batch(vec![key_of(&users[0])]), ZERO).await, "R_FROZEN");
    a.check(
        "nobody was paid by any refused batch",
        env.view("get_ledger", lid(id)).await["refunded"] == "0" && env.usdc_balance(eve.id()).await == 0,
    );
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c16_claim_refund_batch_duplicates_and_repeats_pay_each_holder_once_to_the_holder() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "C16").await?;
    let eve = stranger(&env, "eve").await?;
    let mut a = Attack::new("C16", "", "claim_refund_batch: duplicate holders, repeated batches, and the batch caller's own account in the list", "core", Expect::NoEffect, "")
        .attempt("A stranger sends batches that name two holders several times each, repeats the batch four times, and adds their own account. Each named holder may be paid once, to their own account; the stranger gains nothing.");
    // One call handles about two holders (120 Tgas each of the 300 attached), so the two named holders come first.
    let list = vec![key_of(&users[0]), key_of(&users[1]), key_of(&users[0]), key_of(&users[1]), key_of(&users[0]), key_of(&eve)];
    for i in 0..4 {
        let r = env.call(&eve, "claim_refund_batch", json!({ "launch_id": id.to_string(), "holders": list }), ZERO).await;
        a.attack(&format!("batch #{i} with duplicates"), &r, "");
    }
    a.check(
        "each named holder was refunded exactly once, to their own account",
        env.usdc_balance(users[0].id()).await == 1_000 * USDC && env.usdc_balance(users[1].id()).await == 1_000 * USDC,
    );
    a.check("the stranger gained nothing", env.usdc_balance(eve.id()).await == 0);
    a.check(
        "the ledger paid two refunds of 30 USDC, not more",
        env.view("get_ledger", lid(id)).await["refunded"] == (60 * USDC).to_string(),
    );
    a.check("the holders who were not named still hold their claim", env.usdc_balance(users[2].id()).await == 970 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c17_set_refund_route_for_another_account_a_paid_holder_or_while_frozen() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (id, users) = failed_launch(&env, "C17").await?;
    let eve = stranger(&env, "eve").await?;
    let route = |to: &Account| json!({ "launch_id": id.to_string(), "intents_account": to.id() });
    let mut a = Attack::new("C17", "", "set_refund_route: route a victim's refund to the attacker, route twice, route while FROZEN", "core", Expect::Refused, "R_NO_POSITION")
        .attempt("There is no argument that names another holder: the route always spends the caller's own position. A stranger with no position names themselves as the destination; a holder who was already refunded tries again; and after a freeze a holder with a refund due tries to route it.");
    a.attack("a stranger routes (no position of their own)", &env.call(&eve, "set_refund_route", route(&eve), ZERO).await, "R_NO_POSITION");
    a.step(
        "holder 1 claims the normal refund",
        &env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await,
    );
    a.attack(
        "holder 1 routes after being paid (position deleted)",
        &env.call(&users[1], "set_refund_route", route(&users[1]), ZERO).await,
        "R_NO_POSITION",
    );
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": key_of(&users[0]) })).await;
    a.check(
        "the victim's refund is untouched by the stranger's attempt",
        num_of(&pos, "due_native") + num_of(&pos, "open_native") == 30 * USDC,
    );
    a.step("guardian freeze", &env.call(&env.guardian, "freeze", json!({}), ZERO).await);
    a.attack("holder 0 routes while FROZEN", &env.call(&users[0], "set_refund_route", route(&users[0]), ZERO).await, "R_FROZEN");
    a.check("the attacker received nothing", env.usdc_balance(eve.id()).await == 0);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

#[tokio::test]
async fn c18_lengthen_stream_cannot_speed_the_stream_up_and_only_the_creator_may_touch_it() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let payee = stranger(&env, "payee").await?;
    let eve = stranger(&env, "eve").await?;
    let other = env.user("creator2", 0).await?;
    let open_id = env.create_launch_as(&other, &params("C18B")).await?;
    let id = env.create_launch_to(&env.creator, &params("C18"), Some(payee.id())).await?;
    buyers(&env, id, 12, 40 * USDC).await?;
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let lengthen = |id: u64, days: u32| json!({ "launch_id": id.to_string(), "new_duration_days": days });
    let total = num_of(&env.view("get_ledger", lid(id)).await, "stream_total");
    let mut a = Attack::new("C18", "", "lengthen_stream used to speed the stream up: a shorter or equal duration, a non-creator, beyond 365 days, before PASS", "core", Expect::Refused, "R_LENGTHEN_ONLY")
        .attempt("The stream can only be made slower. The creator asks for a shorter and for the same duration; the payee, a stranger and a second creator try to change the schedule; 366 days is asked for; the second creator lengthens a launch that has no stream yet; then the payee draws the whole stream.");
    a.attack(
        "creator asks for 10 days (shorter than 30)",
        &env.call(&env.creator, "lengthen_stream", lengthen(id, 10), ZERO).await,
        "R_LENGTHEN_ONLY",
    );
    a.attack(
        "creator asks for the same 30 days",
        &env.call(&env.creator, "lengthen_stream", lengthen(id, 30), ZERO).await,
        "R_LENGTHEN_ONLY",
    );
    a.attack("payee lengthens", &env.call(&payee, "lengthen_stream", lengthen(id, 90), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack("stranger lengthens", &env.call(&eve, "lengthen_stream", lengthen(id, 90), ZERO).await, "R_NOT_AUTHORIZED");
    a.attack(
        "another creator lengthens this stream",
        &env.call(&other, "lengthen_stream", lengthen(id, 90), ZERO).await,
        "R_NOT_AUTHORIZED",
    );
    a.attack("366 days", &env.call(&env.creator, "lengthen_stream", lengthen(id, 366), ZERO).await, "R_STREAM");
    a.attack(
        "lengthen a launch with no stream yet",
        &env.call(&other, "lengthen_stream", lengthen(open_id, 90), ZERO).await,
        "R_WRONG_PHASE",
    );
    let draw_all = payee
        .call(env.core.id(), "draw")
        .args_json(json!({ "launch_id": id.to_string(), "amount": total.to_string() }))
        .gas(GAS)
        .transact()
        .await?;
    a.attack("payee draws the whole stream after the refused lengthenings", &draw_all, "STREAM_CAP");
    let s = env.view("stream_status", lid(id)).await;
    let settled_at = num_of(&env.view("get_settlement", lid(id)).await, "settled_at");
    let now = u128::from(env.worker.view_block().await?.timestamp());
    a.check(
        "the cap is still the original 30 day line (never above it)",
        num_of(&s, "cap") <= total * (now - settled_at) / u128::from(30 * kruxa_logic::DAY_NS) + 1,
    );
    a.check("the stream total did not move", num_of(&env.view("get_ledger", lid(id)).await, "stream_total") == total);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}

// ---- claim_orphan_credit

fn orphan_signed(env: &Env, h: &SolHolder, id: u64, amount: u128, nonce_seed: u8, receiver: &str) -> Value {
    use base64::Engine as _;
    let memo = format!("kruxa:v1:t={};d={};fee=0", id, h.key());
    let intent = json!({ "intent": "transfer", "receiver_id": receiver, "tokens": { format!("nep141:{}", env.usdc.id()): amount.to_string() }, "memo": memo });
    let nonce = base64::engine::general_purpose::STANDARD.encode([nonce_seed; 32]);
    let payload = json!({ "signer_id": h.hex, "verifying_contract": env.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": nonce, "intents": [intent] }).to_string();
    json!({ "standard": "raw_ed25519", "payload": payload, "public_key": format!("ed25519:{}", h.b58), "signature": format!("ed25519:{}", h.sign(&payload)) })
}

#[tokio::test]
async fn c19_claim_orphan_credit_with_a_replayed_nonce_or_a_second_claim() -> anyhow::Result<()> {
    let env = Env::new_real_intents().await?;
    let id = env.create_launch(&params("C19")).await?;
    let h = sol_holder(71);
    env.deposit_real_intents(&h.hex, 500 * USDC).await?;
    let core = env.core.id().to_string();
    let keeper = stranger(&env, "keeper").await?;
    let claim = |s: &Value| {
        let (c, k, s) = (env.core.id().clone(), keeper.clone(), s.clone());
        async move { k.call(&c, "claim_orphan_credit").args_json(json!({ "signed": s })).gas(GAS).transact().await.unwrap() }
    };
    let mut a = Attack::new("C19", "", "claim_orphan_credit: the same payload twice, the S4 path after the claim, and a payload that reuses a spent nonce", "core", Expect::Refused, "R_NOTHING")
        .attempt("A payload executed by someone else at the Verifier is credited once through claim_orphan_credit. The same claim is then replayed, the plain S4 path is tried on it, and a second payload (30 USDC) signed with the same nonce, which the Verifier never executed, is claimed to credit money that never arrived.");
    let first = orphan_signed(&env, &h, id, 40 * USDC, 1, &core);
    let exec = env.worker_call(&env.owner, env.intents.id(), "execute_intents", json!({ "signed": [first] })).await;
    a.step("somebody executes the payload at the Verifier (an orphan)", &exec);
    a.step("claim_orphan_credit (legitimate, credits the signer once)", &claim(&first).await);
    let ledger = env.view("get_ledger", lid(id)).await["open_intents"].clone();
    a.check("credited exactly 40 USDC", ledger == (40 * USDC).to_string());
    a.attack("the same claim again", &claim(&first).await, "R_NOTHING");
    let s4 = env.call(&env.owner, "contribute_via_intents", json!({ "signed": first }), ZERO).await;
    a.attack("the S4 path on the already-credited payload", &s4, "R_NOTHING");
    let replay = orphan_signed(&env, &h, id, 30 * USDC, 1, &core);
    let r = claim(&replay).await;
    a.attack("a different payload (30 USDC) reusing the spent nonce", &r, "");
    a.check(
        "core refused it in the callback: the Verifier's nonce was already spent",
        r.logs().iter().any(|l| l.contains("orphan_credit_refused")),
    );
    a.check("the ledger still shows only the real 40 USDC", env.view("get_ledger", lid(id)).await["open_intents"] == ledger);
    a.check("core's Intents balance is the 40 USDC that really arrived", env.intents_balance(&core).await == 40 * USDC);
    let (inv, ok) = core_inv(&env).await;
    a.finish(inv, ok);
    Ok(())
}
