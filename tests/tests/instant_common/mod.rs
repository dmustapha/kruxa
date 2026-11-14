//! Sandbox harness for the instant launcher suites: mock USDC, mock factory, the launcher, and a market (the stub for
//! failure modes, the real market wasm for the end-to-end flow). Every launch token is pre-deployed at the account the real
//! factory would create, with the whole supply held by the launcher.
#![allow(dead_code)]
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const GAS: Gas = Gas::from_tgas(300);
pub const N_TOTAL: u128 = 1_000_000_000_000_000;
pub const ID0: u64 = 1_000_000_000;

pub fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{}/{}.wasm", env!("CARGO_MANIFEST_DIR"), name, name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: run scripts/instant-build.sh first"))
}

pub fn has_code(res: &ExecutionFinalResult, code: &str) -> bool {
    res.logs().iter().any(|l| l.contains(code)) || format!("{:?}", res.failures()).contains(code)
}

pub fn events(res: &ExecutionFinalResult, name: &str) -> Vec<Value> {
    res.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["event"] == name && e["standard"] == "kruxa" && e["version"] == "1.0.0")
        .map(|e| e["data"][0].clone())
        .collect()
}

pub fn n(v: &Value) -> u128 {
    v.as_str().unwrap_or_else(|| panic!("not a string: {v}")).parse().unwrap()
}

pub fn lid(id: &str) -> Value {
    json!({ "launch_id": id })
}

/// Default test params: trading opens with the pool (`trade_delay_secs` 0), as before the announced open existed. The delay
/// suites (`instant_announced_open.rs`) build their own.
pub fn params(symbol: &str) -> Value {
    json!({ "name": format!("{symbol} Coin"), "symbol": symbol, "trade_delay_secs": 0 })
}

pub struct Ix {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub factory: Contract,
    pub launcher: Contract,
    pub market: Contract,
    pub owner: Account,
    pub guardian: Account,
    pub treasury: Account,
    pub creator: Account,
}

async fn sub(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(100)).transact().await?.into_result()?)
}

async fn deploy(root: &Account, name: &str, code: Vec<u8>) -> anyhow::Result<Contract> {
    Ok(sub(root, name).await?.deploy(&code).await?.into_result()?)
}

impl Ix {
    /// `profile`: demo (short clock, open gate, no fee), testnet, mainnet (closed gate, $10 fee). `stub`: use the stub market,
    /// else the real market wasm with the launcher already named.
    pub async fn new(profile: &str, stub: bool) -> anyhow::Result<Ix> {
        Self::build(profile, stub, None, true).await
    }

    /// Real market with explicit caps (per pool, global, instant sub-cap, micro-USDC) and optionally no `set_launcher` yet.
    pub async fn real(profile: &str, caps: Option<(u128, u128, u128)>, set_launcher: bool) -> anyhow::Result<Ix> {
        Self::build(profile, false, caps, set_launcher).await
    }

    /// Like `new` but the launcher has no market yet (the test names it, or not).
    pub async fn without_market(profile: &str, stub: bool) -> anyhow::Result<Ix> {
        Self::build_with(profile, stub, None, true, false).await
    }

    async fn build(profile: &str, stub: bool, caps: Option<(u128, u128, u128)>, set_launcher: bool) -> anyhow::Result<Ix> {
        Self::build_with(profile, stub, caps, set_launcher, true).await
    }

