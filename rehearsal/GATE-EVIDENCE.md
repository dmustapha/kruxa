# Gate evidence (read by scripts/gate-g3.sh; one line per row: | GR-n | PASS/FAIL/WAIVED | time | detail |)

| GR-2 | PASS | 2026-11-10T01:00Z | scripts/gate-g2.sh GREEN 9 of 9 on core3.kxi-root-1108.testnet (evidence/testnet-core3/gate-g2.txt); verify exit 0, tamper-all exit 2, dead RPC exit 4, FAIL launch prints the no-mint line. G2-01 read the logs of the NAMED gate tests only (not the full gate-g1 suite) |
| GR-12 | PASS | 2026-11-10T02:00Z | F0 through the core gate (register_f0_message, sign_genesis, predecessor = core3) ran 3 of 3 on devnet: launches 2, 5, 6 (evidence/genesis/core3-f0-devnet-launch2, 5, 6; verify exit 0; C27 derive(core3, kruxa:genesis:N)). F1 also run once: launch 4 |
| GR-16 | PASS | 2026-11-10T01:00Z | market3.kxi-root-1108.testnet opened for launches 4 and 6 through core open_market; buy, claim_owed, buy, sell; pool and market invariants true (evidence/testnet-core3/txlog.jsonl, market-flows.json) |
| GR-2 | PASS | 2026-11-10T02:40Z | round 2, final wasm: scripts/gate-g2.sh GREEN 9 of 9 on core3.kxi-root-1108.testnet with code sha256 e338f84d... (evidence/testnet-core3/gate-g2-round2.txt). PASS launch 8 (F0): verify exit 0 (21 passed, CODE line MATCH), tamper-all exit 2 (19 MISMATCH lines), FAIL launch 3 prints the no-mint line. G2-01 reads the Nov 8 gate-g1 logs (sandbox suites NOT re-run on this wasm; machine is shared) |
| GR-12 | PASS | 2026-11-10T02:40Z | round 2: F0 on the final core wasm (e338f84d, create_token 110 Tgas): launch 8, register_f0_message + sign_genesis x2 (predecessor core3), mint FrurXVLrLdThUL6ixS2qrtFyr1VSHpvdivmHutMhQG25, tx1 5p8T9kXCMkdB7q2q8w7uhF1qZGkUfc3SwEEcBWksWe6GfoyKfQLCPq98Qv1TxYLFhNWWUi4dgdcjzinnaBrh8Yic, tx2 64hqHybmxJYsqc9QejVbrX9je4w1SGZVHevqRqg4RcrwLwNCKyoqat8gEvtS2YAvbBP5k3QJRHMPMYgdhfdSZRvT, claim ok, verify exit 0. Earlier 3 of 3 F0 runs were on wasm 7d7b0da2 |
| GR-2 | PASS | 2026-11-10T19:25Z | round 3, the deployed wasm e85198ed: scripts/gate-g2.sh GREEN 9 of 9 on core3.kxi-root-1108.testnet with PASS launch 9 and FAIL launch 3 (evidence/testnet-core3/gate-g2-round3.txt). Attempt 1 had one G2-04 infrastructure error (TLS handshake timeout, exit 4, no verdict); the same command was rerun once and all 9 passed. G2-01 read the logs of the full gate-g1 run on the final tree (14 of 14, 322 sandbox tests) |
| GR-12 | PASS | 2026-11-10T19:25Z | round 3: F0 on the exact deployed wasm (e85198ed) through the core gate, launch 9, mint 7unMFFxMcyMrQa75D3WJUW8qqV4QPE9naj4uCo4NMgf5, verify exit 0, tamper-all exit 2 (evidence/genesis/core3-f0-devnet-launch9.json, rehearsal/ROUND3.md) |
| GR-2 | PASS | 2026-11-10T22:00Z | round 4, the REPRODUCIBLE wasm 665caab5 deployed on core3.kxi-root-1108.testnet (view_code sha256 665caab5a582a58b2412dfb2e81f1caf2ff94339c8bcc9f8be9ebebb72239c64, deploy tx Gu5Msp6rduKg6XZ8RFNbMeT6s2aKM2Tcvmp7GNTgWvza): scripts/gate-g2.sh GREEN 9 of 9 with PASS launch 10 and FAIL launch 3 (evidence/testnet-core3/gate-g2-round4.txt); verify.sh 10 exit 0 (CODE line MATCH 665caab5), tamper-all exit 2 (19 MISMATCH). The shared RPC throttled (HTTP 429): two earlier verify attempts (both exit 4) are kept next to the passing one, and the passing runs went through a local retry proxy to the same RPC. G2-01 read the existing gate-g1 logs |
| GR-12 | PASS | 2026-11-10T22:00Z | round 4: F0 on the reproducible wasm 665caab5 through the core gate, launch 10, mint 6MMpWcv7vnpc9ZFKJoykK8dnMAmSzkKfYqHzNf4GRZqC, tx1 44XqjTqYkzwA2D6EsqLScZfK9LvLKh1oDseGH1o4L5CqaZYgCtgZw6hCBbE2iZSyiQUBZiAW282uJ9R2Ud8G8Wzg, tx2 3RTQY8GvNQPGdHuiQCid8xChZnZx4KB6CGhFzBNB1m4kqoKdhUG4iTrXL5gNZqaWe7vLceyi7jrpsW1st4BhbeVo, claim ok. First tx2 attempt failed on an expired blockhash (RPC throttling); recovered with abort_genesis (guardian) and reopen_genesis (owner) and a resume, so this run is a PASS with one reopen (evidence/genesis/core3-f0-devnet-launch10.log and the attempt logs, rehearsal/ROUND4.md) |
| GR-2 | PASS | 2026-11-12T05:40Z | round 5, the FINAL reproducible wasm c55bffdb (commit 5c2874d, dissolve-after-walk) on core7.kxi-root-1108.testnet (view_code sha256 c55bffdbdec7909464c65511219ec77be7d8f765bc037a46350efe713cb8b13b, deploy tx y6hSbC7rdmYo3tYjpWoqDaUuJwmfXx2d22ukEYoCSC5): scripts/gate-g2.sh GREEN 9 of 9 with PASS launch 6 (F0) and FAIL launch 1 (evidence/testnet-core7/gate-g2-core7.txt). verify.sh 6 exit 0 (21 passed, 7 skipped, CODE line MATCH c55bffdb), tamper-all exit 2 (38 MISMATCH lines, none undetected) (evidence/verify/core7-launch6-F0.txt, core7-launch6-F0-tamper-all.txt). G2-01 read the full gate-g1 logs of the same day (324 sandbox tests ok) |
| GR-12 | PASS | 2026-11-12T05:40Z | round 5: F0 on the final wasm c55bffdb through the core gate (commit_genesis, register_f0_message x2, sign_genesis x2, predecessor = core7), launch 6 (KXDS, 12 Solana buyers, 360 USDC), signatures verified offline before broadcast, confirm_genesis ok, Merkle root matches the core, claim ok, distributor admin NULL (evidence/genesis/core7-f0-devnet-launch6.json and .log; first attempt of the driver failed before sending anything for a missing tools/squads npm install, log kept). One F0 on the final hash; the 3 of 3 rule was met on earlier hashes (launches 2, 5, 6, 8, 9, 10 on core3) |
| GR-10 | PASS | 2026-11-14T04:10Z | OWNER RULING (Dami, in chat, 2026-11-14): the Nov 11 18:00 UTC open-by timing is dropped; the plan is to complete every remaining build item and every blocker first, then logo, X posts and description, a launch in the evening and submission before the deadline. Recorded by the agent from his words; this row replaces the clock check and says nothing about GR-7, GR-14 or GR-17, which stay open |
| GR-16 | PASS | 2026-11-12T05:40Z | market5.kxi-root-1108.testnet (linked to core7 by set_market) opened for launch 2 through core open_market; buy, claim_owed, buy, sell; pool and market invariants true, usdc_custody equals usdc_expected 436170725 (evidence/testnet-core7/market-flow-launch2.log); C34 MATCH in verify.sh 2 and 6 |

