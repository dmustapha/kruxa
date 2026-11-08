//! Sandbox harness: deploys core + mock USDC + mock intents + mock factory, and wraps the calls the tests repeat.
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use kruxa_logic::{hex, TrialParams};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const GAS: Gas = Gas::from_tgas(300);

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{}/{}.wasm", env!("CARGO_MANIFEST_DIR"), name, name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: run scripts/build.sh first"))
}

async fn funded(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(200)).transact().await?.into_result()?)
}

async fn deploy_at(root: &Account, name: &str, code: Vec<u8>) -> anyhow::Result<Contract> {
    let a = root.create_subaccount(name).initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    Ok(a.deploy(&code).await?.into_result()?)
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub core: Contract,
    pub usdc: Contract,
    pub intents: Contract,
    pub factory: Contract,
    pub owner: Account,
    pub guardian: Account,
    pub creator: Account,
    pub treasury: Account,
    pub relay_fees: Account,
    pub next_id: std::cell::Cell<u64>,
    /// Last status seen per launch, so `assert_invariants` can check the stage only ever moves forward (I4).
    pub last_status: std::cell::RefCell<std::collections::HashMap<u64, String>>,
    /// Every NEP-297 `EVENT_JSON:` payload the harness has seen, in order (feeds `book_log`).
    pub events: std::cell::RefCell<Vec<Value>>,
}

/// The only legal stage moves (I4). `Failed(n)` carries its reason bits, which never change once set.
pub fn legal_transition(prev: &str, now: &str) -> bool {
    let kind = |s: &str| s.split('(').next().unwrap_or("").to_string();
    prev == now
        || matches!(
            (kind(prev).as_str(), kind(now).as_str()),
            ("Creating", "CreationFailed" | "Open") | ("Open", "Passed" | "Failed") | ("Failed", "Dissolved")
        )
}

/// True if any log of the execution carries the rule code (events and panics both start with it).
pub fn has_code(res: &ExecutionFinalResult, code: &str) -> bool {
    res.logs().iter().any(|l| l.contains(code)) || format!("{:?}", res.failures()).contains(code)
}

pub fn msg(launch_id: u64, deliver: Option<&str>, relay_fee: Option<u128>) -> String {
    let mut m = json!({ "v": 1, "op": "contribute", "launch_id": launch_id.to_string() });
    if let Some(d) = deliver {
        m["deliver"] = json!(d);
    }
    if let Some(f) = relay_fee {
        m["relay_fee"] = json!(f.to_string());
    }
    m.to_string()
}

/// A Solana-style holder: ed25519 key, its 64-hex Intents account, and its base58 form.
pub struct SolHolder {
    pub sk: SigningKey,
    pub hex: String,
    pub b58: String,
}

pub fn sol_holder(seed: u8) -> SolHolder {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key().to_bytes();
    SolHolder { hex: hex(&pk), b58: bs58::encode(pk).into_string(), sk }
}

impl SolHolder {
    pub fn key(&self) -> String {
        format!("sol:{}", self.b58)
    }
    pub fn sign(&self, message: &str) -> String {
        bs58::encode(self.sk.sign(message.as_bytes()).to_bytes()).into_string()
    }
}

impl Env {
    pub async fn new() -> anyhow::Result<Env> {
        Self::new_with_profile("demo").await
    }

    /// Same stack with another core profile ("demo" = demo clock, "testnet" and "mainnet" = ladder rules; only "mainnet" starts with the creator gate closed).
    pub async fn new_with_profile(profile: &str) -> anyhow::Result<Env> {
        Self::build(profile, false).await
    }

    /// W1-DC-8: the same stack, but the Verifier is the REAL `intents.near` wasm (`scripts/fetch-intents-wasm.sh` puts it in fixtures/).
    pub async fn new_real_intents() -> anyhow::Result<Env> {
        Self::build("demo", true).await
    }

