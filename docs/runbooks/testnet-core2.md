# Runbook: core2 on NEAR testnet (for the F1 and F0 rehearsals)

Account ids and transaction hashes only. No keys here. Everything is NEAR TESTNET, play money. Owner-key actions are done by workstream A1 on request.

## Deployment
| What | Value |
|---|---|
| Root / owner | `kxa1-owner-1203.testnet` (key held by A1) |
| Core | `core2.kxa1-owner-1203.testnet`, wasm sha256 `34d7f6b42654bd550fb13b558a9b7bb42d00958e75e60362b72a327d120483f7` (`ws/core2` build, 571,087 B), init tx `2NTAuABfVutYHfrkpBsq7bMFSxQiqNz8dSfc75a2QMWy` |
| Mock USDC | `usdc.kxa1-owner-1203.testnet` (6 decimals; `core2`, `intents`, `treasury`, `relay-fees` are registered on it) |
| Mock Intents (S3, fake signatures accepted) | `intents.kxa1-owner-1203.testnet` |
| Mock factory | `factory.kxa1-owner-1203.testnet` (accepts `create_token` but creates nothing, see Launch tokens) |
| Guardian / treasury / relay-fees | `guardian.`, `treasury.`, `relay-fees.` under `kxa1-owner-1203.testnet` |
| Genesis relayer (set by `set_genesis_relayer`, tx `DRuddz3UqiLEWMRvuMupbDnTMfVd5ia9ujDWz9jRfdaN`) | `7218da57019c05386280b3a4196e7654279e32c66e129889e17a653fc229cc85` |
| Old core (do not use, old state layout) | `core.kxa1-owner-1203.testnet` |

`get_config` on core2: `profile "demo"`, `creator_gate false`, `market null`, `genesis_relayer` the account above, `pause "None"`.

## Who can create a launch
Anyone. The creator gate (D-1) is closed only on a profile other than `demo` or `testnet` (the mainnet profile); core2 runs `demo`, so `creator_gate` is false and a non-owner `create_trial` works. Verified: `probe.kxa1-owner-1203.testnet` (not the owner) created launch 1 (tx `B5Qz5odnMNzbwQAVwzm1KoYKghmQpchr83hwKCJPiCpS`), then cancelled, dissolved and reclaimed it (txs `CQ7X21Bv...`, `BfXop4t7...`, `FfUTbnfV...`). Launch id 1 is therefore used (`Dissolved`); the next `create_trial` gets id 2. One active trial per creator account. Owner-only calls (`set_market`, `open_beta`, `pause`...) need A1.

## Demo bounds (profile `demo`, from `get_config.rules`)
- `commit_secs` at least 90, `tail_secs` at least 30 (production is 86,400 and 3,600), `open_delay_secs` 0 to 604,800.
- Hard cap $500 to $1,000, soft cap at least $350 and 20% of the hard cap, `min_buy` at least $20, `min_funders` 10 to 500, wallet cap 0.5% to 5% of the hard cap.
- Global cap $3,000 across all launches (`global_held`), per launch $1,000.
- Reserved ticker symbols are refused for non-owners (for example `KRUXA`, `USDC`).

## Launch tokens (the mock factory creates none: use the pre-made ones)
`create_trial` calls `create_token` on the mock factory and then checks that core holds `total_supply` of `<symbol lower>.factory.kxa1-owner-1203.testnet`. A1 pre-deployed these token accounts (mock FT, owner `core2`, supply `1000000000000000` = 1,000,000,000 whole tokens at 6 decimals):

| Symbol | Token account | Status |
|---|---|---|
| `GENA1` | `gena1.factory.kxa1-owner-1203.testnet` | free |
| `GENA2` | `gena2.factory.kxa1-owner-1203.testnet` | free |
| `GENA3` | `gena3.factory.kxa1-owner-1203.testnet` | free |
| `GENF0` | `genf0.factory.kxa1-owner-1203.testnet` | free |
| `GENFAIL` | `genfail.factory.kxa1-owner-1203.testnet` | free (meant for the FAIL / `R_GENESIS_STATE` rehearsal) |
| `GENTEST` | `gentest.factory.kxa1-owner-1203.testnet` | used by launch 1 |

