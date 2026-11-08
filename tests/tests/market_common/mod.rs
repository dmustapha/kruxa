//! Sandbox harness for the market suites: mock USDC, one launch token, the market, and an account that plays the stub core.
//! The real `open_market` lives in workstream A; here the stub core is a plain account that sends the two handoff legs.
#![allow(dead_code)]
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const SEED_Q: u128 = 1_000 * USDC;
pub const SEED_T: u128 = 1_000_000_000_000_000;
pub const GAS: Gas = Gas::from_tgas(250);

pub fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{}/{}.wasm", env!("CARGO_MANIFEST_DIR"), name, name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: run scripts/market-build.sh first"))
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

pub fn terms() -> Value {
    json!({ "total_fee_bps": 100, "creator_bps": 5000, "platform_bps": 1500, "holders_bps": 1500, "lp_bps": 1000, "referral_bps": 1000,
            "opening_fee_start_bps": 500, "opening_decay_minutes": 60, "fee_vest_bps": 5000, "fee_vest_days": 90 })
}

pub struct Mk {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub token: Contract,
    pub market: Contract,
    pub owner: Account,
    pub guardian: Account,
    pub treasury: Account,
    pub core: Account,
    pub creator: Account,
    pub launcher: Account,
}

async fn sub(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(100)).transact().await?.into_result()?)
}

pub async fn deploy_ft(root: &Account, name: &str) -> anyhow::Result<Contract> {
    let a = sub(root, name).await?;
    let c = a.deploy(&wasm("mock_ft")).await?.into_result()?;
    c.call("new").args_json(json!({ "owner_id": a.id(), "total_supply": "0" })).transact().await?.into_result()?;
    Ok(c)
}

impl Mk {
    /// `caps`: (per pool, global) in micro-USDC, or None for the DN-17 defaults.
    pub async fn new(caps: Option<(u128, u128)>) -> anyhow::Result<Mk> {
        Self::new_with(caps, None).await
    }

