# Architecture Decision Records

Each ADR records a choice already made during PRD and architecture work. The Rejected field names the alternative that was declined and the concrete reason. Authority order for conflicts: DECISIONS-PACK1 rulings (live copy, through 2026-11-08), then `specs/RECONCILED-INTERFACE.md`, then W0, then S1-A..S1-D. Code references are to the Wave 1 files embedded in `ARCHITECTURE.md` Section 4.

## ADR-001: Pure arithmetic and rules in crates that import nothing from the chain
- Context: the money math, the verdict and the allocation must run in the contract, in the simulator, in the verifier and (as a mirror) in a browser, and a judge must be able to recompute them. near-sdk 5.30 refuses native builds, so contract code cannot be unit-tested natively.
- Decision: `kruxa-math` (U256 mul_div, linear unlock) and `kruxa-logic` (rules, verdict, allocation, settlement, hashes, ledger identities) take only integers and byte strings. The contract, `kruxa-sim` and the sandbox tests depend on them; they depend on nothing outward. The `kruxa-types` crate of RECONCILED 2.1 is folded into `kruxa-logic::rules` because Charter structs need `AccountId` and so live in the contract, while everything numeric is account-free.
- Rejected: one contract crate with the logic inline. It could only be tested through the 40-second sandbox, so rounding and boundary bugs would be found slowly, and the simulator could not share the code. Also rejected: a separate `kruxa-types` crate, because it would have to either pull near-sdk into the pure layer or duplicate the structs.
- Consequence: 25 native tests run in milliseconds and the same code produces the verdict on chain and in `scripts/verify.sh`. The cost is a mirror in TypeScript for the browser, pinned to the Rust output by test vectors.
- Where: `crates/kruxa-math`, `crates/kruxa-logic`, ARCHITECTURE.md 1.3.

## ADR-002: One monolith core contract for Wave 1; the market is a second contract later
- Context: PRODUCT-VISION wants a full product, the hackathon wants a trust core by Nov 9.
- Decision: `core.kruxa.near` holds Charter, ledger, lifecycle, Walk, verdict, refunds and claims. The constant-product market and Hold Vault are `market.kruxa.near` in Wave 3 and are reached only through `open_market`, never inside `settle`. RULING #22.
- Rejected: per-launch vault contracts published by hash now. They remove the upgrade risk for large launches but cost days and a global-contract publish burn; the capped ladder ($1,000 / $3,000) makes the residual risk small, and the vault design remains available before any uncapped gate.
- Consequence: a single upgradeable account holds all funds, disclosed as phase P0. Wave 3 adds a second contract without touching Wave 1 storage.
- Where: ARCHITECTURE.md 2.1, 5.1.
- Amended by CO-3 (ADR-022): the market is still a second contract, but scope M-A is now built pre-freeze; the Wave 1 storage is untouched except the additive deltas D-1 and D-3.

## ADR-003: USDC is the only quote asset
- Context: S1-A allowed NEAR and USDC; S1-B needed per-asset exit-fee math and a per-asset solvency anchor. RULING R1.
- Decision: the trial, sale and fees are USDC (6 decimals). NEAR remains gas and storage only. All thresholds are exact integers in micro-USDC.
- Rejected: NEAR/wNEAR as a quote asset. A volatile quote asset makes "$25K" and "$350" thresholds drift, doubles every table, and S1-C's 24-decimal math has more dust risk.
- Consequence: Solana buyers reach USDC through Intents; the S1-C market math is rebased to 6 decimals (reserve bounds, $1 minimum trade).
- Where: `crates/kruxa-logic/src/rules.rs`, ARCHITECTURE.md 5.1.

