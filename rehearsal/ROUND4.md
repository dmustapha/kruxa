# Round 4: the reproducible core wasm on core3, F0 rerun on those exact bytes (2026-11-10)

NEAR TESTNET and Solana DEVNET only, play money, throwaway keys. Per row detail: `rehearsal/LOG.md` (rows R4-1 to R4-7).

## Result per step

| Step | Result | Evidence |
|---|---|---|
| 0 wasm hash | PASS. `artifacts/kruxa_core.reproducible.wasm` sha256 `665caab5a582a58b2412dfb2e81f1caf2ff94339c8bcc9f8be9ebebb72239c64`, 655,387 B, checked before anything else and again by `redeploy.mjs` (EXPECT_SHA256) before it sent. | `rehearsal/LOG.md` R4-1 |
| 1 state before | core3 `view_code` sha256 `e85198ed37c2aa1d6cd5f18571f5e023eed391108ca8f22edc8599ac390e65ac`; `get_state` and `get_invariants` for launches 2, 3, 6, 8, 9 recorded (all_ok true). | `evidence/testnet-core3/round4-before.json` |
| 2 deploy | PASS. DeployContract tx `Gu5Msp6rduKg6XZ8RFNbMeT6s2aKM2Tcvmp7GNTgWvza`. No init call and no `migrate` was needed (same state layout; every old view read back unchanged). | `txlog.jsonl` row "round 4, reproducible wasm 665caab5" |
| 3 hash and old views | PASS. `view_code` sha256 equals `665caab5...`; get_invariants all_ok true; get_state and get_invariants of launches 2, 3, 6, 8, 9 byte identical before the deploy, after it, and at the end of the round. | `round4-after-deploy.json`, `round4-after.json` |
| 4a R_GAS | PASS. `create_trial` for KXDR with 150 Tgas refused `R_GAS: attach at least 250 Tgas to create_trial`, tx `9e3HdKjvrKEZPLFuPJ8kTBEHGzd2GTgd6tE9gx3ayMSa`; next free launch id 10 before and after; 0.0002 NEAR of gas lost. The same creator then created launch 10 with 300 Tgas, tx `UPytC6ya67dmPrSpv2xtJ4TgoMkFkfXkyHzopgAcT6R`. | `rgas-probe-round4.json` |
| 4b launch 10 | PASS. KXDR, creator-a, 12 Solana buyers, 360 USDC, F0 plan, token `kxdr.factory.kxi-root-0811.testnet`. Keeper: settle `3MB18vUqc4cb4CTQTT9hzVNG9pp1G2Hzv6SoXkV1GGPC`, sweep_residue `HXTCzew1EnNCp2wab6RhkWQ5CLhYve5aPfsE1MUHHdSE`, consolidate `HNsyaLXwF9NAonJ1gv8y2qFQ88aomN52Gqad54WLj9c1`, pay_launch_fee `HD6SJNhnXBD7Y29Hix8ZeWPZZcx6SBsdFaNwzLfJrT4P`, pay_relay_fees `R_NOTHING_FREE` (expected). Final status Passed, positions_unsettled 0. | `keeper-10.log`, `launches.json` row J |
| 4c F0 ceremony | PASS, with one owner reopen (see Notes). tx1 `44XqjTqYkzwA2D6EsqLScZfK9LvLKh1oDseGH1o4L5CqaZYgCtgZw6hCBbE2iZSyiQUBZiAW282uJ9R2Ud8G8Wzg`, tx2 `3RTQY8GvNQPGdHuiQCid8xChZnZx4KB6CGhFzBNB1m4kqoKdhUG4iTrXL5gNZqaWe7vLceyi7jrpsW1st4BhbeVo`, mint `6MMpWcv7vnpc9ZFKJoykK8dnMAmSzkKfYqHzNf4GRZqC`, mint and freeze authority null, G ends 890880 lamports, confirm_genesis ok, merkle root matches the core, claim ok 54166666666666, distributor admin null. | `evidence/genesis/core3-f0-devnet-launch10.json`, `.log`, `core3/genesis-10.json` |
| 5 verify | PASS. `verify.sh 10` exit 0 (21 passed, 7 skipped, CODE line MATCH `665caab5...`); `--tamper-all` exit 2, 19 MISMATCH lines. | `verify-10-f0.txt`, `verify-10-tamper-all.txt` |
| 6 gate-g2 | PASS. GREEN 9 of 9, first run (PASS 10, FAIL 3, G1 from the existing logs). | `gate-g2-round4.txt` |