    /// `max_instant`: the instant sub-cap in micro-USDC, or None for the default $5,000.
    pub async fn new_with(caps: Option<(u128, u128)>, max_instant: Option<u128>) -> anyhow::Result<Mk> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let (owner, guardian, treasury, core, creator, launcher) = (
            sub(&root, "owner").await?,
            sub(&root, "guardian").await?,
            sub(&root, "treasury").await?,
            sub(&root, "core").await?,
            sub(&root, "creator").await?,
            sub(&root, "launcher").await?,
        );
        let usdc = deploy_ft(&root, "usdc").await?;
        let token = deploy_ft(&root, "tok").await?;
        let acct = sub(&root, "market").await?;
        let market = acct.deploy(&wasm("kruxa_market_contract")).await?.into_result()?;
        let (pq, gq) = caps.map_or((None, None), |(p, g)| (Some(p.to_string()), Some(g.to_string())));
        market
            .call("new")
            .args_json(
                json!({ "owner": owner.id(), "guardian": guardian.id(), "treasury": treasury.id(), "usdc": usdc.id(), "core": core.id(),
                               "max_pool_reserve_q": pq, "max_global_reserve_q": gq, "max_instant_reserve_q": max_instant.map(|v| v.to_string()) }),
            )
            .transact()
            .await?
            .into_result()?;
        let mk = Mk { worker, usdc, token, market, owner, guardian, treasury, core, creator, launcher };
        for who in [mk.market.id(), mk.treasury.id(), mk.core.id(), mk.creator.id()] {
            mk.mint(&mk.usdc, who, 0).await?;
        }
        mk.mint(&mk.token, mk.market.id(), 0).await?;
        mk.mint(&mk.token, mk.core.id(), 0).await?;
        Ok(mk)
    }

    pub async fn mint(&self, ft: &Contract, who: &AccountId, amount: u128) -> anyhow::Result<()> {
        ft.call("mint").args_json(json!({ "account_id": who, "amount": amount.to_string() })).transact().await?.into_result()?;
        Ok(())
    }

    /// A trader funded with USDC and registered on the launch token.
    pub async fn user(&self, name: &str, usdc: u128) -> anyhow::Result<Account> {
        let a = sub(&self.worker.root_account()?, name).await?;
        self.mint(&self.usdc, a.id(), usdc).await?;
        self.mint(&self.token, a.id(), 0).await?;
        Ok(a)
    }

    pub async fn bal(&self, ft: &Contract, who: &AccountId) -> u128 {
        let v: String = ft.view("ft_balance_of").args_json(json!({ "account_id": who })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }

    pub async fn view(&self, method: &str, args: Value) -> Value {
        self.market.view(method).args_json(args).await.unwrap().json().unwrap()
    }

    pub fn seed_msg(&self, id: u64, token: &AccountId) -> String {
        json!({ "v": 1, "op": "seed_quote", "launch_id": id.to_string(), "token": token, "payout_recipient": self.creator.id(),
                "total_supply": "1000000000000000000", "charter_hash": "ab".repeat(32), "terms": terms() })
        .to_string()
    }

    pub fn leg_msg(id: u64) -> String {
        json!({ "v": 1, "op": "open_pool_token", "launch_id": id.to_string() }).to_string()
    }

    /// ft_transfer_call from `from` on `ft` to the market.
    pub async fn send(&self, from: &Account, ft: &Contract, amount: u128, msg: String) -> anyhow::Result<ExecutionFinalResult> {
        Ok(from
            .call(ft.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.market.id(), "amount": amount.to_string(), "msg": msg }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?)
    }

    /// Stub core: fund and send both handoff legs, USDC seed first.
    pub async fn open_pool(&self, id: u64) -> anyhow::Result<()> {
        self.mint(&self.usdc, self.core.id(), SEED_Q).await?;
        self.mint(&self.token, self.core.id(), SEED_T).await?;
        self.send(&self.core, &self.usdc, SEED_Q, self.seed_msg(id, self.token.id())).await?.into_result()?;
        self.send(&self.core, &self.token, SEED_T, Self::leg_msg(id)).await?.into_result()?;
        Ok(())
    }

    pub fn buy_msg(id: u64, min_out: u128) -> String {
        json!({ "v": 1, "op": "buy", "launch_id": id.to_string(), "min_out": min_out.to_string() }).to_string()
    }

    pub fn sell_msg(id: u64, min_out: u128) -> String {
        json!({ "v": 1, "op": "sell", "launch_id": id.to_string(), "min_out": min_out.to_string() }).to_string()
    }

    pub async fn buy(&self, who: &Account, id: u64, amount: u128, min_out: u128) -> anyhow::Result<ExecutionFinalResult> {
        self.send(who, &self.usdc, amount, Self::buy_msg(id, min_out)).await
    }

    pub async fn sell(&self, who: &Account, id: u64, amount: u128, min_out: u128) -> anyhow::Result<ExecutionFinalResult> {
        self.send(who, &self.token, amount, Self::sell_msg(id, min_out)).await
    }

    /// The custody identity and the real balances: market holds exactly what it believes (plus any donations).
    pub async fn assert_solvent(&self, ids: &[u64]) {
        let inv = self.view("get_invariants", json!({})).await;
        assert_eq!(inv["usdc_custody_identity"], true, "{inv}");
        let exp = n(&inv["usdc_custody"]);
        assert!(self.bal(&self.usdc, self.market.id()).await >= exp, "usdc custody below expected {exp}");
        for id in ids {
            let p = self.view("pool_invariants", json!({ "launch_id": id.to_string() })).await;
            assert_eq!(p["token_custody_identity"], true, "{p}");
            assert_eq!(p["k_ge_k0"], true, "{p}");
        }
    }
}

pub const INSTANT_BASE: u64 = 1_000_000_000;

impl Mk {
    /// Owner points the market at the stub launcher account.
    pub async fn set_launcher(&self) -> anyhow::Result<()> {
        self.owner
            .call(self.market.id(), "set_launcher")
            .args_json(json!({ "account": self.launcher.id() }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// Seed message as the instant launcher would send it (`creator` included, no authority fields).
    pub fn instant_seed_msg(&self, id: u64, token: &AccountId, creator: &AccountId, recipient: &AccountId) -> String {
        json!({ "v": 1, "op": "seed_quote", "launch_id": id.to_string(), "token": token, "creator": creator, "payout_recipient": recipient,
                "total_supply": "1000000000000000000", "charter_hash": "cd".repeat(32), "terms": terms(), "supply_model": "near_factory_fixed",
                "mode": "trial" })
        .to_string()
    }

    /// Stub launcher: both handoff legs for an instant pool. Seed amount `seed`.
    pub async fn open_instant(&self, id: u64, seed: u128, creator: &AccountId, recipient: &AccountId) -> anyhow::Result<()> {
        self.mint(&self.usdc, self.launcher.id(), seed).await?;
        self.mint(&self.token, self.launcher.id(), SEED_T).await?;
        self.send(&self.launcher, &self.usdc, seed, self.instant_seed_msg(id, self.token.id(), creator, recipient)).await?.into_result()?;
        self.send(&self.launcher, &self.token, SEED_T, Mk::leg_msg(id)).await?.into_result()?;
        Ok(())
    }
}
