# Round 2: core3 on the final wasm (2026-11-10)

NEAR TESTNET and Solana DEVNET only, play money, throwaway keys. No mainnet write, no key printed. Details per row: `rehearsal/LOG.md` (rows R2-1 to R2-5), blocked items: `rehearsal/BLOCKED.md` (Round 2 section), gate rows: `rehearsal/GATE-EVIDENCE.md`.

## Result per step

| Step | Result | Evidence |
|---|---|---|
| 1 build and redeploy | PASS. Build sha256 `e338f84d30208849a819fee19e8f311e071cd48f37a1f0b6d03744378d97639a`, 674,863 B (as expected). Deployed over core3 state (no init) by `scripts/core-testnet/redeploy.mjs core`, tx `4fa9ZE9tHmu6QshQzCuFPcYgTu41jZHhzfb2CLtVyW1Z`, view_code sha256 equal. get_invariants launch 2 and 6: all_ok true. Market wasm unchanged (`c80560d6...`), market3 not redeployed. | evidence/testnet-core3/txlog.jsonl |
| 2 gas fix vs the REAL factory | PARTIAL. Direct calls to `token.primitives.testnet`: create_token at 80 Tgas FAILS (`Exceeded the prepaid gas`, tx `6WymoWoxhQf38NSQCSf9uUnrbDyM53p1Qdhtzo4pgypT`), at 110 Tgas SUCCEEDS (token `kxr2g110.token.primitives.testnet`, tx `5oLd9c4UwpuHcKNA4oY9qJzscFioEUpKVnh6vU34Xe1k`). The core to real factory `create_trial` was NOT run: the factory is fixed at `new` (no setter), `core4` needs about 7 NEAR of storage. The mock factory (95 Tgas minimum) accepted the new core on launch 8. | evidence/testnet-core3/real-factory-probe.json |
| 3 F0 on the final wasm | PASS. Launch 8 (KXCH, creator-a, 12 Solana buyers, 360 USDC), PASS verdict, keeper settle/pages/sweep/consolidate/fee, F0 genesis through `register_f0_message` and `sign_genesis` (predecessor core3), mint `FrurXVLrLdThUL6ixS2qrtFyr1VSHpvdivmHutMhQG25`, tx1 `5p8T9kXCMkdB7q2q8w7uhF1qZGkUfc3SwEEcBWksWe6GfoyKfQLCPq98Qv1TxYLFhNWWUi4dgdcjzinnaBrh8Yic`, tx2 `64hqHybmxJYsqc9QejVbrX9je4w1SGZVHevqRqg4RcrwLwNCKyoqat8gEvtS2YAvbBP5k3QJRHMPMYgdhfdSZRvT`, claim ok, distributor admin null, mint authority null. `verify.sh 8` exit 0 (21 passed, 7 skipped, CODE line MATCH), `--tamper-all` exit 2 (19 MISMATCH lines). `gate-g2.sh` GREEN 9 of 9. | evidence/genesis/core3-f0-devnet-launch8.json, evidence/testnet-core3/verify-8-f0.txt, verify-8-tamper-all.txt, gate-g2-round2.txt, keeper-8.log |
| 4 N-04 real factory | PASS (finding closed for testnet). Two `storage_deposit(registration_only)` for one account on `kxr2g110.token.primitives.testnet`: first (tx `683Ai8Yr9k1GVVMZynFpn2sQsf8N8w6D2UPxGsustVGU`) registers, second (tx `BveMgNnxG4B1BtiJSyswsHQCCYiWpeQPykRJX5Krd1d5`) logs "already registered, refunding the deposit" and returns the 0.00125 NEAR. Written into docs/KNOWN-FINDINGS.md N-04. | evidence/testnet-core3/real-factory-probe.json |
| 5 reproducible wasm | PASS for the core, with a gap. Docker (colima) is installed. Reproducible core sha256 `d362ffa2e37a85158eb43ebba34b7418a5b1b5f3bf77044b97d5879a88326f5f`, 655,251 B, two runs identical. It differs from the deployed local build (`e338f84d...`, 674,863 B). Recorded in `artifacts/SHA256SUMS.reproducible` and a CANDIDATE row in LOG.md (no FREEZE row). `artifacts/SHA256SUMS` stays the local build so verify's CODE line matches core3. Market and launcher have no `reproducible_build` metadata. | rehearsal/LOG.md R2-5 |