## ADR-004: Uniform-price pro-rata sale with a floating price
- Context: the sale model must give every non-walked buyer the same price, must not reward bot speed, and must sell exactly the sale supply (the factory token has no mint function and may have no burn).
- Decision: `accepted = min(total, hard_cap)`, `spend = ceil(c x accepted / total)`, `tokens = floor(c x n_sale / total)`; oversubscribed buyers are scaled down with a no-fee refund of the excess; undersubscribed trials sell the whole supply at a lower price. RULING #12.
- Rejected: a fixed price. Unsold tokens cannot be burned, so supply bookkeeping gets a permanent hole and the Solana mint amount becomes demand dependent. Also rejected: a bonding curve during the trial, which creates a sniping edge and makes Walk price dependent.
- Consequence: the buyer sees an estimate of tokens until the window closes (`preview` and the trial page show it). Rounding dust goes to the LP bucket, never to the creator or the platform.
- Where: `crates/kruxa-logic/src/settle.rs`.

## ADR-005: The verdict is a pure function that makes no promise
- Context: a verdict that depends on a cross-contract call can be blocked or changed by an outage elsewhere.
- Decision: `settle` reads `(total_active, active_funders, soft_cap, min_funders, cancelled)` and computes PASS or FAIL(reasons) with no cross-contract call, no yield/resume and no caller-dependent input. It is permissionless and idempotent.
- Rejected: yield/resume finalization (a roughly 200-block timeout makes it unsuitable for windows of hours), and a keeper or oracle that decides. Both add a party that can delay or tilt the outcome.
- Consequence: anyone, including a judge, can call `settle`, and `kruxa-sim` recomputes the same hash. The price is that money movement after the verdict is a separate set of pull calls that keepers must run.
- Where: `contracts/core/src/lifecycle.rs::settle`, `crates/kruxa-logic/src/verdict.rs`.

## ADR-006: Money leaves by pull, with the debit before the outbound call and a re-credit in the callback
- Context: NEAR callbacks are guaranteed to run but not to succeed, and any method can run between a call and its callback.
- Decision: every outbound leg (refund, claim, fee, stream draw, consolidation, relay fee) moves the counter first (`due` to `in_flight`, or an equivalent), makes one promise, and `on_payout` undoes the move on failure. `on_payout` uses saturating arithmetic and never panics on user data. Refunds are permissionless and the destination is fixed by the position.
- Rejected: a push loop that pays all holders in one transaction (bounded by the 1000 Tgas per-transaction ceiling, so about 25-60 recipients) and the NEAR "pay then record" order that double-pays on reentrancy.
- Consequence: a failed leg is retried by anyone; a callback that itself runs out of gas would leave `in_flight` inflated until an emergency resolve exists (not built in Wave 1; callbacks are tiny and carry 25 Tgas).
- Where: `contracts/core/src/payout.rs`.

## ADR-007: S3 is the primary Solana attribution path, S4 the fallback, a trusted relayer is not built
- Context: Phantom-only buyers have no NEAR key, and a credit must be attributed to the right signer. W0 showed from source that `intents.near` calls `mt_on_transfer` with a flat `msg` and refunds on the return value. RULING R4.
- Decision: `mt_on_transfer` (guarded by `predecessor == intents.near`) credits the signer, parses the buyer-signed `msg`, and returns the amounts to reject. `contribute_via_intents` (feature `s4-fallback`) parses and forwards the same signed bytes if S3 fails on the live test. The trusted relayer-credit path (S1) is not built.
- Rejected: S1, which gives one party the power to credit anyone, and S4 as primary, which needs in-contract parsing and orphan bookkeeping that S3 makes unnecessary.
- Consequence: no orphan risk and no `RejectedDeposit` ledger for S3. Live confirmation (OV1 final, Phantom byte-exactness) is still pending Dami's per-action go for the approved micro-test.
- Where: `contracts/core/src/intake.rs`, `contracts/core/src/s4.rs`.

## ADR-008: The platform never pays a buyer's gas; the relay fee is carved from the signed amount
- Context: Dami's ruling (2026-11-06): "we can't be paying for their gas". RULING R2.
- Decision: a Solana buyer's signed amount `X` is credited as `X - relay_fee` (shown before signing, bounded by a rule), `relay_fee` is accrued to `relay-fees.kruxa.near` and is not refundable; the minimum buy is checked on the net amount. A buyer may also submit the call themselves. The platform pays only genesis and attestation rent (Wave 2/4), from the launch fee.
- Rejected: platform-sponsored relaying, and a relayer that fronts gas and is repaid out of the position (it makes the relayer a creditor with its own incentives).
- Consequence: Solana buyers pay a small quoted fee. The exact ceiling (5% / $0.50 implemented, 1% suggested) is an open ruling, a one-line constant.
- Where: `intake.rs::check_commit`, `payout.rs::pay_relay_fees`.

