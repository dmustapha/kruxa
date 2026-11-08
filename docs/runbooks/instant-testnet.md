# Runbook: instant launcher on NEAR testnet (T3)

Account ids and transaction hashes only. No keys here (keys live in `~/.kruxa-secrets/instant-testnet/`, mode 600). Everything is NEAR TESTNET, play money.
**DEMO PROFILE: one launcher "day" is 10 seconds.** These accounts are throwaway demo accounts, they are labelled `demo-*`, and this build must never be deployed anywhere public.
Raw evidence: `evidence/instant-testnet/` (`txlog.jsonl` every transaction with the rule codes seen, `snapshots.jsonl` the `get_invariants` views after each step, `findings.jsonl`, `accounts.json`). Driver: `scripts/instant-testnet/` (`npm i`, then `node setup.mjs`, `node flow.mjs`, `node real.mjs`, `node factory-probe.mjs`).
Rows in `txlog.jsonl` without a tx hash are the first attempt of a few registration calls that the public RPC rejected with HTTP 429 before anything was sent; they were repeated with the hashes shown there.

## Accounts (root `kxi-root-0811.testnet`, a throwaway created through the testnet helper)
| Role | Account |
|---|---|
| Launcher (demo profile, wasm sha256 `1ce3157607db3c0b5f8743b5378d7d0e2daa2b154910361c0a959440b134b15d`, 261,499 B) | `demo-instant.kxi-root-0811.testnet` |
| Market ABI 1.1.0 (wasm sha256 `2817cb45f52a5dbc22ace7d1d1e6a7041edd5d3cbb95ce5daa79225358b0bdcb`) | `demo-market.kxi-root-0811.testnet` |
| Mock USDC (6 decimals, `mint` open) | `usdc.kxi-root-0811.testnet` |
| Mock factory (creates nothing: launch tokens are pre-deployed mock FTs owned by the launcher) | `factory.kxi-root-0811.testnet` |
| Guardian / treasury | `guardian.kxi-root-0811.testnet` / `treasury.kxi-root-0811.testnet` |
| Creators | `creator-a.kxi-root-0811.testnet`, `creator-b.kxi-root-0811.testnet` |
| Trader | `buyer.kxi-root-0811.testnet` |
| Launcher + market against the REAL factory (section 3) | `demo-instant-real.kxi-root-0811.testnet`, `demo-market-real.kxi-root-0811.testnet`, creators `creator-c.`, `creator-d.`, trader `buyer2.` |

Wiring: `market.set_launcher` (tx `bqeBhuQd2y5K5b8qMxdqxMVmDmtRnrxbRHSeXtojkc1`), `launcher.set_market` (tx `BL9fJNejz5BcDLfmzEb2QinJLMfH3QtoJXfh6pVpuy7m`). Launch tokens: `alpha.factory.kxi-root-0811.testnet` and `beta.factory.kxi-root-0811.testnet`, `mock_ft` owned by the launcher with 1,000,000,000 whole tokens.

## 1. Full launch ALPHA (launch id 1000000000)
`get_invariants` (launcher, launch, market, pool) was true after every step (`snapshots.jsonl`).

| Step | Tx | Result |
|---|---|---|
| create_instant ALPHA (creator-a, 0.13125 NEAR) | `HRcbk4HGLL37LKxa7MTMJzS63ETaKNTDrstKrXwaqM91` | TokenReady |
| claim_vested before the pool is open | `BrzmLLaSpgWgdkdRGqBBN9UBKatYvAzivPjPrx4ijRaf` | refused `R_INSTANT_STATE` |
| seed 250 USDC | `GpNdjCq9cnPNuR2A9vmxbRhAJDamHiC2w8xS1EZW2nPg` | Seeded |
| open_instant by a stranger at 260 Tgas | `BmetiMjj2JMxYkcpG3hqAVZfDFTJ6PtBiNzuHdHLxVqS` | Open (seed and token leg consumed, market registered on the token) |
| buy 20 USDC | `DvEwwAGeSqVZJ1wUaAmkuLxVrYjbcEwxPtMJa4X7wHu3` | buyer holds ALPHA |
| sell half back | `3iVGtSYvshErKwqnqjxUkygzmJntV9HxiSVkT3mcB5Zb` | USDC back to buyer |
| self-buy by the creator | `8226Dat7cxm2j9iH8Z9vke2j9EobgoWfohpWYG8xo4fB` | refused `R_SELF_BUY`, USDC returned |
| self-buy through the receiver field | `F7eKbyHMAwYqeCirJiwYJCz5tpGVncGNRojjUryortUg` | refused `R_SELF_BUY`, USDC returned |
| claim_vested by a stranger | `34dkkWD8cRycBVykn2wzC9VE9mZcrdYyDNeiVjpW5HSF` | refused `R_NOT_AUTHORIZED` |
| claim_vested above claimable | `4zytduNgfRvAYGCBFqxjhuR2Xnzvof6euMhe4xH27jSf` | refused `STREAM_CAP` |
| claim_vested after the 70 s cliff | `ChogdADcZgx1LgGymbQ98nmmno7DXxn7Xv1m3Xt6QS4g` | paid 13,713,874.308333 ALPHA (of 50,000,000 allocation), alloc_claimed set |