    async fn build_with(
        profile: &str,
        stub: bool,
        caps: Option<(u128, u128, u128)>,
        set_launcher: bool,
        name_market: bool,
    ) -> anyhow::Result<Ix> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let (owner, guardian, treasury, creator) =
            (sub(&root, "owner").await?, sub(&root, "guardian").await?, sub(&root, "treasury").await?, sub(&root, "creator").await?);
        let usdc = deploy(&root, "usdc", wasm("mock_ft")).await?;
        usdc.call("new").args_json(json!({ "owner_id": owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
        let factory = deploy(&root, "factory", wasm("mock_factory")).await?;
        factory.call("new").transact().await?.into_result()?;
        let launcher = deploy(&root, "instant", wasm("kruxa_instant_contract")).await?;
        let args = json!({ "owner": owner.id(), "guardian": guardian.id(), "treasury": treasury.id(), "usdc": usdc.id(), "factory": factory.id(), "profile": profile });
        launcher.call("new").args_json(args).transact().await?.into_result()?;
        let market = if stub {
            let m = deploy(&root, "market", wasm("mock_market")).await?;
            m.call("new").transact().await?.into_result()?;
            m
        } else {
            let m = deploy(&root, "market", wasm("kruxa_market_contract")).await?;
            let (pq, gq, iq) = caps.map_or((None, None, None), |(p, g, i)| (Some(p.to_string()), Some(g.to_string()), Some(i.to_string())));
            let a = json!({ "owner": owner.id(), "guardian": guardian.id(), "treasury": treasury.id(), "usdc": usdc.id(), "core": owner.id(),
                            "max_pool_reserve_q": pq, "max_global_reserve_q": gq, "max_instant_reserve_q": iq });
            m.call("new").args_json(a).transact().await?.into_result()?;
            if set_launcher {
                owner.call(m.id(), "set_launcher").args_json(json!({ "account": launcher.id() })).transact().await?.into_result()?;
            }
            m
        };
        let ix = Ix { worker, usdc, factory, launcher, market, owner, guardian, treasury, creator };
        for who in [ix.launcher.id(), ix.market.id(), ix.treasury.id(), ix.creator.id()] {
            ix.register(&ix.usdc, who).await?;
        }
        if name_market {
            ix.owner
                .call(ix.launcher.id(), "set_market")
                .args_json(json!({ "account": ix.market.id() }))
                .transact()
                .await?
                .into_result()?;
        }
        Ok(ix)
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

    /// A funded account, registered on USDC with `usdc` micro-USDC.
    pub async fn user(&self, name: &str, usdc: u128) -> anyhow::Result<Account> {
        let a = sub(&self.worker.root_account()?, name).await?;
        self.register(&self.usdc, a.id()).await?;
        self.mint_usdc(a.id(), usdc).await?;
        Ok(a)
    }

    pub async fn mint_usdc(&self, who: &AccountId, amount: u128) -> anyhow::Result<()> {
        self.usdc.call("mint").args_json(json!({ "account_id": who, "amount": amount.to_string() })).transact().await?.into_result()?;
        Ok(())
    }

    pub fn token_id(&self, symbol: &str) -> AccountId {
        format!("{}.{}", symbol.to_lowercase(), self.factory.id()).parse().unwrap()
    }

    pub async fn bal(&self, ft: &AccountId, who: &AccountId) -> u128 {
        let v: String = self.worker.view(ft, "ft_balance_of").args_json(json!({ "account_id": who })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }

    pub async fn usdc_bal(&self, who: &AccountId) -> u128 {
        self.bal(self.usdc.id(), who).await
    }

    /// Pre-deploys the launch token the real factory would create, holding `supply` at the launcher.
    pub async fn predeploy_token(&self, symbol: &str, supply: u128) -> anyhow::Result<Contract> {
        let a = self
            .factory
            .as_account()
            .create_subaccount(&symbol.to_lowercase())
            .initial_balance(NearToken::from_near(5))
            .transact()
            .await?
            .into_result()?;
        let t = a.deploy(&wasm("mock_ft")).await?.into_result()?;
        t.call("new")
            .args_json(json!({ "owner_id": self.launcher.id(), "total_supply": supply.to_string() }))
            .transact()
            .await?
            .into_result()?;
        Ok(t)
    }

    pub async fn register_on_token(&self, token: &AccountId, who: &AccountId) -> anyhow::Result<()> {
        self.owner
            .call(token, "storage_deposit")
            .args_json(json!({ "account_id": who }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn required_deposit(&self) -> u128 {
        let v: String = self.launcher.view("required_deposit").await.unwrap().json().unwrap();
        v.parse().unwrap()
    }

    /// Raw `create_instant` with the exact required deposit.
    pub async fn create_raw(&self, who: &Account, p: Value, recipient: Option<&AccountId>) -> anyhow::Result<ExecutionFinalResult> {
        let dep = self.required_deposit().await;
        self.create_with_deposit(who, p, recipient, dep).await
    }

    pub async fn create_with_deposit(
        &self,
        who: &Account,
        p: Value,
        recipient: Option<&AccountId>,
        dep: u128,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.launcher.id(), "create_instant")
            .args_json(json!({ "params": p, "payout_recipient": recipient }))
            .deposit(NearToken::from_yoctonear(dep))
            .gas(GAS)
            .transact()
            .await?)
    }

    /// Pre-deploys the token, creates the launch as `who` and returns its id. Asserts `TokenReady`.
    pub async fn create_ready(&self, who: &Account, p: Value, recipient: Option<&AccountId>) -> anyhow::Result<String> {
        let symbol = p["symbol"].as_str().unwrap().to_string();
        self.predeploy_token(&symbol, N_TOTAL).await?;
        let res = self.create_raw(who, p, recipient).await?;
        let id = events(&res, "instant_created")
            .first()
            .map(|e| e["launch_id"].as_str().unwrap().to_string())
            .unwrap_or_else(|| panic!("create failed: {:?}", res.failures()));
        assert_eq!(self.status(&id).await, "TokenReady", "{:?}", res.failures());
        Ok(id)
    }

    pub async fn seed(&self, who: &Account, id: &str, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
        self.seed_via(who, self.usdc.id(), id, amount).await
    }

    pub async fn seed_via(&self, who: &Account, ft: &AccountId, id: &str, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
        let msg = json!({ "v": 1, "op": "seed_instant", "launch_id": id }).to_string();
        Ok(who
            .call(ft, "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.launcher.id(), "amount": amount.to_string(), "msg": msg }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?)
    }

    pub async fn open(&self, who: &Account, id: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who.call(self.launcher.id(), "open_instant").args_json(lid(id)).gas(GAS).transact().await?)
    }

    pub async fn call(&self, who: &Account, method: &str, args: Value) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who.call(self.launcher.id(), method).args_json(args).gas(GAS).transact().await?)
    }

    /// Same as `call` with an explicit prepaid gas, so balance checks are not drowned by the gas of a 300 Tgas call.
    pub async fn call_gas(&self, who: &Account, method: &str, args: Value, tgas: u64) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who.call(self.launcher.id(), method).args_json(args).gas(Gas::from_tgas(tgas)).transact().await?)
    }

    pub async fn view(&self, method: &str, args: Value) -> Value {
        self.launcher.view(method).args_json(args).await.unwrap().json().unwrap()
    }

    pub async fn inst(&self, id: &str) -> Value {
        self.view("get_instant", lid(id)).await
    }

    pub async fn status(&self, id: &str) -> String {
        self.inst(id).await["status"].as_str().unwrap().to_string()
    }

    /// create, seed with the declared amount and open (two legs) against whichever market was deployed. Returns the id.
    pub async fn launch_to_open(&self, who: &Account, p: Value) -> anyhow::Result<String> {
        let seed = p.get("seed_q").map_or(250 * USDC, n);
        let id = self.create_ready(who, p, None).await?;
        self.mint_usdc(who.id(), seed).await?;
        self.seed(who, &id, seed).await?.into_result()?;
        assert_eq!(self.status(&id).await, "Seeded");
        self.open(who, &id).await?.into_result()?;
        Ok(id)
    }

    /// Fast-forwards until the chain clock passed `t_ns`.
    pub async fn wait_until(&self, t_ns: u64) {
        for _ in 0..2_000 {
            if self.now().await >= t_ns {
                return;
            }
            self.worker.fast_forward(50).await.unwrap();
        }
        panic!("clock never reached {t_ns}");
    }

    pub async fn now(&self) -> u64 {
        self.worker.view_block().await.unwrap().timestamp()
    }

    /// The identities the contract checks about itself, plus the real balances against the expected custody (at rest).
    pub async fn assert_solvent(&self, ids: &[&str]) {
        for id in ids {
            let inv = self.view("get_invariants", lid(id)).await;
            for k in ["usdc_custody_identity", "token_custody_identity", "supply_conservation", "claimed_le_unlocked", "vest_bounds"] {
                assert_eq!(inv[k], true, "{k}: {inv}");
            }
            let tok: AccountId = inv["token"].as_str().unwrap().parse().unwrap();
            assert!(self.usdc_bal(self.launcher.id()).await >= n(&inv["usdc_custody"]), "usdc custody below expected: {inv}");
            assert!(self.bal(&tok, self.launcher.id()).await >= n(&inv["token_custody"]), "token custody below expected: {inv}");
        }
    }
}
