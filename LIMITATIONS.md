# Limitations

This file is the design-time scope boundary. It does not move with progress; `SUBMISSION_STATUS.md` does. Every gated item names its reason.

## In scope (built for this submission)
- Trial lifecycle on NEAR testnet and in the sandbox: `create_trial` with full parameter and fee-term validation (every rule violation returns its `R_*` code), launch-token creation through a factory with supply verification and recovery, commits from NEAR USDC (`ft_on_transfer`) and from NEAR Intents (`mt_on_transfer`, S3), the S4 parse-and-forward fallback, Walk by NEAR key and by ed25519 signature, creator cancel, a deterministic permissionless `settle`, uniform-price pro-rata settlement with four buckets, lazy per-position settlement, pull-based refunds with callback re-credit, token claims with the 30-day backer-bonus vest, consolidation of Intents proceeds, the launch fee, stream-lite with `STREAM_CAP`, relay-fee payout, dissolve and bond reclaim.
- Controls: $1,000 per launch and $3,000 global caps in USDC with timelocked raises, 2x oversubscription ceiling, per-wallet and holder caps, guardian pause and auto-expiring freeze.
- Verification: `kruxa-sim verdict | settle | verify`, `scripts/verify.sh`, a TypeScript mirror pinned to the Rust hashes, ledger identities L1 and L4 as a view.
- Tests: 50 native unit and property tests in `kruxa-math` and `kruxa-logic` (78 with `kruxa-sim`), 34 sandbox tests (two slow, run by the gate with `--include-ignored`), 7 app tests; fmt and clippy clean. Counts are re-derived from `./scripts/gate-g1.sh` output, not from memory.
- App: landing, create, launch page with Walk, and a no-wallet demo and verification route.
- Everything built so far is testnet and sandbox only. Nothing is on mainnet yet. (CO-3: mainnet is the product target; the Genesis Round and the capped beta are planned behind real gates, see below.)

## Feature-gated (deliberately not built for this scope)
- Real `intents.near` and real token-factory behaviour. Reason: safety and cost. Both are exercised only against mocks; the real-wasm sandbox run and the testnet factory probe are Wave 0 items, and any live Intents call on mainnet needs Dami's per-action confirmation.
- Solana genesis (G key, transaction compiler, Merkle tree, Jito distributor, Squads reserve, claim page). Reason: time (Wave 2), and no Solana mint may be created for a trial that did not pass; interface and sequence are specified.
- Market-lite (CO-3): scope M-A is planned pre-freeze behind the M-gate (Nov 11 EOD); until it is green, fee terms are committed in the Charter but inert and the README says so. Still out of scope before the freeze: Hold Vault, referral lots, ratchets, creator epochs beyond one recipient, opening-fee surcharge above base. Reason: scope; Market-lite is new unreviewed code.
- Creator-allocation vesting and the LP token bucket distribution. Reason: scope. In Wave 1 those token buckets stay in core with no claim path.
- Verdict Rail (SAS attestation) and F0 Chain Signatures minting. Reason: time and an unrun dust test; both need Dami's per-action go for the signed tests.
- Async solvency anchor (`check_solvency` / `reconcile_intents` against `mt_balance_of`). Reason: needs two global counters maintained at every mutation; scheduled right after the Wave 1 gate. `get_invariants` covers the stored counters only.
- In-claim token registration, `claim_refund_batch`, `claim_orphan_credit`, burn of a failed launch's token (`burn_mode`). Reason: scope and an unanswered `ft_burn` probe; refunds and claims work without them.
- Own immutable FT published by hash. Reason: cost, not approved (RULING 2026-11-07). Every launch uses the factory token, whose publisher can replace its code.
- Trusted relayer credit (S1). Reason: it gives one party the power to credit anyone; built only if S3 and S4 both fail and Dami agrees.
- Upgrade multisig and 7-day timelock. Reason: time; Wave 1 has no upgrade path and testnet keys are builder-held (phase P0, disclosed).
- Gas and storage benchmarks. Reason: time; gas constants are estimates that the sandbox suite passes with, and the 330-byte position estimate is unmeasured.
- Reproducible wasm build. Reason: needs Docker and the exact image tag, which the first run prints.
- Browser verification of the app and wallet popups. Reason: not exercised in this phase; `next build` and `tsc` pass.
- Sybil resistance. Reason: out of reach by design; no claim is made. `min_funders` counts accounts, not people.
- The wasm exceeds the 350 KB budget of S1-A (462,222 bytes). Reason: `serde_json::Value` views; typed views are the lever. The contract's own storage stake is about 4.57 NEAR, locked not spent.
- Independent review before real user funds. Reason: cost and time; the gap is disclosed, and the first mainnet token must be the brand token. CO-3: this now also covers Market-lite.