Gas sample for finding C-01: the stranger called `open_instant` with 260 Tgas and the pool opened cleanly (status `Open`, `seed_inflight` 0).

## 2. Failed launch BETA (launch id 1000000001)
| Step | Tx | Result |
|---|---|---|
| create_instant BETA (creator-b) | `Bpbm3rX1xiEscvGS8rRXVLMxb46oQB37ZG8rX4QaFFMY` | TokenReady |
| seed 250 USDC | `6XxGSrZm5zAtAET4e1KgvKo9o786cFtCXBuQmGcVhgmR` | Seeded |
| market.pause (guardian) | `GB4HTY9AUWztYsyTSv3K8PboWdFwkL9GH3meaQZrUP5F` | market paused |
| open_instant against the paused market | `53vBHd6Q6VUQSEGaMggXZuEVSpT5aAnoANmXjtbEtYZD` | seed leg refused `R_PAUSED`, seed back at the launcher |
| abort_instant too early | `bWPvrsgYQ3eErcW7xPpiYcQU8TJRHUZP7QxiLi4Z54K` | refused `R_TOO_EARLY` |
| abort_instant by a stranger | `2bU2GHiT6zu3UroPn2UZuv8VUW3ai1CKCtuqzmybRSqK` | refused `R_NOT_AUTHORIZED` |
| abort_instant by the creator (30 s later) | `FyxUN26hfqsJYuyuYHjS9dPnL8bSRgQD8indZWHkvDME` | Aborted, the whole 250 USDC back to creator-b |
| reclaim_deposit | `2aCf5n19JnryJcXGNLSuFWSPi5b3fkvQp2REeZkKkGez` | NEAR deposit minus record storage and factory deposit paid back |
| market.unpause (owner) | `GpuLFcrodDxmsZB5G1uujHrt8XCnULCtDisrJbbbyaP2` | market live again |

After the abort `get_invariants` for BETA: custody identities true, supply conserved, token never listed.

## 3. The real token factory (`token.primitives.testnet`)
Findings (details in `findings.jsonl`):
1. **The launcher cannot create a token on the real factory today.** `create_instant` against `token.primitives.testnet` ended `CreationFailed` (`R_TOKEN_CREATE`): the factory receipt failed with `Exceeded the prepaid gas` (tx `BWH97hZbjb9T9H8H6nxseRQyexWmbCpLBQPHxuT9Zgt1`). The launcher gives the factory call `GAS_FACTORY` = 80 Tgas. Direct `create_token` calls with the same argument shape as the launcher: 80 Tgas fails (tx `4LXnRy1PiBJKXZCa8HRET9vKAG6mMMC8kuuH5D7KK1JX`), 85 and 90 Tgas fail, 95 Tgas works (tx `GbZaxh2qM5xnqqvqxCJaxi3ZJozkdd9hEGvwUup5sQsU`) and 100 Tgas works (tx `5WSwkRzaVWGNCGP9S6AYD6U2mqUY3JqxkFMXRtmZmzPq`). The factory therefore needs between 91 and 95 Tgas; the launcher constant must be raised to at least 100 Tgas (and the gas budget of `create_instant` re-checked). The sandbox mock factory never exposed this.
2. **CO-7 unknown #1 (registering the market with 0.00125 NEAR): yes, it works.** On the factory token `kxipg100.token.primitives.testnet`, `storage_balance_bounds` is min 0.00125 NEAR and max 0.00125 NEAR; `storage_deposit` for the market account with 0.00125 NEAR succeeded (tx `Gg6AByLX1Z6XNZdnfuYEMw3wtUsh2rr3ZXD2bzvhz2Rx`) and `storage_balance_of` shows 0.00125 NEAR total. This was tested directly, not through the launcher's open path, because of finding 1.
3. **M-04 against the real token: not triggered.** `ft_transfer` on the real factory token returns nothing (tx `7Rz7jQKKj5vMZbPju2qNY6ceWj2iMXuankXQnnEn9U9A`), so the market's `max_len 0` read does not misfire with this token.
4. **H-01 against the real factory: the deposit does come back.** `create_token` for an existing token account fails inside the factory batch and the 0.06 NEAR returns to the caller (isolated run tx `5tHGhN13CSfdm4h4H1aSq5UMyJ1dtZM6eoXpBa2aLCAt`: balance change -0.0012 NEAR, gas only). So the drain described in H-01 does not occur with this factory. The rate-limit clearing half of H-01 is real and is in the known findings (K-H01).