## ADR-009: Every launch uses the factory token; the TokenProvider seam stays
- Context: the factory token's global contract can be replaced by its publisher; an own immutable FT removes that risk but costs a one-time burn of roughly 10-20 NEAR. RULING 2026-11-07: own-FT burn not approved.
- Decision: `FactoryPrimitives` creates every launch token; the supply is minted to core and verified by `ft_balance_of`. `TokenProvider` and `TokenRoute::OwnGlobalByHash` exist as a seam only.
- Rejected: own-FT-by-hash for real-money launches in this wave (spend not approved), and creating the token at PASS (a name collision would then fail after the verdict).
- Consequence: the publisher-key risk is disclosed in the README and charter page. A failed launch's token stays in core (no burn).
- Where: `contracts/core/src/token.rs`.

## ADR-010: Four settlement buckets and lazy per-position settlement
- Context: oversubscription means the accepted raise is smaller than the money held, and a loop over 500 positions at `settle` could exceed gas.
- Decision: `settle` allocates `launch_fee + lp_seed + stream + excess_pool == total_active` in O(1); each position settles lazily (spend rounds up, refund and tokens round down); the identity `buckets == open + spent` holds after every step; leftover rounding residue is swept to the LP bucket.
- Rejected: three buckets with the refund pool implied (conservation then cannot be asserted per step), and an eager settlement loop.
- Consequence: keepers must run `settle_positions_page` before consolidation and payouts; a view exposes both identities.
- Where: `settle.rs`, `ledger.rs`, `lifecycle.rs::settle_position_inner`.

## ADR-011: Caps are measured on custody, not reserved on paper
- Context: RULING 2026-11-07: $1,000 per launch and $3,000 global in USDC, raising timelocked. A hard cap alone does not bound custody because oversubscription is allowed.
- Decision: `Rules.max_hard_cap` ($1,000) bounds the target raise; a launch accepts commits up to 2x its hard cap (`max_oversub_bps`); `Config.global_held` counts actual principal and falls when money leaves; raising either cap is queued for 7 days; lowering is instant for owner or guardian.
- Rejected: reserving each launch's cap against the global cap at creation (it strands headroom and counts money that is not held), and the earlier 10 NEAR / 50 NEAR figures, which could not satisfy the $500 minimum hard cap.
- Consequence: the 2x ceiling is a new constant that no spec had; it is flagged for Dami.
- Where: `intake.rs::check_commit`, `admin.rs`, `rules.rs`.

## ADR-012: A pause stops new risk and outbound proceeds, not the verdict
- Context: S1-A blocked `settle` while paused; B said an outage must not block a verdict. A pause has no expiry, so blocking `settle` would strand every refund once `walk_end` passed.
- Decision: `pause` blocks create, commit and the outbound creator and platform payouts (`consolidate`, `pay_launch_fee`, `draw`, `pay_relay_fees`); exits (Walk, refunds, claims) and `settle` stay open. `freeze` blocks everything and auto-expires after 7 days. Only the owner unpauses.
- Rejected: pausing `settle` (traps depositors behind an unbounded pause) and an indefinite freeze (a hostage mechanism).
- Consequence: a guardian can delay creator proceeds indefinitely but never trap a buyer. Found while writing the code and covered by a test.
- Where: `lib.rs::pause_level`, `lifecycle.rs`, `payout.rs`, `admin.rs`.

## ADR-013: The creator bond pays position storage; positions are deleted once clear
- Context: storage is 1e-5 NEAR per byte, a position is about 330 bytes (0.0033 NEAR). RECONCILED row 26.
- Decision: `create_trial` requires `bond_required(max_holders) + factory_deposit`; positions are removed when nothing is owed either way, so the bond is returned by `reclaim_bond`.
- Rejected: holders pre-registering storage (Solana buyers have no NEAR account) and platform sponsorship (a recurring platform cost, contrary to R3).
- Consequence: a launch with Solana buyers keeps their position records until Wave 2 builds the Merkle tree, so its bond returns later.
- Where: `rules.rs::bond_required`, `lifecycle.rs`.