## Added by CHANGE-ORDER-3 (2026-11-08)
- Gated, not built yet: the creator gate (D-1), the `open_market` handoff (D-3), Market-lite, the indexer and charts, the wallet layer, the Meteora spike and venue builder, the Launch Check API and guard, the backer agent, the swarm simulator. Reason: scheduled in PLAN Part CO-3; each is claimed only when green.
- Tier C (not planned unless capacity is freed): keeper business ledger, Survivor Pass. Reason: the budget is full (CO-3: 15.35 demand against 15.2 usable; CO-4: 20.50 against 19.40). The thesis pack was promoted by CO-4 to a conditional tier B module (see the CO-5 section below).
- Dropped tracks: privacy, realworld, games, social. Reason: no honest module (PRD 1.6).
- After Nov 14 whatever happens: the Solana LP-seed release and Meteora pool for $KRUXA unless the trial opens by about Nov 11 18:00 UTC; third-party trials opened Nov 13 or later; Hold Vault, referral payouts, ratchets, the payout-change flow, per-chain payouts, DBC, independent review and any cap increase. Reason: 24 h window plus 1 h tail plus the kept 48 h lock.
- Cross-chain trading of a launched token is not possible (no Intents quote for new tokens). Solana-only creators are out of scope. Solana-side creator fee income is zero.
- The Launch Check guard is a client-side policy gate: NEAR function-call keys cannot attach the 1 yoctoNEAR that `ft_transfer_call` needs.
- No revenue claim: the launch fee on PASS ($15 at a $1,000 raise) is demonstration revenue; break-even would need $40M monthly volume at a 0.20% platform share and about $53.3M at the ruled 0.15% share (fee split 50/15/15/10/10, DN-15).
- Protocol: mainnet reports protocol 88 [VERIFIED 2026-11-08], so the old "protocol 87" limitation is removed; real-network wasm acceptance is still unproven until the testnet deploy.