## FG-07 refresh of the gate-g3 result (2026-11-11T17:48Z, tree 402423f, read-only run, no FREEZE row written)

Command: `./scripts/gate-g3.sh` (read-only; `gate-freeze.sh candidate` was NOT run because it appends a row to rehearsal/LOG.md). The sandbox and native
logs it read are the Nov 10 `target/gate-g1` logs (322 sandbox tests ok), which predate the dissolve-after-walk core change merged on Nov 11; they
must be regenerated on the new reproducible wasm before the freeze (FG-24, run by the coordinator). Rows below are a table of the run, not gate rows
(first cell starts with "row" so gate-g3.sh does not parse them).

| Row | Kind | State | Blocker, what remains | Who |
|---|---|---|---|---|
| row GR-1 | HARD | PASS | stale logs: rerun `scripts/gate-g1.sh` (or the suite with `KXI_CORE_WASM`) on the new core build | automatable (sandbox only, no funds) |
| row GR-2 | HARD | PASS on 665caab5 | the new core must be redeployed and `gate-g2.sh` rerun on it; that signs testnet transactions | testnet keys: coordinator or Dami, not this agent |
| row GR-3 | WAIVABLE | UNKNOWN | Test 1 is RECORDED but thin (only the OV15 hash). Decide: accept it or drop the Solana-landing claims (README edit, then one evidence line) | Dami decides; the README edit is automatable after the ruling |
| row GR-4 | HARD | PASS | none | none |
| row GR-5 | HARD | PASS | rerun with GR-1 | automatable |
| row GR-6 | HARD | PASS | rerun with GR-1 | automatable |
| row GR-7 | HARD | UNKNOWN | devnet rehearsal exists (evidence/genesis/squads-devnet-*.txt, single-party vault); the 3 hardware wallets and a line in this file are missing | Dami only |
| row GR-8 | HARD | UNKNOWN | the seven disclosures are in `app/app/charter/page.tsx` but nothing is published: needs hosting and the domain | Dami only (hosting accounts); a check that the seven items are in the built page is automatable |
| row GR-9 | HARD | UNKNOWN | legal pages exist in `app/app/legal`; counsel review (P-14) | Dami only |
| row GR-10 | HARD | PASS, 12 minutes of margin | the open-by limit is Nov 11 18:00 UTC; this run was at 17:48Z, so the row turns FAIL at 18:00Z unless Dami rules the limit | Dami (ruling) |
| row GR-11 | HARD | PENDING | per-step confirmations at execution | Dami only |
| row GR-12 | HARD | PASS on 665caab5 | F0 was never run on the new wasm; either accept or rerun one F0 (signs devnet and testnet txs) | Dami or coordinator |
| row GR-13 | WAIVABLE | UNKNOWN | `spikes/meteora/RESULTS.md` is [REHEARSED-LOCAL] with every devnet check [UNVERIFIED]: needs devnet SOL and signatures, or a Dami waiver with the consequence "NEAR pool only for round one" | Dami only (funds and signing) |
| row GR-14 | HARD | UNKNOWN | the FREEZE row (`gate-freeze.sh freeze`) for the NEW reproducible hash; the 665caab5 hash is superseded | Dami only |
| row GR-15 | HARD | PASS | rerun with GR-1 | automatable |
| row GR-16 | WAIVABLE | PASS | none | none |
| row GR-17 | HARD | UNKNOWN | brand-token supply and allocation, USDC payout address, pool and LP-seed amounts | Dami only |
| row GR-18 | WAIVABLE | PASS | rerun with GR-1 | automatable |