## Findings

1. `create_trial` needs far more than 150 Tgas now. At 150 (the old runbook number, and what `seed.mjs` sent) the factory leg ran but the core callback starved: launch 7 stayed `Creating` (tx `86wtzFWARfj8LpU4JYFWTGwsrmVKiov2dc3rUfYtDuuW`), the creator was locked by "one active trial per account", buyers got R_WRONG_PHASE. `finalize_creation` before 10 minutes gives R_TOO_EARLY (tx `EYU5YRVCBBYWXa1DAYvyvJTBaEuiroCdiML7XG3HfBjC`), after it recovered the launch to Open/Ready (tx `79rvNZJ9gJufQf9VGuyYPTtSG2aoVnFLkGwAE5ByCeXM`). 300 Tgas works (launch 8, tx `DXD4HAewPe173yDw3KVAD9bhavoCfy6z1fZPoj9yLqqh`). Any UI or doc that says 150 is stale. Suggest a decision: publish 300, or add a prepaid-gas `require!` in create_trial.
2. `scripts/secret-scan.sh` was RED at bf232fb: `evidence/attack-gallery/disclosed-facts.json` quotes the public `test.near` key from the N-06 read-only view. Allowlisted that one file (public key, not a secret).
3. `scripts/build-artifacts.sh --reproducible` was broken (`--no-abi` is rejected by `reproducible-wasm`); fixed. It also cannot run inside a git worktree (cargo-near clones the parent repo HEAD) and needs `TMPDIR` under `$HOME` for colima; I built from a plain clone.
4. verify's CODE line compares view_code with `artifacts/SHA256SUMS`; after any redeploy run `./scripts/build-artifacts.sh --local` or the run exits 2 on a CODE MISMATCH (it did, once, before I refreshed it).

## Balances

| Account | Before | After |
|---|---|---|
| kxi-root-1108.testnet (root) | 2.187 NEAR | 2.256 NEAR (never below 1; low point after the token top-up about 2.1) |
| core3 | 9.139 | 9.856 (launch 7 and 8 bonds and fees) |
| market3 | 2.798 | 2.798 |
| keeper | 0.127 | 0.723 |
| probe2 (new, real-factory probes) | n/a | 0.430 |
| creator-a / creator-b | 0.188 / 0.165 | 0.566 / 0.242 |
| Solana devnet relayer 8yePW2xxVhQfsSb5RX7h46gpy7Jf7KYZi9GUMkPdyUKa | 1.06199 SOL | 1.03354 SOL |

NEAR moved (all within our own throwaway accounts, txs in evidence/testnet-core3/txlog.jsonl): swept about 4.30 NEAR into the root from creator-a/b/c/d, buyer, buyer2 under kxi-root-0811 and kxi-fund-a/b under 0811 and 1108 (each keeps 0.06), plus 1.699 NEAR from kxi-root-0811. The root sent: 0.5 to probe2 (created it), 0.6 to keeper, 0.5 + 0.3 to creator-a, 0.5 to creator-b, 1.747 to factory.kxi-root-0811 (funds token accounts). Two new mock-FT token accounts hold 1.8 NEAR of storage each: kxcg (launch 7) and kxch (launch 8) under factory.kxi-root-0811.testnet. Nothing was deleted; no account the evidence points to was overwritten (only the code of core3 was redeployed).

## New or changed files

`scripts/core-testnet/redeploy.mjs`, `real-factory-probe.mjs`, `sweep-many.mjs`, `topup.mjs`; `seed.mjs` (G and H specs, create_trial 300 Tgas, `KXI_RESERVE_NEAR`), `scripts/seed-demo.sh`, `scripts/build-artifacts.sh`, `scripts/secret-scan.sh`; evidence under `evidence/testnet-core3/` and `evidence/genesis/`; docs/KNOWN-FINDINGS.md, docs/runbooks/testnet-core3.md.

## Process hygiene

Every process started here (seed, keeper, genesis, verify, gate, docker builds, monitors) has ended; `docker ps` shows no cargo-near container; the temporary `$HOME/.cache/kruxa-repro-tmp` was removed. The scratch clone lives only in the session scratchpad.