## 4. The fixed launcher (main after the ws/instant2 merge) on testnet
Account `demo-instant-v2.kxi-root-0811.testnet`, wasm built from merged main (270,698 B). Review M-02 on a real `.testnet` account:
`new` with profile `Mainnet` is refused `R_PROFILE` (tx `6298ezeyU19k8jeRPjELDJyux79F3n89jVTXMSPJvEH1`), `prod` is refused (tx `92A3b1rSvVmL6d9hMmSpJbKoPsjL8CkQBwhHPaYxWdb1`), and `mainnet` on a `.testnet` account is refused `R_PROFILE` (tx `6LNgCs3zkAZf6BHZNM7Zs5yWgiMP5oTnhhSoifkhNME1`); `demo` is accepted (tx `7zxtzXDwCsinyi92Mz3ffVCf2eLPaZJR1dJpMqCu8bSo`).
The sections 1 to 3 ran on the PRE-fix wasm (sha256 in `accounts.json`). The `GAS_FACTORY` finding (section 3, item 1) was fixed afterwards (110 Tgas on main) and confirmed on testnet in section 5.

## 5. Run 2: fixed launcher + market 1.1.2 against the REAL factory, end to end
Fresh throwaway root `kxi-root-1108.testnet` (funded from two helper accounts, 29 NEAR), no mock factory. Evidence: `evidence/instant-testnet/run2/` (`txlog.jsonl`, `snapshots.jsonl`, `findings.jsonl`, `accounts.json`). Driver: `scripts/instant-testnet/real-flow.mjs` (`KXI_ROOT=kxi-root-1108.testnet KXI_EVID=<evidence dir> node fund.mjs`, then `node real-flow.mjs`; stages `ONLY=SETUP,FULL,FAIL`). `get_invariants` (launcher, launch, market, pool) was true in all 13 snapshots.
| Role | Account / wasm sha256 |
|---|---|
| Launcher, demo profile, `GAS_FACTORY` 110 Tgas (273,845 B) | `demo-instant.kxi-root-1108.testnet`, `cb9646ad465e1b3f0c68ef7183ed9f2116b97a7a267155f8e4d41e43941c4678` |
| Market 1.1.2, fresh account (257,446 B) | `demo-market.kxi-root-1108.testnet`, `ba88891316b68cf50eb82d80e72af346c931ced55f70c06e65d8f1e00b45718e` |
| Mock USDC, guardian, treasury | `usdc.`, `guardian.`, `treasury.kxi-root-1108.testnet` |
| Creators, trader | `creator-a.`, `creator-b.`, `buyer.kxi-root-1108.testnet` |
Deploy and init: launcher `BbFDvjALoGL6knZFhdFquFT82Noe1qPCqkKQ8unnYY5M` / `28Y1zcdZ8z4GCEWApcipH2TatNuo1YJjXx5YLvgtoZPa`, market `Sb25F6gQVK2N1zR1hBfUUt8YQG93zi3dpwmWGqPVZd3` / `GRF8xMJKguFFu74gehMV33Jti7mMFzhTr4ezNzaHEr3`, `set_launcher` `ADQuTTEYedoZdEu8Kpkpjhmaiurfi2groCYmwwAXHm7F`, `set_market` `4NBHWWsjPpGcZ5vuYcBBiu9CF8snAKZ71qdHcPCpkwot`.