Result: NO-GO (blocked by GR-3 GR-7 GR-8 GR-9 GR-11 GR-13 GR-14 GR-17). Nothing in the blocked list can be closed by an agent without funds, signing,
hosting or a ruling. Full output: `evidence/testnet-core3/gate-g3-2026-11-11.txt`.

## Refresh on the final build c55bffdb (2026-11-12T05:45Z, read-only gate-g3 run, no FREEZE row written)

`./scripts/gate-g3.sh` read the same-day gate-g1 logs (324 sandbox tests ok) and the GR-2, GR-12 and GR-16 rows added above. Full output:
`evidence/testnet-core7/gate-g3-final.txt`. Rows below are a table of the run, not gate rows.

| Row | Kind | State | What remains | Who |
|---|---|---|---|---|
| row GR-1 2 4 5 6 12 15 16 18 | HARD or WAIVABLE | PASS | none | none |
| row GR-3 | WAIVABLE | UNKNOWN | accept thin Test 1 or drop the Solana-landing claims | Dami |
| row GR-7 | HARD | UNKNOWN | 3 hardware wallets, 48 h lock rehearsal line | Dami only |
| row GR-8 | HARD | UNKNOWN | hosting and domain for the seven disclosures | Dami only |
| row GR-9 | HARD | UNKNOWN | counsel review | Dami only |
| row GR-10 | HARD | FAIL | the Nov 11 18:00 UTC open-by limit has passed; needs a ruling | Dami |
| row GR-11 | HARD | PENDING | per-step confirmations at execution | Dami only |
| row GR-13 | WAIVABLE | UNKNOWN | devnet SOL and signatures for the Meteora checks, or a waiver | Dami only |
| row GR-14 | HARD | UNKNOWN | the FREEZE row for `c55bffdb...` | Dami only |
| row GR-17 | HARD | UNKNOWN | brand-token numbers, payout address, pool and LP-seed amounts | Dami only |

Result: NO-GO (blocked by GR-3 GR-7 GR-8 GR-9 GR-10 GR-11 GR-13 GR-14 GR-17).