## Added by CHANGE-ORDER-5 (2026-11-08, doc-sync) and CHANGE-ORDER-4 folds
- Upgrade authorities of Meteora DAMM v2, Raydium CPMM and Orca Whirlpools are unverified (single key or multisig unknown) [UNVERIFIED]. Whichever Solana venue is used, its upgrade risk is disclosed and not claimed away. DexScreener and GeckoTerminal auto-listing of a new pool is unconfirmed [UNVERIFIED].
- A position owned by a PDA or a Squads vault claiming fees is untested until the devnet spike (DM-3) runs [UNVERIFIED]. DAMM v2 has no built-in platform/creator fee split and no anti-sniper rate limiter, so Kruxa does the split itself and relies on the decaying base-fee scheduler only. Meteora DBC stays off unless four checks pass.
- Round one has no Solana pool: 100% of the LP seed goes to Kruxa's NEAR pool (DN-14 RULED); any Solana pool is later and may land after Nov 14.
- Single-party vault disclosure: for the demo and the Genesis Round Dami holds all three Squads keys on separate hardware wallets (disclosed single-party). Third-party creators open only after two named independent signers join (Dami: "when we get there").
- Test 1 has not been run: the Intents credit (OV4) and `ft_withdraw` to Solana (OV15) are unproven live, and live byte-exact Phantom signing is unproven. Test 1 is partly funded (T1 SOL 0.005, T1 NEAR 0.02 on 2026-11-08, target 0.15 NEAR) and Dami runs every money-moving step himself; if it is not run by Nov 10 12:00 every Solana-landing claim is dropped.
- Agents track: model-driven agents use `Qwen/Qwen3.8-27B` on NEAR AI Cloud; a TEE signature is claimed only at the level actually reached (L0, L1 or L2, INVARIANTS 12), instances of one model share a signing key, and a live key run is [UNVERIFIED] until Dami supplies the key. Scripted agents are labelled SCRIPTED and replayed runs RECORDED. The agent vault is testnet only, unreviewed, and its key allowance can be exhausted (the owner rotates it). No hiring, no x402 earnings, no "agent economy" claim.
- Security track: the 100-attack gallery (sandbox only, not run on testnet yet) and the injection harness are our own red team; the Launch Check uses Kruxa's own recomputable facts, not threat intelligence; the guard is a client gate and the vault is the on-chain gate; the measured block rate covers 12 payloads and one model only.
- Swarms track: 20 agents of which 9 are adversaries written by us; sybil splitting and walk-to-flip are bounded, not blocked; pooled uniform price, not sealed-bid; no sellers; model decisions are replayed offline; no "emergent economy" claim.
- Thesis track (conditional): BigQuery freshness is [UNVERIFIED] (NEAR Lake deprecated 2026-03-24); credentials are Dami's (never in chat); dropped at Nov 10 12:00 UTC if the freshness check or the JWT fails; correlation is not causation. Business stays tier C and nfts is first stretch, both default not listed.
- Fee split 50/15/15/10/10 (RULED): creator-controlled extraction bound is 75% at the default and 80% at the contract bound; Hold Vault and referral payouts are later, so until then the holder slice goes to LP and the referral slice returns to LP.
- Wave 1 constants changed by delta D-4 (platform share 1_500; standard preset 5_000/1_500/1_500/1_000/1_000) are compiled in the current wasm (462,222 bytes); the testnet hash comparison waits for the deploy (W1-DC-13).
- Pending recommendations, not rulings: DN-26 to DN-32 (CO-4 section 16). Nothing here treats them as decided.

## Added by Phase 1 (2026-11-08, build agent)
- Not closed by G1, carried by name: W1-DC-8 (S3 against the REAL `intents.near` wasm; only the mock Verifier ran), W1-DC-12 (factory cost, `ft_burn`, benchmarks), W1-DC-13 (reproducible wasm and testnet `view_code` hash), W1-DC-15 (D-1 creator gate) and W1-DC-16 (D-3 `open_market`). Reason: scheduled in Phase 2 and PLAN C3.6 A-2/A-3.
- L6 Intents liability (`credited_intents <= mt_balance_of`) is not in `get_invariants`: it needs an async call to `intents.near` (ARCHITECTURE 5.6, Wave 1b). Not claimed.
- I4 is checked as a snapshot property (status agrees with the settlement record) plus a legal-move check in the sandbox harness; the contract keeps no transition history on chain.
- FROZEN 7-day auto-expiry is tested as the pure function `pause_at` that the contract calls (boundary at `frozen_until - 1` and `frozen_until`), not with a 7-day sandbox fast-forward. Tried 2026-11-08: `Worker::fast_forward(100_000)` had not returned after more than 4 minutes in this sandbox, so 7 days of blocks (several hundred thousand) is not practical; the attempt was killed. Closing it would need a state patch of `frozen_until`, which couples the test to the Borsh layout of the config.
- The real $3,000 global cap IS exercised: `global_cap_refuses_at_the_real_three_thousand_dollars` (slow, ignored by default, run by the gate) fills two launches to exactly $3,000 and sees `R_CAP_GLOBAL`.
- Not built: `kruxa-sim explain`, `claim_refund_batch`, `claim_orphan_credit`, in-claim token registration, `burn_mode`.
- Per-launch cap wording: the ruled $1,000 per launch is enforced as `R_HARD_CAP` (hard cap above $1,000) while `R_CAP_LAUNCH` fires at 2x the hard cap (custody), so one launch can hold up to $2,000 in escrow; the $3,000 global cap bounds all launches. The oversubscription ceiling is open item DN-2.
- The cap-raise timelock is 7 days; the 48 h timelock in the rulings belongs to the Solana reserve vault (Phase 4), not to the core contract.
- Wasm size is 462,222 bytes after Phase 1 additions (budget in the lint script 600,000; the 350 KB target of DT-X2 is still exceeded).