    async fn build(profile: &str, real_intents: bool) -> anyhow::Result<Env> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let owner = funded(&root, "owner").await?;
        let guardian = funded(&root, "guardian").await?;
        let creator = funded(&root, "creator").await?;
        let treasury = funded(&root, "treasury").await?;
        let relay_fees = funded(&root, "relayfees").await?;
        let usdc = deploy_at(&root, "usdc", wasm("mock_ft")).await?;
        usdc.call("new").args_json(json!({ "owner_id": owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
        let intents = if real_intents {
            let code = std::fs::read(format!("{}/../fixtures/intents_near.wasm", env!("CARGO_MANIFEST_DIR")))
                .expect("fixtures/intents_near.wasm missing: run scripts/fetch-intents-wasm.sh");
            let c = deploy_at(&root, "intents", code).await?;
            let cfg = json!({ "wnear_id": "wrap.test.near", "fees": { "fee": 0, "fee_collector": owner.id() }, "roles": { "super_admins": [owner.id()], "grantees": { "PauseManager": [owner.id()] } } });
            c.call("new").args_json(json!({ "config": cfg })).transact().await?.into_result()?;
            c
        } else {
            let c = deploy_at(&root, "intents", wasm("mock_intents")).await?;
            c.call("new").transact().await?.into_result()?;
            c
        };
        let factory = deploy_at(&root, "factory", wasm("mock_factory")).await?;
        factory.call("new").transact().await?.into_result()?;
        let core = deploy_at(&root, "core", wasm("kruxa_core")).await?;
        core.call("new")
            .args_json(json!({ "owner": owner.id(), "guardian": guardian.id(), "treasury": treasury.id(), "relay_fees": relay_fees.id(), "usdc": usdc.id(), "intents": intents.id(), "factory": factory.id(), "profile": profile }))
            .transact()
            .await?
            .into_result()?;
        let env = Env {
            worker,
            core,
            usdc,
            intents,
            factory,
            owner,
            guardian,
            creator,
            treasury,
            relay_fees,
            next_id: std::cell::Cell::new(1),
            last_status: Default::default(),
            events: Default::default(),
        };
        for who in [env.core.id().clone(), env.intents.id().clone(), env.treasury.id().clone(), env.creator.id().clone()] {
            env.register(&env.usdc, &who).await?;
        }
        Ok(env)
    }

    pub async fn register(&self, token: &Contract, who: &AccountId) -> anyhow::Result<()> {
        self.owner
            .call(token.id(), "storage_deposit")
            .args_json(json!({ "account_id": who }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn user(&self, name: &str, usdc: u128) -> anyhow::Result<Account> {
        let a = self
            .worker
            .root_account()?
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(20))
            .transact()
            .await?
            .into_result()?;
        self.register(&self.usdc, a.id()).await?;
        self.usdc.call("mint").args_json(json!({ "account_id": a.id(), "amount": usdc.to_string() })).transact().await?.into_result()?;
        Ok(a)
    }

    pub async fn usdc_balance(&self, who: &AccountId) -> u128 {
        let v: String = self.usdc.view("ft_balance_of").args_json(json!({ "account_id": who })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }

    pub async fn intents_balance(&self, who: &str) -> u128 {
        let v: String = self
            .intents
            .view("mt_balance_of")
            .args_json(json!({ "account_id": who, "token_id": format!("nep141:{}", self.usdc.id()) }))
            .await
            .unwrap()
            .json()
            .unwrap();
        v.parse().unwrap()
    }

    /// Gives `who` an Intents balance backed by real mock-USDC held by the intents contract.
    pub async fn fund_intents(&self, who: &str, amount: u128) -> anyhow::Result<()> {
        self.usdc
            .call("mint")
            .args_json(json!({ "account_id": self.intents.id(), "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        self.intents
            .call("mt_deposit")
            .args_json(json!({ "account_id": who, "token_id": format!("nep141:{}", self.usdc.id()), "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// Keeps the contract's events from a finished call so a test can replay them (P-RECOMPUTE).
    fn record(&self, r: &ExecutionFinalResult) {
        let mut seen = self.events.borrow_mut();
        for log in r.logs() {
            if let Some(json) = log.strip_prefix("EVENT_JSON:") {
                seen.extend(serde_json::from_str::<Value>(json));
            }
        }
    }

    /// The `contributed` and `walked` events of one launch, as the JSON lines `kruxa-sim fold` reads.
    pub fn book_log(&self, id: u64) -> Vec<String> {
        let want = id.to_string();
        let is_book = |e: &&Value| matches!(e["event"].as_str(), Some("contributed" | "walked")) && e["data"][0]["launch_id"] == want;
        self.events.borrow().iter().filter(is_book).map(Value::to_string).collect()
    }

    /// W1-DC-4: every `get_invariants` field of every launch created through this Env must be true, and the stage may only move
    /// Creating -> (CreationFailed | Open) -> (Passed | Failed) -> Dissolved. Called after every step the harness sends.
    pub async fn assert_invariants(&self) {
        for id in 1..self.next_id.get() {
            let inv = self.view("get_invariants", json!({ "launch_id": id.to_string() })).await;
            assert_eq!(inv["all_ok"], true, "launch {id}: invariants broken: {inv}");
            let now = self.state(id).await["status"].as_str().unwrap().to_string();
            let prev = self.last_status.borrow_mut().insert(id, now.clone());
            if let Some(prev) = prev {
                assert!(legal_transition(&prev, &now), "launch {id}: illegal stage move {prev} -> {now} (I4)");
            }
        }
    }

    /// Pre-deploys the token account the real factory would create, then calls create_trial. Returns the launch id.
    pub async fn create_launch(&self, p: &TrialParams) -> anyhow::Result<u64> {
        self.create_launch_as(&self.creator, p).await
    }

    /// Same as `create_launch`, for any creator account (one active trial per account, so a second launch needs a second creator).
    pub async fn create_launch_as(&self, creator: &Account, p: &TrialParams) -> anyhow::Result<u64> {
        self.create_launch_to(creator, p, None).await
    }

    /// Same, with an explicit payout recipient (`stream_recipient` in the Charter, named `payout_recipient` in the views).
    pub async fn create_launch_to(&self, creator: &Account, p: &TrialParams, recipient: Option<&AccountId>) -> anyhow::Result<u64> {
        let required: String = self.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
        let supply = (p.total_supply_whole as u128) * USDC;
        let token = self
            .factory
            .as_account()
            .create_subaccount(&p.symbol.to_lowercase())
            .initial_balance(NearToken::from_near(5))
            .transact()
            .await?
            .into_result()?;
        let token = token.deploy(&wasm("mock_ft")).await?.into_result()?;
        token
            .call("new")
            .args_json(json!({ "owner_id": self.core.id(), "total_supply": supply.to_string() }))
            .transact()
            .await?
            .into_result()?;
        let id = self.next_id.get();
        let res = creator
            .call(self.core.id(), "create_trial")
            .args_json(json!({ "params": p, "stream_recipient": recipient }))
            .deposit(NearToken::from_yoctonear(required.parse()?))
            .gas(GAS)
            .transact()
            .await?;
        self.record(&res);
        if std::env::var("KRUXA_DEBUG").is_ok() {
            eprintln!("create_trial logs: {:#?}\nfailures: {:#?}", res.logs(), res.failures());
        }
        res.into_result()?;
        self.next_id.set(id + 1);
        self.assert_invariants().await;
        Ok(id)
    }

    /// Deploys the stub market, registers it on USDC and calls `core.set_market` as the owner. Register it on each launch token separately.
    pub async fn deploy_stub_market(&self) -> anyhow::Result<Contract> {
        let market = deploy_at(&self.worker.root_account()?, "market", wasm("mock_market")).await?;
        market.call("new").transact().await?.into_result()?;
        self.register(&self.usdc, market.id()).await?;
        self.owner.call(self.core.id(), "set_market").args_json(json!({ "account": market.id() })).transact().await?.into_result()?;
        Ok(market)
    }

    /// Deploys the REAL market wasm (`scripts/market-build.sh`), registers it on USDC and names it on core.
    pub async fn deploy_real_market(&self) -> anyhow::Result<Contract> {
        let market = deploy_at(&self.worker.root_account()?, "market", wasm("kruxa_market_contract")).await?;
        let args = json!({ "owner": self.owner.id(), "guardian": self.guardian.id(), "treasury": self.treasury.id(), "usdc": self.usdc.id(), "core": self.core.id() });
        market.call("new").args_json(args).transact().await?.into_result()?;
        self.register(&self.usdc, market.id()).await?;
        self.owner.call(self.core.id(), "set_market").args_json(json!({ "account": market.id() })).transact().await?.into_result()?;
        Ok(market)
    }

    /// Real Verifier only: puts `amount` of mock USDC into `who`'s Intents account through the normal NEP-141 deposit (`msg` = the account).
    pub async fn deposit_real_intents(&self, who: &str, amount: u128) -> anyhow::Result<()> {
        self.usdc.call("mint").args_json(json!({ "account_id": self.owner.id(), "amount": amount.to_string() })).transact().await?.into_result()?;
        self.owner
            .call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.intents.id(), "amount": amount.to_string(), "msg": who }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// S3 with a REAL raw_ed25519 signature: the holder signs the payload string; anyone submits it to `execute_intents`.
    pub async fn s3_real(&self, h: &SolHolder, token: &AccountId, amount: u128, msg: Option<String>, nonce_seed: u8) -> ExecutionFinalResult {
        let mut intent = json!({ "intent": "transfer", "receiver_id": self.core.id(), "tokens": { format!("nep141:{}", token): amount.to_string() } });
        if let Some(m) = msg {
            intent["msg"] = json!(m);
            intent["min_gas"] = json!("50000000000000");
        }
        let nonce = base64::engine::general_purpose::STANDARD.encode([nonce_seed; 32]);
        let payload = json!({ "signer_id": h.hex, "verifying_contract": self.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": nonce, "intents": [intent] }).to_string();
        let signed = json!({ "standard": "raw_ed25519", "payload": payload, "public_key": format!("ed25519:{}", h.b58), "signature": format!("ed25519:{}", h.sign(&payload)) });
        self.worker_call(&self.owner, self.intents.id(), "execute_intents", json!({ "signed": [signed] })).await
    }

    pub fn token_id(&self, symbol: &str) -> AccountId {
        format!("{}.{}", symbol.to_lowercase(), self.factory.id()).parse().unwrap()
    }

    pub async fn token_balance(&self, symbol: &str, who: &AccountId) -> u128 {
        let v: String = self
            .worker
            .view(&self.token_id(symbol), "ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await
            .unwrap()
            .json()
            .unwrap();
        v.parse().unwrap()
    }

    pub async fn register_on_token(&self, symbol: &str, who: &AccountId) -> anyhow::Result<()> {
        self.owner
            .call(&self.token_id(symbol), "storage_deposit")
            .args_json(json!({ "account_id": who }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn view(&self, method: &str, args: Value) -> Value {
        self.core.view(method).args_json(args).await.unwrap().json().unwrap()
    }

    pub async fn state(&self, id: u64) -> Value {
        self.view("get_state", json!({ "launch_id": id.to_string() })).await
    }

    /// Fast-forwards the sandbox until the launch reaches `phase` (Open | Closing | Ready).
    pub async fn advance_to(&self, id: u64, phase: &str) {
        for _ in 0..400 {
            if self.state(id).await["phase"] == phase {
                return;
            }
            self.worker.fast_forward(100).await.unwrap();
        }
        panic!("launch {id} never reached {phase}");
    }

    /// Sends USDC to core with a commit message (native path).
    pub async fn commit_native(&self, who: &Account, id: u64, amount: u128, deliver: Option<&str>) -> ExecutionFinalResult {
        let r = who
            .call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.core.id(), "amount": amount.to_string(), "msg": msg(id, deliver, None) }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await
            .unwrap();
        self.record(&r);
        self.assert_invariants().await;
        r
    }

    /// S3 path through the mock Verifier: a signed-transfer-shaped payload with the flat `msg` key.
    pub async fn commit_s3(&self, holder: &SolHolder, id: u64, amount: u128, relay_fee: u128) -> ExecutionFinalResult {
        self.s3_payload(&holder.hex, id, amount, Some(msg(id, Some(&holder.key()), Some(relay_fee)))).await
    }

    pub async fn s3_payload(&self, signer: &str, _id: u64, amount: u128, msg: Option<String>) -> ExecutionFinalResult {
        let mut intent = json!({ "intent": "transfer", "receiver_id": self.core.id(), "tokens": { format!("nep141:{}", self.usdc.id()): amount.to_string() } });
        if let Some(m) = msg {
            intent["msg"] = json!(m);
            intent["min_gas"] = json!("50000000000000");
        }
        let payload = json!({ "signer_id": signer, "verifying_contract": self.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": "AAAA", "intents": [intent] });
        let signed = json!({ "standard": "raw_ed25519", "payload": payload.to_string(), "public_key": "ed25519:11111111111111111111111111111111", "signature": "ed25519:1" });
        self.worker_call(&self.owner, self.intents.id(), "execute_intents", json!({ "signed": [signed] })).await
    }

    /// S4: the buyer signs a transfer WITHOUT msg; anyone forwards it through contribute_via_intents.
    pub fn s4_signed(&self, h: &SolHolder, id: u64, amount: u128, fee: u128) -> Value {
        let intent = json!({ "intent": "transfer", "receiver_id": self.core.id(), "tokens": { format!("nep141:{}", self.usdc.id()): amount.to_string() },
                             "memo": format!("kruxa:v1:t={};d={};fee={}", id, h.key(), fee) });
        let payload = json!({ "signer_id": h.hex, "verifying_contract": self.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": "AAAA", "intents": [intent] });
        json!({ "standard": "raw_ed25519", "payload": payload.to_string(), "public_key": format!("ed25519:{}", h.b58), "signature": "ed25519:1" })
    }

    pub async fn worker_call(&self, who: &Account, to: &AccountId, method: &str, args: Value) -> ExecutionFinalResult {
        let r = who.call(to, method).args_json(args).gas(GAS).transact().await.unwrap();
        self.record(&r);
        self.assert_invariants().await;
        r
    }

    pub async fn call(&self, who: &Account, method: &str, args: Value, deposit: NearToken) -> ExecutionFinalResult {
        let r = who.call(self.core.id(), method).args_json(args).deposit(deposit).gas(GAS).transact().await.unwrap();
        self.record(&r);
        self.assert_invariants().await;
        r
    }
}