### 5a. Full launch KXIA1108 (token `kxia1108.token.primitives.testnet`, launch id 1000000000)
| Step | Tx | Result |
|---|---|---|
| create_instant (creator-a, real factory) | `8iAM6A8x2UHwRgTjMdhkomLCtyuQn178fauMu6kwViGB` | TokenReady, finding 1 of section 3 is closed |
| seed 250 USDC | `3XRdkw8QddNACMRLQUh1CW9ZWPUrVcDFb8q1NYbofZtm` | Seeded |
| claim_vested before open | `ELgaHhedkbQYpySDBkCRzFm9K5TgqjL2tNHQDdEd9WGC` | refused `R_INSTANT_STATE` |
| open_instant by a stranger, 260 Tgas | `7R1u9VaRwtY5uHryRik1LCcZKY2BXgkkLeheseqTfnc3` | Open, market registered on the token (0.00125 NEAR) |
| buy 20 USDC | `A3uaUJJBS654gLPhKAXL2KhexDF6QYMEVMxrcSih89ai` | buyer holds KXIA1108 |
| sell half | `FhMfvRMoadFmPc4j2B88EtatJ9dkpMGmwdbUAxYgFBiU` | USDC back |
| self-buy by the creator | `B7a8ogaF3npLqZzKHvCJmMxHQrZ6RQat4zEuhPKQd7XT` | refused `R_SELF_BUY`, USDC returned |
| self-buy via receiver field | `HogKFya1PMV3TcEc9qsPv2a6ofKTbLuTaoA5SZwij6rc` | refused `R_SELF_BUY` |
| claim_vested by a stranger | `B8aDWLeAzg6gxQhzsSdfpsrrtpVscKN3ZDeSmQoGABUE` | refused `R_NOT_AUTHORIZED` |
| claim_vested above claimable | `6FFkqPXumUbcqJjVE3PWGLsLfgesk3BXMo6U1TU38Gq7` | refused `STREAM_CAP` |
| claim_vested after the 70 s cliff | `FpWuPPpmPxh81Y1n6YGHxTA8dvrmw3fmUMu9Z7ZB1KnQ` | paid 18,630,575.515833 KXIA1108 of 50,000,000 |

### 5b. Failed launch KXIB1108 (launch id 1000000001)
| Step | Tx | Result |
|---|---|---|
| create_instant (creator-b) | `3hzhTvsbSexgefucyfdb4FsmvauKqBaJtfwezYLuN9CA` | TokenReady |
| seed 250 USDC | `4te9zADeUmSZRWxisQ9qFpTNcBePsLCGQcYAGamWb9FJ` | Seeded |
| market.pause (guardian) | `FGjEVHSVhhSgwDCRKV4R5VneUomUzfGDfyGYTmx4aVSi` | paused |
| open_instant against the paused market | `EwY3PNsN8RWjJtLh7yqvvSiFZ1vHB8CJsLpDuoiWW8HK` | seed leg refused `R_PAUSED`, seed back at the launcher |
| abort too early / by a stranger | `5EZ3mwmHzoHcRqyqY2F6DXXTMbR89zzLXq4aExCYUMwg` / `6i2cBbt5JbYJ8MRYSgeLPDHHDLidNYhBd9ikmPenuBiu` | `R_TOO_EARLY` / `R_NOT_AUTHORIZED` |
| abort_instant by the creator | `DCSu2tfqmkhpWX5gmhAC5vkbcC4vRM4y9gein93YXKLS` | Aborted, 250 USDC back to creator-b |
| reclaim_deposit | `JA6AF5G8HUc4hjjm8WZDrRokftig4tdMhwqEn6pQpTWC` | NEAR deposit paid back |
| market.unpause | `3Kw3yZb8LibbeNM7gYXnbSgbvjigGvmDf66N33ByE9B8` | live again |

### 5c. Notes on the log
- The creator account ran out of NEAR before the first vesting claim (0.6 NEAR funding minus the 0.13 deposit and 300 Tgas reservations). That is test-account funding, not a contract issue; it was topped up from the root and the claim repeated. In `txlog.jsonl` the three `success: false` claim rows with no rule code (`D5G4g9EzY5Qct5rjEnqAVTXNrxbonYKHJqsZAvesB9b8`, `3SPci8odUzR23zyErNR7EfgtrwxcWBM42bFWtjDXht6C`, `J5t7o96EtxUyjdJpHUeA7PNdLQTqzpLQQyjZqgdhghwq`) are: rejected client side for balance, and two malformed calls from the ad hoc retry (launch id sent as a number; the launcher refused the JSON). Nothing else is unexpected.
- Rows marked `success: false` with a rule code are the expected refusals.

## Not done here
- No sandbox-style wait for the freeze expiry or the 7-day cap timelock: both are 7 real days even on the demo profile.
- Run 2 (section 5) covers seed, open and trading on a real factory token through the launcher. Cap timelock and freeze expiry remain untested on testnet.
- Mainnet: nothing was signed or deployed.
