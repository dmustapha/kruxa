# Limitations

Current as of 2026-11-10 (docs-sync after the final core build). This file lists what Kruxa does not do and the honest limits of what it does. `SUBMISSION_STATUS.md` tracks progress; `PROOF-DEBTS.md` tracks unproven items. Every limit names its reason or its file.

## 1. Honest limits that exist now

These are properties of the code and evidence as they stand. None of them is hidden in the README, the app copy or the video.

1. **Owner key and the upgrade queue.** The owner holds one full-access key on the testnet core (the `KEYS` line of `verify.sh`). The core has a public 7-day upgrade queue (`queue_upgrade`, guardian `cancel_upgrade`, owner `upgrade_core`), but a full-access key can redeploy at once and bypass the queue. The queue is a public commitment, not a technical barrier, until that key is deleted or replaced by a multisig. No immutability claim is made. On the `demo` profile (the testnet core3) the queue delay is 60 seconds, not 7 days. Files: `contracts/core/src/govern.rs`, `extra.rs`; `evidence/testnet-core3/verify-8-f0.txt` (KEYS line).
2. **`halt_launch`.** The owner or the guardian can halt one launch: new commits, `consolidate`, `pay_launch_fee`, `draw` and `open_market` refuse with `R_HALTED`. A halt cannot block Walk, refunds, token claims or the verdict, so it can only push a launch toward FAIL, never trap money. The owner can resume. It is a trust power over launches and is disclosed as one.
3. **`force_resolve_op` (48 hours).** The owner can resolve one stuck outbound leg whose callback never ran, in two steps with the same arguments 48 hours apart (60 seconds on the `demo` profile). It can move only what is in flight, to no new destination, and never touches a verdict. Token legs cannot be resolved this way. It is still an owner power over money in flight.
4. **The solvency report is informational.** `check_solvency` and `reconcile_intents` compare USDC and Intents balances with running liability counters. The only effect is `intents_alert`, which refuses NEW Intents commits; it can never pause exits. The two balance reads can race a refund or a consolidation; a leg in flight across both snapshots can read as short until the next check. It is a reading, not a proof of solvency. One check per 30 seconds.
5. **`burn_mode` is `Hold` by default.** The factory token has no `ft_burn` (`evidence/factory-probe.txt`), so `Burn` is refused (`R_BURN_UNSUPPORTED`). Under `Hold`, `sweep_tokens` only counts unclaimed supply as swept; the tokens stay in the core. A `Sink` account may be set once by the owner and may not be a Kruxa-controlled account. Nothing is burned.
6. **The F0 gate cannot prove the registered hash equals the compiled transaction.** `register_f0_message` plus `sign_genesis` make the MPC signer sign only a message whose sha256 equals a hash the relayer registered in public, once, on the fixed path `kruxa:genesis:<id>`. Whether that hash is the sha256 of `compile(spec, blockhash, price)` is checked by `verify.sh` C17, not by the contract. A malicious relayer could register a different hash; C17 would print MISMATCH.
7. **The core is NOT independently audited.** The attack gallery (100 attacks, 81 refused with a rule code, 14 ran with no effect, 5 bounded, 0 failed, 10 not done) is our own red team on a sandbox, with sandbox hashes that cannot be looked up on an explorer. It is not an audit.
8. **Mainnet is not deployed.** Nothing Kruxa-owned is on mainnet. Every mainnet step needs Dami's per-action confirmation. The first mainnet token must be the brand token.
9. **The testnet core is a local, non-reproducible build.** `core3.kxi-root-1108.testnet` runs sha256 `e85198ed37c2aa1d6cd5f18571f5e023eed391108ca8f22edc8599ac390e65ac` (675,007 bytes, local `cargo near` build, equal to `artifacts/SHA256SUMS`). The reproducible build candidate is a different binary (`d362ffa2e37a85158eb43ebba34b7418a5b1b5f3bf77044b97d5879a88326f5f`, 655,251 bytes, built before the `R_GAS` guard). Anyone who rebuilds in the container gets the candidate, not the deployed hash, so the `CODE` line of `verify.sh` matches only against the local-build hash. Market and launcher have no reproducible build metadata.
10. **Some verify checks skip on plain RPC (as named by the latest outputs).** `evidence/testnet-core3/verify-8-f0.txt` (F0) passes 21 and skips 7: C12 (needs `--charter`), C28 (needs `--rpc2`), C10 (needs the hosted metadata JSON), C22 (no creator allocation in the record), C23 (plain RPC cannot enumerate a contract's events), C25 (no Verdict Rail attestation), C30 (FAIL-path check on a PASS launch). `verify-4-f1.txt` (F1) passes 20 and skips 8: the same seven plus C27 (no derived key in an F1 record). Checks C33 and C34 (solvency views) have no live transcript.
11. **F0 rehearsal wasm.** Three F0 rehearsals ran through the contract gate on wasm `7d7b0da2...` (launches 2, 5, 6) and a fourth on `e338f84d...` (launch 8). The deployed wasm `e85198ed...` adds only the `R_GAS` guard to `create_trial`, but no F0 run exists on that exact binary.
12. **Test 1 receipts are thin.** `evidence/test1-ov4.json` and `evidence/test1-ov15.json` are transcriptions of the result Dami recorded on 2026-11-08, labelled RECORDED. Only the OV15 NEAR transaction hash (`3KLVemdjr387BsqJiuuV9By9VXzeri6GRFwy3HMRT6ko`) was ever recorded; the two OV4 credits have no transaction hashes in the repo. OV15 moved 60,000 micro-USDC and 30,000 landed (the bridge fee is a fixed 0.03 USDC). OV4 is a claim without an on-chain receipt. Phantom `signMessage` byte-exactness (OV3) is unproven. One swap stalled about 35 minutes before it completed; the latency tail is disclosed.
13. **State layout.** The final wasm cannot read state written by core2; core3 is a fresh `new` deploy. `migrate` is the identity. A migration from core2 was not attempted. Any future layout change needs its own `migrate`, shipped through the queue.
14. **Solana claim rent.** The earlier design had a buyer-funded 0.004 SOL deposit. It is not implemented. The buyer's relay fee, taken from the commit amount, is the buyer-funded claim cost; the relayer's funder account pays Solana-side rent (`relayer/src/claim.ts`, as read by the 2026-11-09 audit; not re-checked in this sync).
15. **Judge run record.** Only the fast subset is committed (`evidence/judge-fast-run.txt`: 19 of 19 steps, 553 s). The full run (about 2,454 s, not under 300 s) has no committed record yet; it must be run with `--record` before submission.
16. **FROZEN 7-day auto-expiry** is tested as the pure function `pause_at`, not with a 7-day sandbox fast-forward (impractical: 100,000 blocks did not finish in 4 minutes).
17. **The gate is not green.** `evidence/testnet-core3/gate-g3.txt` last recorded NO-GO with blockers GR-3, 7, 8, 9, 11, 13, 14 and 17: items that need Dami (hardware wallets and Squads signers, legal minimum, GR-17 numbers) or a record that does not exist yet.

## 2. What is built

- Trial lifecycle on NEAR testnet and in the sandbox: `create_trial` with full validation (every rule violation returns its `R_*` code), factory token creation with supply verification and recovery, commits from NEAR USDC and from NEAR Intents (S3), the S4 fallback, Walk by key and by ed25519 signature, a promise-free `settle`, refunds, token claims with in-claim registration, consolidation, launch fee, capped stream (`STREAM_CAP`) and `lengthen_stream`.
- Controls: $1,000 per launch and $3,000 global caps in USDC with 7-day timelocked raises, guardian pause and auto-expiring freeze, halt per launch, creator gate, solvency anchor.
- Solana genesis: F1 and F0 ceremonies, Merkle distributor, Squads reserve, all on devnet with committed evidence. F0 signs through the contract gate.
- Market-lite (market ABI 1.1.2) and the instant launcher (`contracts/instant`), both run on NEAR testnet. Neither is on mainnet.
- Verification: `kruxa-sim`, `scripts/verify.sh` (exit 0 MATCH, 2 MISMATCH, 3 pending, 4 infrastructure, 64 usage, 65 refused parameters in `validate`), a TypeScript mirror pinned to the Rust hashes, the attack gallery, the swarm simulator, `make sim`, `make tour`.
- App: the routes of `APP-SPEC.md` (no `/demo`, no `/proof`), wallet layer, docs pages, `llms.txt`, `AGENTS.md`. The app has not been exercised against a real wallet.

## 3. Not built (and why)

- Hold Vault, referral lots, ratchets, payees (market M-B). Reason: scope, after Nov 14 by ruling. Until then the holder slice and the referral slice go to LP.
- Verdict Rail (SAS attestation). Reason: stretch, needs Dami's key; check C25 always skips.
- Typed views. Reason: tried, saved about 400 bytes; the core still uses `serde_json::Value` views. The wasm is 675,007 bytes against the 700,000 byte budget (Dami, 2026-11-10; supersedes the 570 KB of D-13); about 6.8 NEAR of storage stake is locked.
- Own immutable FT published by hash. Reason: cost, not approved (RULING 2026-11-07). Every launch token is a factory token whose publisher can replace its code.
- Trusted relayer credit (S1). Reason: it gives one party the power to credit anyone; not built.
- Multisig upgrade authority for the core. Reason: time; the queue exists, the key does not change.
- Burn of a failed launch's token. Reason: the factory token has no `ft_burn`.
- Sybil resistance. Reason: out of reach by design; `min_funders` counts accounts, not people. No claim is made.
- `kruxa-sim explain`; a keeper service. Reason: scope.
- Independent review before real user funds. Reason: cost and time; disclosed.
- Dropped tracks: privacy, realworld, games, social (no honest module). Cut by CO-6 E-2: agents (agentkit, agent vault, Launch Check, guard), the `/swarm` page. Not started: business, nfts.

## 4. Gated by Dami or by an external party

- Mainnet deployment, the Genesis Round, the capped beta, the X post, repo publication and the one-shot submission: each needs Dami's per-action confirmation. See `SUBMISSION_STATUS.md` for the list.
- Two named independent Squads signers (BLK-1) before third-party creators open; for the demo and the Genesis Round Dami holds all three keys on separate hardware wallets (disclosed single-party).
- Legal counsel review of the legal pages (they were written by an agent).
- Real-wallet tests: PD-1, PD-2 (Phantom byte-exactness), PD-3 (Solflare and Backpack), PD-5.

## 5. Venue, market and economics limits

- Upgrade authorities of Meteora DAMM v2, Raydium CPMM and Orca Whirlpools are unverified [UNVERIFIED]. DexScreener and GeckoTerminal auto-listing of a new pool is unconfirmed [UNVERIFIED].
- The Meteora DAMM v2 spike ran on devnet (`spikes/meteora/RESULTS.md`). Not run: a position owned by a PDA of Kruxa's own program, a delegate claiming fees, DBC checks. DAMM v2 has no built-in creator and platform fee split and no anti-sniper rate limiter, so Kruxa splits itself and relies on the decaying base-fee scheduler. The protocol takes 20 percent first.
- Round one has no Solana pool: 100 percent of the LP seed goes to Kruxa's NEAR pool (DN-14 RULED). Any Solana pool is later and may land after Nov 14.
- Fee split 50/15/15/10/10 (RULED): the creator-controlled extraction bound is 75 percent at the default and 80 percent at the contract bound; until the Hold Vault and referral payouts ship, the holder slice goes to LP and the referral slice returns to LP.
- Per-launch cap wording: the ruled $1,000 per launch is enforced as `R_HARD_CAP` while `R_CAP_LAUNCH` fires at 2x the hard cap (custody), so one launch can hold up to $2,000 in escrow; the $3,000 global cap bounds all launches.
- Cross-chain trading of a launched token is not possible (no Intents quote for new tokens). Solana-only creators are out of scope; Solana-side creator fee income is zero.
- No revenue claim: the launch fee on PASS ($15 at a $1,000 raise) is demonstration revenue.
- Intents solver latency tail (one swap about 35 minutes). Funds were safe. Seen once.
- The launch-token factory token is publisher-updatable. The Intents Verifier holds force-withdraw and lock powers over money held in `intents.near`.
- Protocol: mainnet reports protocol 88 [VERIFIED 2026-11-08]; real-network acceptance of the final wasm on mainnet is untested.

## 6. Track claims (per-track limits)

- memecoins: `make sim` prints `BOUND OK` (`evidence/sim.txt`); the opening-fee sentence is allowed because `make market-demo` shows two `fee_bps_applied` values (`evidence/market.txt`). Testnet only.
- security: the gallery is our own red team on a sandbox, covers core, genesis, market and launcher, and is not an audit. The injection harness, Launch Check and guard are not built; no block-rate or injection figure is claimed.
- swarms: 16 agents, 7 scripted and 9 adversaries written by us; no model-driven agents; sybil splitting and walk-to-flip are bounded, not blocked; pooled uniform price; no "emergent economy" claim.
- defi: the dry quote is read-only (`evidence/dryquote.txt`); the cross-chain claim rests on the thin Test 1 record above; OV3 unproven.
- thesis (conditional): BigQuery freshness [UNVERIFIED]; correlation is not causation; dropped if credentials are unusable.
- agents: CUT. Nothing is built.

## 7. Process limits

- Judge path (CO-6 E-3): `make judge` runs a narrated lifecycle subset; the full run is long. The no-Docker path uses committed prebuilt binaries; the Nov 11 clean-container run is not recorded.
- Operator key (CO-6 E-5): with the phase-0 full-access key present `verify.sh` prints the key and discloses that the owner can redeploy the contract.
- Rust toolchain: the machine default is 1.91.1; 1.95.0 is required (near-sdk 5.30.1).
- Counts such as test totals are re-derived from commands (`./scripts/gate-g1.sh`, grep), not from memory; the last committed gate-g1 logs predate the final core and must be re-run at the freeze.

See `PROOF-DEBTS.md` for the tracked list of unproven items, each with an owner and a status.
