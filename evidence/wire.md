# Wire sheet: every integration, labelled

Date: 2026-11-14. Status: current. Built from existing committed evidence only; no new call was made to write it. Repo head when filled: `{{GIT_HEAD_SHORT}}`.

Labels used, and only these:

| Label | Meaning |
|---|---|
| TESTNET | ran on NEAR testnet (and Solana devnet where named), play money |
| MAINNET-READ-ONLY | a read that signs nothing and sends nothing on a mainnet service |
| MOCK | a stand-in contract or fixture is used in place of the real thing on that path |

Rows with no label here are not claimed (see "Not wired").

Which wasm each evidence set belongs to is in `evidence/HASH-NOTE.md`. The final core is `{{CORE_ACCOUNT}}` at sha256 `{{CORE_SHA256_SHORT}}...`. Evidence recorded on an earlier account of the same build family is named as such in the row.

## Wired

| # | Integration | Label | What was exercised | Evidence path | Not covered |
|---|---|---|---|---|---|
| 1 | Kruxa core on NEAR testnet (`{{CORE_ACCOUNT}}`) | TESTNET | Lifecycle: commit, walk, settle FAIL, refunds, dissolve, bond reclaim; F0 launch with Solana genesis; keeper; the `scripts/verify.sh` CODE line MATCH; swarm replays | `evidence/testnet-core7/README.md`, `evidence/testnet-core7/verify-core7-launch1-FAIL-dissolved.txt`, `evidence/verify/claims-C05-core7.txt`, `evidence/swarm-testnet/run-seed1-core7-run1-GREEN.json` (recorded on the previous account of this build; a record for the final account sits beside it when added) | Full-access owner key can redeploy (`LIMITATIONS.md` limit 1) |
| 2 | Market contract (`{{MARKET_ACCOUNT}}`) | TESTNET | Pool opened after a PASS, trades, C34 custody identity MATCH against real `ft_balance_of` | `evidence/testnet-core7/market-flow-launch2.log`, `evidence/testnet-core7/deploy-market5.log`, `evidence/verify/core7-launch2-PASS-with-market5.txt` | Local build, not reproducible (`artifacts/BUILD-KIND`); not reviewed; fee split is a demonstration value |
| 3 | Instant launcher (`{{LAUNCHER_ACCOUNT}}`) | TESTNET | Instant mode end to end on a 10-second demo clock against the real token factory; `verify.sh instant` exit 0 with CODE MATCH | `evidence/instant-testnet/run2/txlog.jsonl`, `evidence/instant-testnet/run3/real-flow.log`, `evidence/verify/instant-1111-1000000000.txt` | Not on mainnet; local build, not reproducible (`LIMITATIONS.md` limit 10a) |
| 4 | NEAR token factory (`token.primitives.testnet`) | TESTNET | Direct probes: `create_token` cost kept, no `ft_burn`, repeated `storage_deposit` refunded; the instant launcher used it | `evidence/factory-probe.txt`, `evidence/testnet-core3/real-factory-probe.json`, `evidence/instant-testnet/run2/txlog.jsonl` | The trial core's `create_trial` against the real factory was NOT run (`rehearsal/BLOCKED.md` "Core with the REAL factory") |
| 5 | Token factory on the main trial path | MOCK | The core ran against a mock factory | `rehearsal/BLOCKED.md` "Core with the REAL factory"; `SUBMISSION_STATUS.md` section 2 | Real factory only in row 4 |
| 6 | USDC on the main trial path | MOCK | Mock USDC token (play money); the instant run3 has its own mock USDC | `SUBMISSION_STATUS.md` section 2 (core lifecycle row); `LIMITATIONS.md` limit 10a | Real USDC was not used on testnet |
| 7 | NEAR Intents on the testnet path (Solana-delivered commits) | MOCK | Seven of ten commits in core7 launch 1 came through the mock Intents | `evidence/testnet-core7/README.md` (Launch 1) | No Intents testnet exists; no live Intents leg in the judge path (`README.md` "What uses NEAR") |
| 8 | Real `intents.near` wasm in the sandbox | MAINNET-READ-ONLY | One read-only `view_code` fetch of the hash-pinned wasm (step N1), then six sandbox tests run it locally | `evidence/judge-run.txt` (step N1), `tests/tests/real_intents.rs`, `fixtures/intents_near.wasm`, `docs/INVARIANTS.md` (code hash row) | No transaction on mainnet; sandbox hashes cannot be looked up on an explorer |
| 9 | 1Click quote API | MAINNET-READ-ONLY | One dry quote, HTTP 201, no deposit address issued | `evidence/dryquote.txt` | Not evidence of live Intents behaviour or solver latency (`README.md` "Not claimed") |
| 10 | NEAR mainnet RPC `status` | MAINNET-READ-ONLY | Protocol version read on 2026-11-08 (88) | `ARCHITECTURE.md` section 17b | None |
| 11 | NEAR Chain Signatures | TESTNET | The core asked the MPC signer to sign Solana devnet genesis transactions, only for a registered hash; verifier re-checks (21 passed, 7 skipped); tamper-all exit 2 | `evidence/genesis/core7-f0-devnet-launch6.json`, `evidence/verify/core7-launch6-F0.txt`, `evidence/verify/core7-launch6-F0-tamper-all.txt`, `evidence/testnet-core7/gate-g2-core7.txt` | F0 gate cannot itself prove the hash equals the compiled transaction (`LIMITATIONS.md` limit 6); devnet only |
| 12 | Solana devnet programs (mint, Merkle distributor) | TESTNET | Fixed-supply mint with null mint and freeze authority; claim ok | `evidence/genesis/core7-f0-devnet-launch6.json`, `evidence/verify-tamper.txt` (line `PASS C7 mint_authority=None freeze_authority=None`) | Devnet only |
| 13 | Squads reserve vault | TESTNET | Devnet rehearsal | `evidence/genesis/squads-devnet-*.txt` | Single-party demo vault (`HONESTY.md` item 2) |
| 14 | Indexer and neardata block fetch | TESTNET | Folded recorded testnet heights; 136 checks, 0 mismatches (95 core3 and market3, 41 launcher) | `evidence/indexer-testnet/README.md`, `evidence/indexer-testnet/compare-core3-market3.txt`, `evidence/indexer-testnet/compare-instant.txt` | Only heights of recorded transactions, not a full-range tail |
| 15 | Thesis data (public on-chain data via BigQuery snapshots) | MAINNET-READ-ONLY | Committed snapshots pulled 2026-11-08, deterministic rebuild `THESIS OK` | `evidence/thesis.txt` | Data freshness not verified (`docs/INVARIANTS.md`); findings are descriptive, not causal |

## Recorded, not a wire claim

| Item | Why it is not claimed | Evidence |
|---|---|---|
| Test 1 (mainnet, throwaway wallets, owner-run, 2026-11-08) | Thin receipts: one NEAR transaction hash (OV15), none for OV4; OV3 (Phantom byte-exactness) not proven. The repo forbids claiming it | `evidence/test1-ov15.json`, `evidence/test1-ov4.json`, `HONESTY.md` item 17 |

## Not wired

| Item | State | Evidence |
|---|---|---|
| Hosted app against a live wallet | not exercised; Phantom signing unproven | `README.md` "Limits, stated plainly"; `SUBMISSION_STATUS.md` section 2 |
| Meteora DAMM v2 pool | devnet spike partial; PDA-owned position and delegate claim not run | `spikes/meteora/RESULTS.md` |
| Verdict Rail (SAS attestation) | cut | `SUBMISSION_STATUS.md` section 2 "Missing" |
| Mainnet deployment of any Kruxa contract | none | `SUBMISSION_STATUS.md` section 1 |
| Agent module (Agent Economy track) | not built | `evidence/judge-run.txt` track table |