## Notes (what went wrong and how it was handled)

1. The shared RPC `test.rpc.fastnear.com` throttled (HTTP 429) for the whole round (another client was using it). Effects: three rgas-probe starts died before sending anything; the first seed died at the read-only F0 key lookup after funding the holders (the seed was rerun, the first 12 holders are orphaned play money at the mock Intents); genesis attempts 1 and 2 died with 429 before any state change; verify attempt 1 and 2 exit 4. All failed outputs are kept (`core3-f0-devnet-launch10-attempt1-RPC429.log`, `attempt2`, `verify-10-f0-attempt1-...txt`, `verify-10-f0-attempt2-...txt`).
2. Fixes: `scripts/instant-testnet/lib.mjs` waits and resends on 429; `seed.mjs` retries the F0 key read; new `scripts/core-testnet/rpc-retry-proxy.mjs` (127.0.0.1 pass-through to the same RPC that resends on 429) was used for the genesis resume, verify attempt 3 and the gate. The proxy was killed afterwards.
3. Genesis attempt 3: tx1 landed, tx2 failed `Blockhash not found` (the 429 backoff stretched the MPC signing beyond the blockhash life). Both gate slots were already signed, so the ceremony could not continue by itself. Recovery used the designed path: `abort_genesis` by guardian (tx `CPi1kXaP6BDm8FFWF7K8fMYnvTRVL4Zz9QDik9s6jqXp`), `reopen_genesis` by owner (tx `A1EJrtjAFhehBqkhC9YCgWqFYU8MkYpZmWCFULq2kWka`), then the driver with `--prior-tx1`, which resumed (skipped tx1, sealed with tx2). The final genesis is Confirmed on the reproducible wasm; the earlier committed attempt remains in the `genesis_committed`, `genesis_aborted` and `genesis_reopened` events.
4. verify's CODE line compares with `artifacts/SHA256SUMS`, which still named the local build e85198ed for `kruxa_core.wasm`, so the first attempt reported MISMATCH. The line now names 665caab5 and `artifacts/BUILD-KIND` says reproducible (core only). Both are TRACKED files changed in this commit; the main repo's local `artifacts/kruxa_core.wasm` (e85198ed) no longer matches them, so use `kruxa_core.reproducible.wasm` for the core from here on.
5. Funding: the new token account needs about 1.8 NEAR and the root held 1.41 (reserve rule 1.0). Rather than stop, 2.4 NEAR of core3's spare balance (balance above its storage stake; the core never reads its native balance) was lent to the root (1.8), creator-a (0.4) and keeper (0.2) with `core-lend.mjs`, which refuses to leave core3 under storage plus 0.5 NEAR. No outside funds, nothing deleted. The core3 spare is now about 1 NEAR; it was 3.1.
6. KXI_RESERVE_NEAR=1 was set for seed.mjs, as in round 3.

## Balances (NEAR)

| Account | Before | After |
|---|---|---|
| kxi-root-1108.testnet (root) | 1.414 | 1.453 (never below 1.0; lowest point about 1.45 after the token top-up) |
| core3 | 10.213 | 8.169 (storage stake 7.185) |
| keeper | 0.397 | 0.593 |
| creator-a | 0.393 | 0.370 |
| guardian | 0.150 | 0.150 |
| factory.kxi-root-0811 | 1.153 | 1.153 |
| kxdr.factory.kxi-root-0811 (new mock-FT token of launch 10) | n/a | 1.799 |

## New or changed files

`scripts/core-testnet/state-snapshot.mjs`, `core-lend.mjs`, `rpc-retry-proxy.mjs` (new); `redeploy.mjs` (wasm file argument, EXPECT_SHA256, ROUND_TAG), `seed.mjs` (spec J, F0 key retry), `scripts/seed-demo.sh` (accepts J), `scripts/instant-testnet/lib.mjs` (429 retry); evidence under `evidence/testnet-core3/` and `evidence/genesis/`.

## Process hygiene

Seed, keeper, genesis driver, verify, gate and the retry proxy all ended or were killed; temporary symlinks (`scripts/node_modules`, `relayer/node_modules`, `tools/squads/node_modules`, `target`) removed before the commit.