## ADR-014: Fee terms are validated and committed in Wave 1 but applied only in Wave 3
- Context: the market that charges the fees is Wave 3, but creator accountability (the creator take is at most 1.00% of volume) must be fixed when the launch is created, before any buyer commits.
- Decision: `TrialParams.fees` (`FeeTerms`) is validated by `check_fees` with the exact-integer creator-take form and stored in the immutable Charter. They are inert until `market_mode` applies them.
- Rejected: leaving fee terms to the market contract (a creator could set them after buyers joined) and omitting them from Wave 1 (the kickoff's hostile-preset criterion lists their codes).
- Consequence: the README must say they are inert for the Genesis Round.
- Amended by CO-3 (ADR-022): fee terms are applied by Market-lite pre-freeze if the M-gate is green; otherwise they stay inert and the README says so.
- Where: `rules.rs::check_fees`.

## ADR-015: Test in the sandbox against mocks first; the real Verifier wasm is a Wave 0 swap
- Context: mainnet and live-testnet calls spend money and need Dami's confirmation.
- Decision: `mock-ft`, `mock-intents` and `mock-factory` implement exactly the call shapes the contract uses; the harness isolates them so the real `intents.near` wasm (fetched with a read-only `view_code`) can replace the mock in one file.
- Rejected: testing only live. It is slow, costs real funds on mainnet and cannot force the failure cases (callback failure, factory failure) that the suite needs.
- Consequence: the mocks are `[ASSUMED]` faithful; one of them was wrong on the first run and the sandbox caught it. The real-wasm run is still owed.
- Where: `contracts/mock-*`, `tests/src/lib.rs`.

## ADR-016: Pin the toolchain to rustc 1.95.0 and near-sdk 5.30.1
- Context: the machine default is rustc 1.91.1; near-sdk 5.30.1 needs 1.95; the signed-test kit used near-sdk 5.9.0 on 1.91.1 with binaryen lowering.
- Decision: install 1.95.0 alongside, pin it in `rust-toolchain.toml`, build with `cargo-near 0.23.0`.
- Rejected: staying on 1.91.1 with near-sdk 5.9.0. It diverges from the version mainnet nearcore 2.14 targets and from every spec.
- Consequence: a fresh machine needs `rustup toolchain install 1.95.0` before anything builds.
- Where: ARCHITECTURE.md 1.6, 13.1.

## ADR-017: Views return JSON values and the build uses `--no-abi`
- Context: typed views need `JsonSchema` on every nested type, including the pure crates' types, which would add a dependency to the pure layer.
- Decision: views build `serde_json::Value`; the contract is built with `--no-abi`; the TypeScript types are written by hand.
- Rejected: generating an ABI now. It is a size and dependency cost with no Wave 1 consumer.
- Consequence: the wasm is larger than the 350 KB budget of S1-A (456,999 bytes measured, 4.57 NEAR of contract storage stake); typed views are a Wave 1b size lever.
- Where: `contracts/core/src/views.rs`, `scripts/lint.sh`.

## ADR-018: The app refuses mainnet unless Dami's confirmation token is set
- Context: the first mainnet token must be the brand token, and every mainnet step needs his per-action confirmation.
- Decision: `app/lib/config.ts` throws at startup when the network is mainnet without `NEXT_PUBLIC_MAINNET_CONFIRMED=DAMI-PER-ACTION-CONFIRMED`; `scripts/testnet-deploy.sh` refuses non-testnet roots and prints rather than runs by default.
- Rejected: a convention in the README. A gate in code cannot be forgotten at 2 a.m. on Nov 13.
- Consequence: moving to mainnet is a deliberate edit by Dami.
- Where: `app/lib/config.ts`, `scripts/testnet-deploy.sh`.

## ADR-019: The app uses the PRD route names and a TypeScript mirror of the verdict
- Context: PRD 7.4c names the routes; a judge must be able to recompute without trusting the hosted UI.
- Decision: Wave 1 builds `/`, `/create`, `/launch/[id]` (with Walk) and `/demo` (offline vectors plus live recompute with a Tamper box); `lib/verdict.ts` mirrors `kruxa-logic` and is pinned to its hashes by vitest.
- Rejected: computing the verdict server-side or showing only the stored result. That asks the judge to trust the host, which is the thing the product claims to remove.
- Consequence: any change to the Rust encoding must update the pinned hashes in `verdict.test.ts`.
- Where: `app/`.

## ADR-020: Mainnet is the product target; testnet and devnet are rehearsal plus the no-funds judge path (CO-3)
- Context: Dami wants a real, live product, not a testnet demo, and AI judges must run the README without spending.
- Decision: the product targets mainnet; every rehearsal runs on NEAR testnet and Solana devnet; the README has a no-funds path for every step. The ruling "no token or mint on mainnet before $KRUXA" stands.
- Rejected: a testnet-only product (not the goal, though eligible for every track under Q-010) and mainnet-first for all launches (breaks the $KRUXA-first ruling).
- Consequence: the hosted demo shows labelled testnet launches plus the mainnet $KRUXA launch once it exists.
- Where: PRD 1.5, INVARIANTS 6.

## ADR-021: A contract-level creator gate enforces "no token before $KRUXA" (CO-3)
- Context: the ruling was enforced by process (guard script, per-action confirmations). A deployed `create_trial` that any account can call would let anyone create a factory token on mainnet first.
- Decision: `Config.creator_gate` is owner-only at deploy; `create_trial` returns `R_CREATOR_GATE` for other accounts; the owner opens it once with `open_beta` after $KRUXA genesis succeeded and the Squads independents are verified.
- Rejected: process-only enforcement (a gate in code cannot be forgotten at 2 a.m., same reasoning as ADR-018) and a second contract for the beta (splits the ledger and the caps).
- Consequence: a small additive Wave 1 delta (D-1), regression-tested.
- Where: ARCHITECTURE 5.13, INVARIANTS 6.

## ADR-022: Market-lite is pulled forward as the NEAR venue (CO-3; amends ADR-002 and ADR-014)
- Context: Dami ruled the NEAR venue is Kruxa's own constant-product pool and fee router, with a mainnet path for $KRUXA and third-party launches.
- Decision: ship scope M-A (pool, five-slice fee cut, creator claim, platform withdraw, caps, pause, events) pre-freeze behind the M-gate; Hold Vault, referral lots and ratchets stay later (holder slice goes to LP and referral returns to LP until then).
- Rejected: listing on Ref or Rhea (no creator-fee hook, whitelist process unknown) and waiting for Wave 6 (no NEAR venue at the Genesis Round).
- Consequence: new unreviewed money-holding code (R-34) mitigated by reserve caps, mandatory `min_out`, pause, disclosure, and a gate.
- Where: ARCHITECTURE 5.1, 5.8; PRD C5.

## ADR-023: Solana venue is a Meteora DAMM v2 pool with locked LP; DBC only after four checks (CO-3)
- Context: R-METEORA. DBC creates its own mint and takes 20% of fees first; a standard pool keeps the null-authority genesis intact.
- Decision: first phase is a DAMM v2 pool created from the Squads vault after the 48 h release; DBC stays off until external mint, migration trigger, fee-claimer rotation and the 20% take all pass in a devnet spike finished by Nov 10 midday.
- Rejected: DBC first (conflicts with null-authority genesis [UNVERIFIED]), Raydium CPMM with burned LP as the primary (kept as the first fallback, ADR-039), pump.fun (no third-party fee path found); Orca Whirlpools as the first fallback (kept only as the second fallback, ADR-039: its lock is full-range only and no way was found for our program to call it).
- Consequence: on mainnet the Solana pool lands at best on Nov 14 and probably after; disclosed.
- Where: ARCHITECTURE 5.10.

## ADR-024: NEAR pool LP has no human timelock; the 48 h Squads timelock stays for the Solana vault (CO-3)
- Context: R-GR-TIME keeps the 48 h lock. The NEAR LP is permanent inside the contract (D-20).
- Decision: `open_market` runs right after settle; only the Solana vault release waits 48 h.
- Rejected: shortening the 48 h lock (ruled against) and holding the NEAR LP in a multisig (adds a human key where none is needed).
- Where: PRD 8.3.

## ADR-025: Payout recipient defaults to the registering account and is fixed once the trial opens (CO-3)
- Context: creator payout wallets are the highest-value attack target; pump.fun limited redirection after griefing.
- Decision: default creator, optional separate recipient at creation, in the Charter hash, no change method in the submission build; post-freeze flow is propose, 48 h wait, new address accepts, old key may cancel, optional permanent lock; NEAR accounts only first.
- Rejected: free change (griefing), never changeable (key loss has no answer), a platform override (a custody power Kruxa does not want).
- Where: PRD 4b.2, INVARIANTS 8.

## ADR-026: Fee-split constants live in one file; the split is RULED 50/15/15/10/10 (CO-3, ruled and synced by CO-5)
- Context: DN-15; peers pay creators 35% to 70% of about 1%. Dami ruled on 2026-11-08 ("go with your recommendation for the others", R-46): creator 50, platform 15, holders 15, LP 10, referral 10.
- Decision: `FEE_SPLIT_DEFAULT` in `rules.rs`, snapshotted per Charter, set to 5000/1500/1500/1000/1000. Contract bounds unchanged (total <= 2.00%, creator <= 60%, declared creator take <= 1.00% of volume, platform floor 15%, holders plus LP >= 20%). At 1.00% fee: creator 0.50%, platform 0.15%, creator-controlled extraction bound 75%. Because the embedded Wave 1 rules fixed the platform share at 2_000, CO-5 delta D-4 changes two constants only (`Rules.platform_bps` to 1_500; `FeeTerms::standard()` to the ruled split); no rule logic changes.
- Rejected: option A 35/20/20/15/10 (creator-light, below the peer range for the trust story); option B 45/20/15/10/10 (keeps a 20% platform slice that the break-even arithmetic cannot justify, and it is still below the Zora/Jupiter level); scattering the numbers across contract, UI and README (drift).
- Consequence: platform income falls to 0.15% of volume; break-even would need about $53.3M monthly volume at $80K cost (PRD 4b.5), so no revenue claim is made (ADR-033).
- Where: PRD 4b.3, ARCHITECTURE 5.9 and 5.13 D-4, INVARIANTS D-48.

## ADR-027: No exemption lists by default; any list is public and capped (CO-3)
- Context: Pons V2 let launchers exempt up to 32 wallets; an analyst alleges about $18M extracted [UNVERIFIED single source].
- Decision: none exists; if added it is public, in the Charter, fixed, capped (interim 8 [ASSUMED]) and shown in `declared_wallets`.
- Rejected: creator-controlled carve-outs.
- Where: INVARIANTS 9.

## ADR-028: A small own indexer and Lightweight Charts (CO-3)
- Context: no NEAR chart provider is verified; hackathon scale is small.
- Decision: neardata ingest with RPC fallback, SQLite, own candles, Lightweight Charts (Apache 2.0, attribution), datafeed-compatible API.
- Rejected: TradingView Charting Library (approval needed), Helius LaserStream at $499 a month (Solana streaming not needed pre-freeze), diffing contract state (events are the source).
- Where: ARCHITECTURE 5.11; PRD C14.

## ADR-029: Wallets are near-connect for NEAR and a wallet-standard chooser for Solana (CO-3)
- Decision: pin the exact near-connect version and publisher (look-alike names exist); chain-labelled sessions; no wallet prompt on read; Solana-only buyers via Phantom plus Intents, gated by unrun Test 1.
- Rejected: FastAuth (no sign of life), Privy or Phantom embedded wallets (cost, unproven signing path), Telegram app (not before the freeze). Fallback: the already built wallet-selector.
- Where: ARCHITECTURE 5.12.

## ADR-030: Tracks are claimed by a freeze-time rule (CO-3)
- Decision: a track id is listed only if its README step is green at the freeze commit; six targeted, thesis a conditional seventh (CO-4: promoted only if Dami delivers the credentials and the Nov 10 12:00 UTC freshness check passes), business and nfts stretch unlisted by default, 4 dropped.
- Rejected: claiming all 13 (padding), claiming by roadmap module (unsupportable).
- Where: PRD 1.6.

## ADR-031: Hosting durability tier 2 (CO-3; RULED by Dami 2026-11-08, R-46, DN-16)
- Decision [RULED]: durable tier 2 (no spin-to-zero), kept up through Nov 25 (minimum Nov 18): app on a managed host plus a small indexer VM through Nov 25 (minimum Nov 18), degrading to baked snapshots and direct RPC reads.
- Rejected: local-only (Q-012 favours a hosted demo) and managed Postgres with paid streaming (cost without need).
- Where: CHANGE-ORDER-3 section 10.

## ADR-032: The core wasm freezes on Nov 10 EOD (CO-3)
- Decision: the Nov 11 mainnet core already contains D-1 and D-3.
- Rejected: upgrading core mid-trial (state risk on a live raise) and deploying the market first (the Charter snapshot makes the order core then market safe).
- Where: PRD R-35.

## ADR-033: Revenue statement (CO-3)
- Decision: the launch fee on PASS is the only durable line; no break-even claim. Corrected: $80K / 0.20% = $40M monthly volume.
- Rejected: promising fee-funded break-even and any platform token.
- Where: PRD 4b.5, INVARIANTS 10.

## ADR-034: Agent vault so a function-call key can act (CO-4)
- Context: function-call keys cannot attach the 1 yocto that `ft_transfer_call` and core `walk` need; the security prompt demands a scoped key.
- Decision: a small testnet-only contract holds the agent's USDC and enforces budget, per-commit cap and a checker-allowed launch list; the agent key is scoped to `commit,walk` on that account; no full-access key remains.
- Rejected: full-access throwaway keys for the agent; client-side policy only (kept as fallback, cut position 8).
- Where: CHANGE-ORDER-4 section 4.

## ADR-035: Separation of duties for agents (CO-4)
- Decision: model proposes, deterministic policy decides, independent Check service allows on the vault, owner holds limits. A forced walk cannot be vetoed by the model.
- Rejected: letting the model hold policy.

## ADR-036: Three claim levels for model evidence (CO-4)
- Decision: L0 recorded, L1 response signature matched to a recorded attestation signer, L2 DCAP-verified quote. README prints the level reached. Live `provider_tee` signature is [UNVERIFIED] until a keyed run.
- Rejected: saying "TEE-verified" on attestation fetch alone.

## ADR-037: Honest adversary reporting (CO-4)
- Decision: sybil splitting and walk-to-flip are reported as bounded, not blocked.
- Rejected: designing the swarm so every adversary fails.

## ADR-038: Thesis promoted conditionally, business not (CO-4)
- Decision: thesis becomes a targeted track gated on GCP, JWT and a BigQuery freshness check by Nov 10 12:00; business stays tier C because inference cannot be bought autonomously.
- Rejected: promoting business with a human top-up presented as autonomy.

## ADR-039: Solana venue fallback tree (CO-5, from CO-3 Addendum A; DN-22)
- Context: R-METEORA chose Meteora; Dami asked for "a proper fallback for meteora". DAMM v2 has no built-in platform/creator fee split (partner-fee removed in 0.2.0), no anti-sniper rate limiter (only the decaying base-fee scheduler), and unverified upgrade authorities.
- Decision [adopted for planning unless Dami objects, R-48]: DAMM v2 primary; Raydium CPMM first fallback (Burn and Earn locker, Fee Key NFT, about 0.19 SOL per pool against about 0.022 SOL, secondhand [UNVERIFIED]); Orca Whirlpools second (full-range lock only). Switch triggers: mint rejected or no pool after about a day of debugging; lock or fee claim fails; not routable or listed within about 24 h of a tiny mainnet pool; exploit, pause or breaking upgrade. Kruxa does the platform/creator split itself (two locked positions with different owners, or one claimer plus a Kruxa payout). The devnet spike also tests a PDA or Squads-vault-owned position claiming fees. Round one is the NEAR pool only (DN-14), so this tree governs the later Solana pool.
- Rejected: an own pool program (unaudited code on a real-money path; an audit costs more than the $3,000 global cap; indexers will not list an unknown program); Raydium LaunchLab and PumpSwap (not shown to accept an externally created token or to be usable by a third party); DBC first (ADR-023).
- Consequence: upgrade authorities and PDA fee claims are disclosed as unverified (LIMITATIONS); Orca is a last resort.
- Where: PRD 2.2 C17 and A14, ARCHITECTURE 5.10, PLAN DN-22 and S-2, `research_notes/Kruxa launchpad market layer fees/meteora_fallback.md`.

## ADR-040: Squads signers are named when third-party creators are about to open (CO-5; DN-21)
- Context: a 2-of-3 Squads vault with two independent signers is the control that makes third-party creators safe enough; Dami asked why they matter and answered "for 1, id name 2 friends when we get there".
- Decision [RULED R-47]: Dami names two friends before third-party creators open on mainnet; the Genesis Round does not need them (Dami holds all three keys, disclosed single-party). Until they are named the creator gate stays closed. The plan's latest date for naming is Nov 11 EOD with the vault verified Nov 12 [ASSUMED]; a firmer date is Dami's to set (ledger O-01).
- Rejected: naming signers by a fixed early date regardless of need (not what Dami ruled); opening the beta with a single-party vault (the earlier DECISIONS-PACK1 ruling #3 requires 2-of-3 before the capped beta).
- Where: PRD 1.5, 9.4 O-5, DT-8; PLAN DN-21 and BLK-1; INVARIANTS D-53.

## ADR-041: Test 1 is run by Dami; Claude prepares and verifies (CO-5; R-49, R-50, R-51)
- Context: Test 1 (Intents OV4 credit, OV15 `ft_withdraw` to Solana, S3 micro-test) moves real money. Dami asked repeatedly for Claude to convert funds itself; the harness forbids Claude from converting, swapping or bridging funds even when asked.
- Decision [RULED]: Claude writes dry-run-by-default scripts (`fund-t1.ts`, `test1.ts`, `get-usdc-t1.ts` in `warroom/signed-tests`) and verifies results read-only; Dami runs every money-moving command with the `!` prefix. No new money: Test 1 is funded from the funds already sent; USDC comes from a swap of Test 1's own SOL; the T1 NEAR target is 0.15 NEAR because `register` needs about 0.0322 NEAR in balance (the first run aborted before broadcast at 0.02 NEAR). Supersedes the CO-4 section 15 row that asked Dami to fund 0.013 SOL + 1.32 NEAR + 0.05 USDC.
- Rejected: Claude running `--send` or a bridge (harness rule, and per-action confirmation); asking Dami to send more money (he said he will not); skipping Test 1 (the defi track and GR-3 would then drop the Solana-landing claims).
- Consequence: Test 1 is a dated Dami task; if it is not run by Nov 10 12:00 the Solana-landing claims are dropped (PLAN DT-R17).
- Where: PRD P-04, PLAN Task 4.12 and DC-A, SUBMISSION_STATUS.

## Pending recommendations (NOT decided; shown so nobody reads them as rulings)
CHANGE-ORDER-4 section 16 recommends, and Dami has not ruled: DN-26 (opening-fee start 500 bps over 60 min, surcharge to LP), DN-27 (build the agent vault; ADR-034 is the design if yes), DN-28 (defer the Meteora venue builder), DN-29 (promote thesis, conditional), DN-30 (business stays tier C), DN-31 (model `Qwen/Qwen3.8-27B`), DN-32 (six concurrent agents at a 0.7 factor). ADR-034 to ADR-038 record the designs that follow if those recommendations are accepted. Ruled by Dami on 2026-11-08 (R-46): fee split (ADR-026), pool seed 100% NEAR pool, hosting tier 2 (ADR-031), reserve caps interim, beta access after BLK-1.