Use the standard preset (1,000,000,000 whole tokens, so the supply matches). Another symbol or supply needs a new token account: ask A1.

## Parameters for a short launch
Take `fixtures/standard.json` and set the symbol, name and windows:
```
{"symbol":"GENA1","name":"GENA1 Test Token","total_supply_whole":1000000000,"sale_bps":6000,"lp_bps":2500,"creator_bps":1000,"backer_bps":500,"hard_cap":"1000000000","soft_cap":"350000000","min_buy":"20000000","wallet_bps":200,"min_funders":10,"open_delay_secs":0,"commit_secs":90,"tail_secs":30,"stream_days":30}
```
Optional third argument of `create_trial`: `genesis` (plan). Omit it for F1 with defaults. For F0 pass `{"mode":"F0","mint_pubkey_f0":"<64 hex>"}` and later call `commit_genesis` with that same key. `required_deposit(params)` (view) returns 421,250,000,000,000,000,000,000 yocto (0.42125 NEAR) for this preset; attach at least that to `create_trial`.

## Steps to a PASS launch
1. `create_trial {params, stream_recipient: null, genesis: null}` from any funded account, 0.42125 NEAR attached, 150 Tgas. `get_state` shows `status Open`, `token` set.
2. Money: `usdc.mint {account_id, amount}` is unrestricted (mock). Register each buyer on USDC with `usdc.storage_deposit {account_id}` (any attached amount). Commit with `usdc.ft_transfer_call {receiver_id: core2, amount, msg}` (1 yoctoNEAR, 100 Tgas), `msg = {"v":1,"op":"contribute","launch_id":"2"}`.
3. PASS needs at least 10 funders and total at least $350: 12 buyers x 30,000,000 (30 USDC) works. Minimum per commit $20.
4. Solana buyers (needed for genesis leaves) come through the mock Intents: `usdc.mint {account_id: intents.kxa1-owner-1203.testnet, amount}` to back the balance, `intents.mt_deposit {account_id: "<64 hex pubkey>", token_id: "nep141:usdc.kxa1-owner-1203.testnet", amount}`, then anyone calls `intents.execute_intents {signed: [ {"standard":"raw_ed25519","payload":"<json string>","public_key":"ed25519:<b58>","signature":"ed25519:1"} ]}` with payload `{"signer_id":"<64 hex>","verifying_contract":"intents.kxa1-owner-1203.testnet","deadline":"2099-01-01T00:00:00.000Z","nonce":"AAAA","intents":[{"intent":"transfer","receiver_id":"core2.kxa1-owner-1203.testnet","tokens":{"nep141:usdc.kxa1-owner-1203.testnet":"30000000"},"msg":"{\"v\":1,\"op\":\"contribute\",\"launch_id\":\"2\",\"deliver\":\"sol:<b58 pubkey>\",\"relay_fee\":\"0\"}","min_gas":"50000000000000"}]}`. The mock does not check signatures. Example in code: `tests/src/lib.rs` (`s3_payload`, `commit_s3`).
5. Wait until `get_phase {launch_id}` says `Ready` (about 2 minutes after creation), then, all permissionless: `settle {launch_id}` (returns true for PASS), `settle_positions_page {launch_id, from_seq: 0, limit: 25}`, `sweep_residue {launch_id}`, and for Solana buyers `consolidate {launch_id}` then `pay_launch_fee {launch_id}`.
6. Genesis (relayer account): `commit_genesis`, `build_root_page`, `confirm_genesis` as in `docs/interfaces/REQ-1-genesis-relayer.md`. Views: `get_genesis`, `get_genesis_spec`, `solana_allocations_page {launch_id, from_seq, limit}`.
7. A FAIL launch for the `R_GENESIS_STATE` check: create `GENFAIL` and `cancel_trial {launch_id}` as the creator; `commit_genesis` then returns `R_GENESIS_STATE`.

## Notes
- `open_market` is not wired here (no market account set); the handoff is exercised in the sandbox suite.
- The testnet clock is real time: the sandbox `fast_forward` does not exist here, so a launch takes about 2 minutes to reach `Ready`.
- Gas: every call above fits in 100 Tgas except `create_trial` (150 Tgas recommended). Measured costs are in `docs/benchmarks.md`.
