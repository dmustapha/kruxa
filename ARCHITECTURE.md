# ARCHITECTURE: Kruxa (NEAR HACKATHON: Build Beyond Boundaries)

Version: forge Phase 2, 2026-11-07, amended by CHANGE-ORDER-3 on 2026-11-08 (Section 5.8 to 5.13 and the marked rows; Sections 4.1 to 4.9 Wave 1 code are NOT edited, see 5.13), by CHANGE-ORDER-4 (track depth, folded here as Section 5.14 by CHANGE-ORDER-5) and by CHANGE-ORDER-5 (doc-sync: fee split 50/15/15/10/10, venue fallback tree, Test 1 handling). The ONLY edits inside 4.1 to 4.9 are the two ruled fee constants listed in 5.13 (D-4, CHANGE-ORDER-5 section 3). Ticker $KRUXA. Authority order: DECISIONS-PACK1 RULINGS 2026-11-07 > RECONCILED-INTERFACE > W0 > S1-A > S1-B/C/D.
**Final-build sync, 2026-11-10 (docs-sync).** This document was written before the build. Its embedded Wave 1 code (4.1 to 4.9) is left as written so the Section 17 round trip stays true; it is a historical record of the Wave 1 files, not of the final core. Where any statement disagrees with the built repo, the code wins. Corrections are marked `[SYNC 2026-11-10: ...]` inline and collected in Section 5.15 (final core surface, deployed state and the register of corrected statements). Sources of truth: `contracts/core/src`, `docs/interfaces/CORE-ABI.md`, `docs/interfaces/EVENTS.md`, `evidence/`, `rehearsal/ROUND2.md`.

Deadline context: feature freeze Nov 12, repo public + X post Nov 13, one-shot submit Nov 14 23:59 UTC. Nothing in this document signs, spends, deploys to mainnet, posts, pushes or submits.

## How to read this document (copy-exact contract)

1. **This file is the single source of truth.** Every file of Wave 1 appears below in full. The first line inside each code block (`// File: path` or `# File: path`) is a header, not part of the file. `scripts/extract_architecture.py` (Section 4.8) strips the headers and writes the tree, so copying is mechanical: `python3 scripts/extract_architecture.py ARCHITECTURE.md ./kruxa-repo`.
2. **The Wave 1 code was written, compiled and run before it was pasted here.** The blocks are pulled verbatim from a scratch workspace by a generator, and the extractor was run against this file and diffed against that workspace (Section 17 records the result). Nothing was retyped.
3. **Tags.** `[VERIFIED]` = a source or a run in this session backs it (named in the line). `[UNVERIFIED]` = compiles and passes against MOCKS but the real external system was not exercised, or never executed at all. `[ASSUMED]` = a stand-in whose fidelity to the real system is assumed. `[UNVERIFIED-COMPILE]` is not used for Wave 1 because the toolchain was available (rustc 1.95.0 was installed locally for this run); it is used in Section 5 for interface-level Rust that has not been compiled.
4. **Waves.** Wave 1 = full code (this document). Waves 2-4 = interface, storage layout and sequence level only (Section 5), tagged by wave. A later-wave item is never described as built.
5. **Rulings applied.** Name Kruxa, ticker $KRUXA; platform never pays buyers' gas (flat quoted relay fee or self-submit; the platform pays only genesis and attestation rent); trustless S3 primary, S4 fallback, trusted relayer (S1) NOT built; factory token default, own-FT burn not approved; creator allocation NEAR-only; fourth settlement bucket for oversubscription refunds; S1-C wNEAR math rebased to 6-decimal USDC; caps $1,000 per launch and $3,000 global, raise timelocked; storage 1e-5 NEAR per byte; the first mainnet token must be Dami's brand token.
6. **Hard constraints for every step in this document:** sign nothing, spend nothing, deploy nothing to mainnet, post nothing, push or submit nothing without Dami's per-action confirmation. Every mainnet-touching step below is marked `REQUIRES DAMI PER-ACTION CONFIRMATION`.

## Table of contents

1. System Overview (diagram, technology table, dependency flow, file tree, waves)
2. Component Architecture (table, data flow, sequences, state machine, state)
3. Spec reconciliation log (conflicts resolved, patch list applied)
4. Wave 1 code (workspace, kruxa-math, kruxa-logic, core contract, mocks, tooling, tests, scripts, app)
5. Later waves at interface level (Waves 2-4)
6. Domain Knowledge File spec
7. Submission Directory Plan
8. Multi-Track Architecture
9. Safety Architecture
10. Security spec (for build's SECURITY.md)
11. Configuration Reference and Credentials Needed
12. Testing Strategy
13. Component Build Order (with toolchain prerequisite)
14. Deployment Sequence
15. Addresses and External References
16. Integration Map
17. Verification ledger (what was actually run)


---

# Section 1: System Overview

**Kruxa** is a token launchpad in which a launch is a refundable trial first. Buyers commit USDC; until the trial's walk tail ends every buyer can Walk and get the full principal back with no fee; a deterministic verdict (a pure function of four numbers) then decides PASS or FAIL; only on PASS do sale tokens become claimable and the creator start drawing proceeds, capped at elapsed time times a fixed rate; on FAIL everyone is refunded by pull. Solana-only buyers participate through NEAR Intents, with an attribution path that needs no trusted party (S3 `mt_on_transfer`, S4 parse-and-forward as fallback).

## 1.1 System diagram

[VERIFIED] - derived from RECONCILED-INTERFACE 2.1 (call graph) and the Wave 1 code in Section 4.
```
# File: (diagram) system overview
  BUYER (NEAR wallet)                 BUYER (Phantom only)                 ANYONE (keeper / judge)
        |                                    |                                      |
        | ft_transfer_call(USDC,msg)         | signs transfer intent (msg flat)     | settle, settle_positions_page,
        v                                    v                                      | claim_refund(holder), sweep_residue,
  +-----------+  ft_on_transfer      +----------------+  mt_on_transfer           | consolidate, pay_launch_fee
  | USDC (NEP |--------------------->|                |<--------- intents.near ----+
  |  -141)    |<-- ft_transfer ------|   kruxa-core   |--- mt_transfer / ft_withdraw -->  intents.near
  +-----------+   (refunds, fee,     |  (one wasm)    |
                   stream, claims)   |                |--- create_token ---> token factory
  launch token <--- ft_transfer -----|  Charter       |<-- ft_balance_of --- (verify supply at core)
  (factory FT)                       |  Hold ledger   |
                                     |  Positions     |      reads only                reads only
                                     |  Walk/Verdict  |<------------------ kruxa-sim / verify.sh / app /demo
                                     +-------+--------+
                                             | links (no I/O, no near-sdk)
                         kruxa-logic  ---->  kruxa-math
                         (verdict, allocation, rules, hashes)   (U256 mul_div, linear unlock)

  Wave 2+ (interface level, Section 5): market (constant-product pool, fee router, Hold Vault),
  Solana genesis host (G key, tx builder, Merkle, Jito distributor), Squads reserve, SAS Verdict Rail.
```

## 1.2 Technology table

[VERIFIED] - every pin below was resolved or run in this session (cargo 1.95.0, npm view, near-workspaces sandbox) unless the Source column says otherwise.

| Technology | Version | Purpose | Source |
|---|---|---|---|
| rustc / cargo | 1.95.0 (local default is 1.91.1; see 1.6) | contract and logic build | installed locally for this run: `rustc 1.95.0 (59807616e 2026-04-14)` |
| near-sdk | =5.30.1, default-features off, no `universal-accounts` | contract SDK | compiled and run; S1-A 1.3; mainnet and sandbox both report protocol 88 [VERIFIED 2026-11-08, CO-3] |
| cargo-near | 0.23.0 | wasm build with feature lowering | installed and used: `cargo near build non-reproducible-wasm --no-abi` |
| near-workspaces | =0.24.0 | sandbox integration tests | 34 sandbox tests at Phase 1 [SYNC 2026-11-10: the suite now holds 33 files under `tests/tests` with 322 `#[test]` or `#[tokio::test]` attributes (a grep count on 2026-11-10, not a run result); the attack gallery alone runs 100 attacks] |
| uint | =0.10.2 | U256 | compiled and tested |
| proptest | =1.12.0 | property tests | run |
| sha2 | 0.10 | inputs_hash, book_hash | compiled |
| ed25519-dalek / bs58 | 2 / 0.5 (tests only) | sign Walk and S4 payloads in tests | run |
| Node | 24 (24.10.0 locally) | app and tooling | `node --version` |
| next / react / react-dom | 16.4.5 / 19.3.1 / 19.3.1 | app | `npm view`, `next build` succeeded |
| near-api-js | 7.4.0 | RPC views in the app | same pin as the signed-test kit |
| @near-wallet-selector/{core,modal-ui,my-near-wallet} | 10.1.4 | wallet connection | types compile; runtime unverified |
| @near-js/transactions | 2.5.1 | wallet-selector's action type (near-api-js 7.4.0 bundles an incompatible copy) | tsc error reproduced and fixed |
| typescript / vitest | 5.9.3 / 5.1.0 | app typecheck and tests | run |
| @solana/web3.js | 1.98.4 (Wave 2+, test kit pin) | Solana builder and tests | signed-test kit README |
| lightweight-charts | pin at build (Apache 2.0, attribution required) [UNVERIFIED version] | token page candles (CO-3) | research report |
| @hot-labs/near-connect | pin exact version and publisher (the report cites 0.11.4 [UNVERIFIED]; look-alike names exist) | NEAR wallet login (CO-3) | NEAR docs per report |
| Meteora SDKs | chosen in spike S-M0 [UNVERIFIED] | DAMM v2 and DBC spike (CO-3) | none yet |
| NEAR mainnet | nearcore 2.14.0, protocol 88 [VERIFIED 2026-11-08, curl `status` on rpc.mainnet.near.org]; sandbox is protocol 88 | target runtime | CO-3 (supersedes S1-A 1.3) |

## 1.3 One-way dependency flow

[VERIFIED] - enforced by the Cargo manifests in Section 4.
```
# File: (diagram) dependency direction
kruxa-core (contract, I/O, near-sdk)  -->  kruxa-logic (pure)  -->  kruxa-math (pure)
kruxa-sim, kruxa-tests, app/lib/verdict.ts (mirror)  -->  kruxa-logic
```
The deterministic core (`kruxa-math`, `kruxa-logic`) imports no I/O, no near-sdk and no adapter; the contract and every tool depend inward on it, never the reverse. Each headline formula has a file pointer: verdict = `crates/kruxa-logic/src/verdict.rs::verdict`; uniform-price pro-rata = `crates/kruxa-logic/src/settle.rs::settle_position` and `allocate`; launch fee = `settle.rs::launch_fee`; stream cap = `crates/kruxa-math/src/lib.rs::linear_unlocked`; storage constant = `crates/kruxa-logic/src/lib.rs::STORAGE_BYTE_COST_YOCTO` (1e19 yocto = 1e-5 NEAR per byte). The NEAR-specific adapter directories are single and named: `contracts/core/src/ext.rs` (Intents and USDC call builders), `contracts/core/src/token.rs` (factory), `contracts/core/src/s4.rs` (Intents signed-payload parsing). The whole Intents coupling lives in `ext.rs` + `intake.rs::mt_on_transfer` + `s4.rs`.

## 1.4 Waves

| Wave | Window | Content | Documented as |
|---|---|---|---|
| 0 | Nov 6-7, free | toolchain, sandbox S3 vs real `intents.near` wasm, testnet factory probe, `ft_burn` check | prerequisite list, Section 13 |
| 1 | Nov 7-9 | this document's code: trial lifecycle, S3/S4, Walk, settle, refunds, claims, stream-lite, caps, tests, verify skeleton, app | full code (Section 4) |
| 2 | Nov 9-11 | Solana genesis (F1), relayer, Merkle + Jito distributor, Squads reserve, `release_lp_seed` (Genesis Round; dropped, the method does not exist), verify C1-C34 (C33 and C34 not implemented) | interface level (5.2, 5.3) |
| 3 | CO-3: Market-lite (scope M-A) Nov 8-11 pre-freeze behind the M-gate; the rest after (vision W6b) | market contract (constant-product pool, fee router, creator claims), then Hold Vault, referral lots, ratchets, creator allocation vesting, backer-pool sweep | interface level (5.1, 5.8) |
| 4 | later | Verdict Rail (SAS), F0 Chain Signatures mint, ReserveGate / bridge | interface level (5.4, 5.5) |

Go/no-go for the Genesis Round (RULING 2026-11-07, YES, capped and labelled): gates green by Nov 10 EOD (moved from Nov 11 by R-GATE-MOVE, a real check never skipped), else the brand-token launch moves past the hackathon. CO-3 adds sub-waves 2S (Meteora spike), 2M (Market-lite) and 2I (indexer) in parallel; see 5.8 to 5.13. That decision, and any mainnet step, belongs to Dami.

## 1.5 File structure tree (Wave 1, every file the developer will create)

[VERIFIED] - each entry below has its complete code in Section 4. `[doc]` and `[gen]` marks are not code files and are excluded from the file-coverage metric. The tree encodes physical boundaries: pure core in `crates/`, the only chain adapter in `contracts/core`, test doubles in separate crates, `evidence/` for machine proof output.
```
# File: (tree) repository layout
kruxa/
├── Cargo.toml                                  workspace, pinned dependencies, release profile
├── rust-toolchain.toml                         channel 1.95.0 + wasm32 target
├── rustfmt.toml
├── .github/workflows/ci.yml
├── crates/
│   ├── kruxa-math/                             PURE: U256 mul_div, linear unlock, serde adapters
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── kruxa-logic/                            PURE: rules, verdict, allocation, ledger identities
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── rules.rs                        RuleCode, Rules, TrialParams, validate_params, bond
│           ├── verdict.rs                      verdict(), inputs_hash, book_next
│           ├── settle.rs                       phase_at, launch_fee, allocate, settle_position
│           └── ledger.rs                       L1 and L4 identities
├── contracts/
│   ├── core/                                   THE contract (the only chain adapter)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs                          state, init, pause helpers
│   │       ├── model.rs                        Charter, LaunchState, Position, Ledger, Config
│   │       ├── events.rs                       NEP-297 emit
│   │       ├── ext.rs                          ADAPTER: USDC and intents.near call builders
│   │       ├── token.rs                        ADAPTER: TokenProvider + FactoryPrimitives
│   │       ├── intake.rs                       ft_on_transfer, mt_on_transfer (S3), walk, walk_signed, try_commit
│   │       ├── lifecycle.rs                    create_trial, callbacks, cancel, settle, residue, dissolve, bond
│   │       ├── payout.rs                       refunds, claims, consolidate, fee, stream, on_payout
│   │       ├── views.rs                        JSON views for the app, kruxa-sim and judges
│   │       ├── admin.rs                        pause, freeze, timelocked caps
│   │       └── s4.rs                           ADAPTER: S4 fallback (feature s4-fallback)
│   ├── mock-ft/                                TEST DOUBLE: NEP-141 + NEP-145
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── mock-intents/                           TEST DOUBLE: intents.near slice
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── mock-factory/                           TEST DOUBLE: token.primitives.near create_token
│       ├── Cargo.toml
│       └── src/lib.rs
├── tools/kruxa-sim/
│   ├── Cargo.toml
│   └── src/main.rs                             verdict | settle | verify (recompute with the contract's own code)
├── tests/
│   ├── Cargo.toml
│   ├── src/lib.rs                              sandbox harness
│   └── tests/
│       ├── lifecycle.rs
│       ├── adversarial.rs
│       └── intents.rs
├── scripts/
│   ├── build.sh
│   ├── test.sh
│   ├── lint.sh
│   ├── verify.sh                               judge entry point (no keys)
│   ├── testnet-deploy.sh                       prints commands; testnet only
│   ├── keeper.sh                               permissionless keeper sequence (C15); testnet only
│   └── extract_architecture.py
├── app/                                        Next.js: landing, create, launch (Walk), demo (no wallet)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.mjs
│   ├── vitest.config.ts
│   ├── .env.example
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx
│   │   ├── create/page.tsx
│   │   ├── launch/[id]/page.tsx
│   │   └── demo/page.tsx
│   └── lib/
│       ├── config.ts
│       ├── near.ts
│       ├── wallet.ts
│       ├── verdict.ts
│       └── verdict.test.ts
├── evidence/                                   [gen] machine proof output written by scripts/verify.sh runs
├── ARCHITECTURE.md  DECISIONS.md  LIMITATIONS.md  SUBMISSION_STATUS.md   [doc]
├── SECURITY.md                                 [doc] scaffolded by build from Section 10
├── Cargo.lock                                  [gen]
└── target/                                     [gen]
```
Later-wave modules (not in this tree, by design): `contracts/market/`, `crates/kruxa-genesis/`, `relayer/`, `tools/squads/`, `tools/sas/`. Their planned layout is in Section 5.

## 1.6 Toolchain caveat (build-order prerequisite)

[VERIFIED] - observed: `rustc 1.91.1` is the machine default; `near-sdk 5.30.1` needs 1.95 and refused a native build.

The local default toolchain is **1.91.1**. `near-sdk 5.30.1` requires **1.95.0** (S1-A 2.1). This run installed 1.95.0 alongside (`rustup toolchain install 1.95.0 --profile minimal -t wasm32-unknown-unknown`) and used `cargo +1.95.0` everywhere. `rust-toolchain.toml` pins 1.95.0 so a plain `cargo` in the repo uses it. Two further facts: (a) near-sdk 5.30 refuses native `cargo build/check` ("use cargo near build"), so contracts are checked with `cargo check --target wasm32-unknown-unknown` and unit-tested only through the sandbox; the pure crates (`kruxa-math`, `kruxa-logic`) exist precisely so the money arithmetic runs under plain `cargo test`; (b) mainnet reports protocol 88, the same as the sandbox [VERIFIED 2026-11-08, CO-3], so the protocol-gap caveat lapses and wasm acceptance is still proven only by a testnet deploy before a mainnet step (none is known; the `universal-accounts` feature is not enabled). The kit's contract (`sign-gate-test`) was built on 1.91.1 with near-sdk 5.9.0 and needed binaryen lowering because that rustc emits bulk-memory. `cargo near build` (0.23.0) ran its own `wasm-opt` post-step for the 1.95.0 build, and the sandbox VM (protocol 88) loaded the resulting wasm in every test. Whether the real network accepts the same wasm is **[UNVERIFIED]** (mainnet is protocol 88, the sandbox's protocol): it is checked by deploying `kruxa_core.wasm` to a funded testnet account in Wave 0 step 5 (Section 13) before any mainnet discussion.


---

# Section 2: Component Architecture

## 2.1 Component table

[VERIFIED] - components and accounts from RECONCILED-INTERFACE 2.1; Wave column per Section 1.4.

| Name | Type | File Path | Purpose | Dependencies | Wave |
|---|---|---|---|---|---|
| kruxa-math | pure crate | `crates/kruxa-math/src/lib.rs` | U256 `mul_div_floor/ceil`, bps helpers, linear unlock, decimal-string serde | uint, serde | 1 |
| kruxa-logic | pure crate | `crates/kruxa-logic/src/*.rs` | rule codes + constants, param validation, verdict, allocation, per-position settlement, book hash, ledger identities | kruxa-math, sha2, borsh, serde | 1 |
| kruxa-core | contract (`core.kruxa.near`) | `contracts/core/src/*.rs` | Charter, hold ledger, Walk, verdict + settle, refunds, claims, consolidate, fee, stream-lite, caps, pause [SYNC 2026-11-10: also the Wave 2 and 1b surface that is now built: genesis state machine with the F0 signing gate, solvency anchor, creator allocation claim, `sweep_tokens` and `burn_mode`, 7-day upgrade queue, `halt_launch`, `force_resolve_op`, `withdraw_owed`, refund batch and route, orphan credit, `lengthen_stream`; see 5.15] | near-sdk, kruxa-logic | 1 |
| TokenProvider / FactoryPrimitives | adapter | `contracts/core/src/token.rs` | create the launch FT with the whole supply minted to core | token factory | 1 |
| Intents adapter (S3) | adapter | `ext.rs`, `intake.rs::mt_on_transfer` | credit buyers whose USDC sits in `intents.near`; refund by return value | intents.near | 1 |
| S4 fallback | adapter (feature) | `contracts/core/src/s4.rs` | parse-and-forward a buyer-signed raw_ed25519 transfer | intents.near | 1 |
| Test doubles | test crates | `contracts/mock-*` | mock USDC, mock Verifier, mock factory | near-sdk | 1 |
| kruxa-sim + verify.sh | tooling | `tools/kruxa-sim`, `scripts/verify.sh` | recompute verdict / settlement with the contract's own code; `--tamper` | kruxa-logic | 1 |
| Sandbox suite | tests | `tests/` | 19 end-to-end and adversarial tests at Phase 0 [SYNC 2026-11-10: 33 test files, 100-attack gallery] | near-workspaces | 1 |
| App | Next.js | `app/` | landing, create, launch page (Walk), demo page [SYNC 2026-11-10: there is no `/demo` and no `/proof` route (ruled out: Kruxa is a real launchpad, APP-SPEC 2.1); Discover is `/`; the routes are listed in the 4.9 sync note; `llms.txt` and `AGENTS.md` are served] | near-api-js, wallet-selector | 1 |
| market | contract (`market.kruxa.near`) | `contracts/market/` (BUILT; ABI 1.1.2 in `docs/interfaces/MARKET-ABI.md`, running on testnet as `market3`) | constant-product pool, fee router, creator claims; referral and Hold Vault later | kruxa-logic | 3 (M-A pre-freeze) |
| venue service | TypeScript service | `services/venue/` (BUILT; devnet spike in `spikes/meteora/RESULTS.md`) | Meteora DAMM v2 spike and Squads proposal builder | Meteora, Squads | 2S |
| indexer and API | service | `services/indexer/`, `services/api/` (BUILT; OpenAPI 1.3.0 in `docs/interfaces/api.openapi.yaml`) | neardata ingest, candles, trades, launch feed, OpenAPI | neardata or RPC | 2I |
| check, agents, swarm, wallet layer | services and app libs | `swarm/`, `tools/swarm-sim/`, `app/lib/wallet/` (BUILT); `services/check/` and `agents/backer/` were CUT by CO-6 E-2 and do not exist | track modules and wallet chooser | see 5.12 | 3 |
| Solana genesis host + relayer | off-chain service | `relayer/` (BUILT; F0 and F1 ran on devnet, see 5.15) | G key, tx builder, Merkle pages, Jito distributor, claim page | @solana/web3.js 1.98.4 | 2 |
| Squads reserve | Solana multisig | `tools/squads/` (BUILT; devnet rehearsal in `evidence/genesis/squads-devnet-*.txt`) | reserve vault, Dami's 3 keys (disclosed single-party) | Squads | 2 |
| Verdict Rail | Solana SAS attestation | `tools/sas/` (NOT BUILT: stretch, cut; verify check C25 always skips) | rules-verified attestation per PASS | SAS | 4 |

## 2.1b PRD component map

[VERIFIED] - PRD.md section 2.2 components against the sections of this document.

| PRD component | Where it is specified here | Depth |
|---|---|---|
| C1 Core contract | Section 4.4 | full code |
| C2 Pure logic crates | Sections 4.2, 4.3 (`kruxa-types` folded, Section 3 row 22); `kruxa-sim` in 4.6 | full code |
| C3 Token provider | 4.4 `token.rs`; `burn_mode` in 5.6 | full code (factory), seam only (own FT) |
| C4 Intents intake | 4.4 `intake.rs`, `s4.rs` | full code |
| C5 Market contract | 5.1 | interface |
| C6 Hold Vault | 5.1 | interface |
| C7 Genesis relayer | 5.2 | interface |
| C8 Solana distribution | 5.2, 5.3 | interface |
| C9 Squads reserve | 5.3 | interface |
| C10 Verdict Rail | 5.4 | interface |
| C11 Verification tooling | 4.6 (`kruxa-sim`, `verify.sh`); C1-C34 Python checks in 5.2 | code for the NEAR-side recompute, interface for the Solana checks |
| C12 Web app | 4.9 (four of eleven routes) | full code for those four |
| C13 Agent/API layer | 5.7 | interface |
| C14 Indexer | 5.7 | interface |
| C15 Keeper and monitor | 4.8 `scripts/keeper.sh`; service form in 5.7 | script code, service interface |
| C16 Signed-test kit and harness | 4.5, 4.7 (harness); the kit itself lives in `warroom/signed-tests` | full code for the harness |

## 2.2 Data flow (end to end)

1. **Create.** Creator calls `create_trial(params, stream_recipient)` attaching `required_deposit(params)` (storage bond for `max_holders` positions plus the factory deposit). The contract validates numerics (`validate_params`), snapshots the rules into the Charter, hashes the Charter, calls the factory, and on the callback verifies `ft_balance_of(core) == supply` before opening.
2. **Commit.** Native buyers `ft_transfer_call` USDC with a `contribute` message. Solana buyers sign one transfer intent whose flat `msg` carries the same message; anyone submits it to `intents.near`, which moves the balance to core and calls `mt_on_transfer`. Every check runs before any mutation; a rejection returns the full amount (the Verifier refunds the signer's Intents balance, the token contract refunds the sender).
3. **Walk.** Step 1 (atomic): the position's open amount becomes `due`, `total_active` and `active_funders` shrink, the book hash folds a `walked` event. Step 2 (retryable): the `due` amount is paid with debit-before-outbound; a failed leg is re-credited in the callback.
4. **Verdict.** After `walk_end` anyone calls `settle`: a pure function of `(total_active, active_funders, soft_cap, min_funders, cancelled)`. No promise is made, so an outage elsewhere cannot block or change it.
5. **Settlement.** PASS creates four buckets (launch fee, LP seed, stream, excess-refund pool) that sum to `total_active`. Positions settle lazily (`settle_positions_page`, `claim_refund`, `claim_tokens`): spend rounds up, refund and tokens round down, dust goes to the LP bucket via `sweep_residue`.
6. **Money out.** Pull only: `claim_refund` (permissionless, destination fixed by the position), `claim_tokens` (holder), `consolidate` (Intents proceeds to native), `pay_launch_fee`, `draw` (stream cap), `pay_relay_fees`.

## 2.3 Sequence: S3 commit by a Phantom-only buyer

[VERIFIED] - message order reproduced in `tests/tests/intents.rs::s3_credits_net_of_relay_fee_and_rejects_by_refunding_the_signer` against the mock Verifier; the real Verifier's behaviour is W0 source-read.
```
# File: (diagram) S3 commit sequence
Buyer(Phantom)        Submitter (anyone)         intents.near                 core
   | sign transfer intent {receiver_id: core, tokens:{usdc:X}, msg:{v,op,launch_id,deliver:"sol:<key>",relay_fee}, min_gas:50Tgas}
   |---------------------->|                          |                         |
   |                       | execute_intents([signed])|                         |
   |                       |------------------------->| verify signature, nonce |
   |                       |                          | move X: buyer -> core   |
   |                       |                          | mt_on_transfer(sender=signer, [signer], [token], [X], msg)
   |                       |                          |------------------------>| predecessor == intents.near?
   |                       |                          |                         | parse msg, check_commit (net = X - fee)
   |                       |                          |                         | credit net to position(Solana key)
   |                       |                          |<--- returns [0] --------| (accept) or [X] (reject -> refunded to signer)
```

## 2.4 Sequence: Walk and verdict

[VERIFIED] - `tests/tests/lifecycle.rs::walk_shrinks_the_book_refunds_and_closes_at_walk_end`, `pass_undersubscribed_full_money_path`.
```
# File: (diagram) walk and settle sequence
phase:  Scheduled | Open (commit + Walk) | Closing (Walk only, book can only shrink) | Ready (frozen)
        opens_at     commit_end              walk_end
walk(id) ---- atomic: open -> due, total_active -= x, funders -= 1, book_hash fold ----> pay_due (debit-first)
                                                                                         |-- ft_transfer / mt_transfer
                                                                                         '-- on_payout: ok -> refunded ; fail -> due again
settle(id) after walk_end: verdict(inputs) -> PASS: 4 buckets, status Passed | FAIL: status Failed(reasons)
```

## 2.5 State machine

[VERIFIED] - `crates/kruxa-logic/src/settle.rs::phase_at` and `contracts/core/src/model.rs::Status`.

| From | To | Trigger | Who | Precondition (code if violated) |
|---|---|---|---|---|
| (none) | Creating | `create_trial` | any | not paused (R_PAUSED), no active trial (R_ACTIVE_TRIAL), symbol free (R_SYMBOL), params valid (R_*), deposit (R_DEPOSIT) |
| Creating | Open | `on_token_verified` | contract | supply at core equals `n_total` |
| Creating | CreationFailed | `on_token_created` / `on_token_verified` | contract | factory call failed or supply mismatch; `finalize_creation` retries after 10 minutes |
| Open | Failed(CANCELLED) | `cancel_trial` | creator | before `commit_end` (R_TOO_LATE) |
| Open | Passed / Failed(reasons) | `settle` | any | `now >= walk_end` (R_TOO_EARLY); not FROZEN |
| Failed | Dissolved | `dissolve` | any | every refund paid and every position deleted (R_NOT_CLEAR); a walker's record is deleted when its refund lands (it has `open == 0`, nothing to settle) |

Clock phases (Scheduled, Open, Closing, Ready) are derived, never stored, so nothing can fail to happen.

## 2.6 State management (what persists where)

[VERIFIED] - `contracts/core/src/lib.rs` and `model.rs`.

| State | Storage | Key | Notes |
|---|---|---|---|
| Config (accounts, rules, caps, pause) | contract root | n/a | `Rules::ladder()` or `demo_clock()` chosen at `new` |
| Charter | `LookupMap<u64, Charter>` | launch id | written once, never edited; its borsh hash is `charter_hash` |
| LaunchState (+ Ledger) | `LookupMap<u64, LaunchState>` | launch id | the only hot record per launch |
| Position | `LookupMap<(u64, HolderId), Position>` | (launch, holder) | deleted when nothing is owed either way |
| Sequence index | `LookupMap<(u64, u32), HolderId>` | (launch, seq) | paging for `settle_positions_page` and `list_positions` |
| Active trial per creator, symbols, Walk nonces | `LookupMap` / `LookupSet` | creator / symbol / ed25519 key | |
| Events | NEP-297 logs (`EVENT_JSON`, standard `kruxa`, 1.0.0) | n/a | bounded, no unbounded arrays |
Off-chain: nothing in Wave 1 holds state. The app reads views; `kruxa-sim` reads views.


---

# Section 3: Spec reconciliation log

Authority order: DECISIONS-PACK1 RULINGS (live copy, including 2026-11-07) > RECONCILED-INTERFACE > W0 > S1-A > S1-B/C/D. The S1 specs were not edited. Each row says what disagreed, what this architecture does, and where.

| # | Conflict | Resolution applied | Where |
|---|---|---|---|
| 1 | Entity name: S1-A `Launch` / S1-B `Trial` | `launch_id: u64`; `create_trial` and `trial_opened` keep "trial" (RECONCILED row 1) | `lifecycle.rs` |
| 2 | S1-B `finalize` vs S1-A `settle` | `settle` (A's name, B's semantics: promise-free, idempotent, permissionless) | `lifecycle.rs::settle` |
| 3 | S1-B `commit_via_intents` as the Solana entry vs W0 | `mt_on_transfer` is the primary entry (S3); `contribute_via_intents` is the S4 fallback behind cargo feature `s4-fallback`. Wire format uses flat `msg` / `min_gas`, no `notification` key (W0 OV1) | `intake.rs`, `s4.rs` |
| 4 | Storage constant: S1-A text said ~30 NEAR for 300 KB | 1e-5 NEAR per byte = 1e19 yocto; 300 KB costs ~3 NEAR. Single constant | `kruxa-logic/src/lib.rs` |
| 5 | Time base: B used ms, A ns | everything stored on NEAR is u64 ns from `env::block_timestamp()` | all |
| 6 | Caps: DECISIONS #28 said 10 NEAR / 50 NEAR | RULING 2026-11-07: $1,000 per launch and $3,000 global in USDC. Per launch it is `Rules.max_hard_cap`; global is `Config.global_cap` against `global_held` (actual custody, not reservations). Raising either is timelocked 7 days (`queue_*`, `apply_*`); lowering is instant | `rules.rs`, `admin.rs`, `intake.rs::check_commit` |
| 7 | **NEW, not in any spec:** a hard cap bounds the accepted raise, but oversubscription lets custody exceed it, which would defeat a USDC liability cap | `Rules.max_oversub_bps = 20_000`: `total_active` may reach 2x the hard cap (`Derived.max_total_held`), then commits are rejected with R_CAP_LAUNCH. Flagged for Dami: a RuleSet constant, one-line change | `rules.rs`, `intake.rs` |
| 8 | Relay fee: RECONCILED 8-16 says <= $0.50 and <= 5%, non-refundable; RULINGS 2026-11-07 lists the policy as open with "suggested <= 1% of commit" | Implemented the RECONCILED values as RuleSet constants (`max_relay_fee_abs`, `max_relay_fee_bps`); the 1% suggestion is a one-line change (`max_relay_fee_bps: 100`). Open item, Section 3.2 | `rules.rs` |
| 9 | Backer bonus vesting: RECONCILED shipped 0 days until Dami's OK | RULING 2026-11-07 approves 30-day linear: `backer_vest_days = 30`; `claim_tokens` releases `tokens + vested bonus`. Unclaimed-bonus burn (180 days) is Wave 3 [SYNC 2026-11-10: `claim_tokens` registers the holder on the launch token inside the claim (attach 1 yocto when registered, 0.00125 NEAR + 1 yocto when not; the rest is refunded). The unclaimed bonus is released by `sweep_tokens` after `bonus_sweep_after_secs` (180 days) to `burn_mode`, which defaults to `Hold` (nothing moves) because the factory token has no `ft_burn`; the default stream length in Studio is 30 days (minimum 30 days up to a $25,000 hard cap, 90 days above it, maximum 365)] | `rules.rs`, `payout.rs::claim_tokens` |
| 10 | Own-FT by hash (Route B) for real money vs "not approved" | Factory token for every launch (disclosed). `TokenProvider` trait exists; `TokenRoute::OwnGlobalByHash` is a reserved variant with no implementation | `token.rs`, `model.rs` |
| 11 | `ft_burn` of a dead token (A yes, B no, C partly) | Wave 1 does not burn: a FAILED launch's token stays in core forever, disclosed. `burn_mode` is Wave 0 probe item V-6 and Wave 3 design | LIMITATIONS |
| 12 | Ticker $CRUX vs $KRUXA | $KRUXA (ruling). `KRUXA` and 8 other symbols are reserved: only `Config.owner` may launch them, so the brand token cannot be squatted | `rules.rs::check_text` |
| 13 | Verdict rule: A had `min_hold_secs` | dropped; `params_hash` renamed `charter_hash` (RECONCILED row 10) | `verdict.rs` |
| 14 | Fourth settlement bucket | `Allocation.excess_pool`; identity L4 `launch_fee + lp_seed + stream + excess_pool == open + spent`, held after every lazy settlement; residue swept to the LP bucket | `settle.rs`, `ledger.rs`, `lifecycle.rs` |
| 15 | wNEAR math in S1-C | all quote math is 6-decimal USDC; market constants (`MIN_TRADE_QUOTE`, reserve bounds) are rebased in Section 5.1, not in Wave 1 | Section 5.1 |
| 16 | Positions deleted vs "never deleted" (A) | deleted once settled and nothing owed (B), so the creator bond can be returned. A Solana holder's position survives PASS until Wave 2 builds the Merkle tree, so the bond of a launch with Solana buyers returns only after Wave 2 | `lifecycle.rs::try_delete_position` |
| 17 | PAUSED blocking `settle` (A) vs "outage cannot block a verdict" (B) | `settle` is a pure function, so a guardian pause (which has no expiry) must not hold it hostage: it is blocked only by FROZEN (auto-expires in 7 days). A pause blocks NEW risk and outbound creator/platform money (`consolidate`, `pay_launch_fee`, `draw`, `pay_relay_fees`). Found while writing the code and covered by a test | `lifecycle.rs`, `payout.rs` |
| 18 | `check_solvency` / `reconcile_intents` (async anchor against `mt_balance_of`) | Not in Wave 1: `get_invariants` evaluates L1 and L4 on stored counters. The async anchor is Wave 1b, formula in Section 5.6 | Section 5.6 |
| 19 | `claim_refund_batch`, `claim_orphan_credit`, S1 relayer credit | cut / not built (RECONCILED cut order, R4). `walk_signed` is kept | n/a |
| 20 | Storage payer: holders pre-register (DECISIONS #25) vs creator bond (RECONCILED 26) | creator bond for all positions (A's measured 0.0033 NEAR per holder = 330 B x 1e-5); launch-token registration for claimants is the claimant's own step in Wave 1 (in-claim registration is Wave 1b) | `rules.rs::bond_required`, `payout.rs::claim_tokens` |
| 21 | Creator allocation / LP tokens | creator allocation is NEAR-only (ruling); in Wave 1 the creator and LP token buckets stay in core with no claim path (vesting is Wave 3, LP mirror Wave 2). Disclosed | LIMITATIONS |
| 22 | PRD C2 lists four pure crates (`kruxa-math`, `kruxa-types`, `kruxa-logic`, `kruxa-sim`) and a `validate_charter` | three crates plus the CLI: `kruxa-types` is folded into `kruxa-logic::rules` (ADR-001); `validate_charter` is `validate_params` (numeric) plus account checks in `create_trial`; `GenesisSpec` compiler and `memo/intent parse` for Solana are Wave 2 | `crates/` |
| 23 | Kickoff done-criterion W1-DC-3 lists `R_RAISE`, `R_CREATOR_TAKE`, `R_FEE_TOTAL` | RECONCILED 5.1 keeps B's `R_HARD_CAP` / `R_SOFT_CAP` instead of `R_RAISE`; the fee-router codes (`R_FEE_TOTAL`, `R_CREATOR_SHARE`, `R_CREATOR_TAKE`, `R_PLATFORM_*`, `R_HOLDER_RANGE`, `R_LP_RANGE`, `R_HOLDER_LP_FLOOR`, `R_REFERRAL`, `R_SPLIT_SUM`, `R_FEE_VEST`, `R_OPENING`) are validated in Wave 1 on `TrialParams.fees` and stored inert. Payees and creator-allocation vest codes (`R_PAYEES`, `R_VEST`) are Wave 3 | `rules.rs::check_fees` |
| 24 | PRD route names (`/launch/[id]`, `/demo`, `/launches`, `/portfolio`, ...) vs a draft naming | Wave 1 builds `/`, `/create`, `/launch/[id]`, `/demo` with the PRD names; the other seven routes are Wave 3 surfaces | `app/` |
| 25 | INVARIANTS NON-NEGOTIABLE 2: never say "100% principal back" | UI copy says the principal is returned to the account it came from, the platform takes no fee, moving it on from Intents to a Solana wallet costs an Intents withdrawal fee, and a relay fee is not refunded | `app/app/launch/[id]/page.tsx`, `app/app/page.tsx` |

## 3.1 RECONCILED patch list: applied or deferred

| Patch (RECONCILED 6) | Status in this architecture |
|---|---|
| 6.A S1-A 4.3 structs (`SupplyPlan` without `near_bps`, `TrialWindow{opens_at, commit_end, walk_end}`, `VerdictRule::SoftCap{min_raised, min_backers}`) | applied: `Charter` carries `opens_at/commit_end/walk_end`; `min_raised == soft_cap` is structural (the verdict reads `soft_cap`); no `near_bps` |
| 6.A 4.4 one USDC constant set, USD thresholds exact in micro-USDC | applied: `Rules` |
| 6.A 5.1-5.3 custody split, `due`, `spent`, four-bucket `allocate_pass` | applied: `Ledger`, `Position`, `settle` |
| 6.A 5.4/10.1 remove platform sponsorship, `credit_intake`, INTAKE role | applied: absent |
| 6.A 8.1 remove payable `contribute`; add `mt_on_transfer` with `deliver`, `relay_fee` | applied |
| 6.A 7.3 opening-fee decay, epoch helpers | deferred to Wave 3 (market owns fees) |
| 6.A 8.4 `burn_mode` | deferred (row 11) |
| 6.B 2.4 `min_buy` checked after the relay fee; relay fee bounds | applied: `check_commit` |
| 6.B 5.4 S3 row replaced by W0 text; S4 memo gains `fee=` | applied: `intake.rs`, `s4.rs` memo `kruxa:v1:t=<id>;d=sol:<key>;fee=<micro>` |
| 6.B 8.2-8.3 `finalize` -> `settle`, four buckets, `settle_positions_page` | applied |
| 6.B 14 cut order: keep `walk_signed` | applied |
| 6.C all wNEAR -> USDC; `R_RATCHET`; delete `release_lp` | market math deferred (Section 5.1); `release_lp` absent |
| 6.D genesis records, `GENESIS_RELAYER`, `pause_genesis`, `build_root_page` | interface level (Section 5.2) |

## 3.2 Unresolved (needs Dami; none blocks Wave 1 code)

1. Relay-fee ceiling: 5% / $0.50 (implemented) or the suggested 1% (row 8).
2. Oversubscription ceiling of 2x (row 7), and whether it should count toward the $3,000 global cap differently.
3. Reserve split vs a 15-30% reserve vault (RECONCILED item 4): `reserve_bps` does not exist in Wave 1.
4. Squads independents (R5), brand-token supply and allocation, launch-fee storage reserve vs "only genesis and attestation rent" (RECONCILED item 7), and whether the 0.1 NEAR storage reserve per launch is kept.
5. Genesis Round plan details (venue, LP seed path, Squads time lock): accepted in principle (YES, capped), details are Wave 2.
6. Live S3 test on mainnet (needs Dami's per-action go); Phantom byte-exactness of `signMessage` (W0 OV3).

## 3.3 W1-SCOPE-KICKOFF done-criteria against this architecture

[VERIFIED] - status taken from the runs recorded in Section 17; "No" rows are real gaps, not wording.

| ID | Status | Note |
|---|---|---|
| W1-DC-1 lint and test scripts, 1.95.0, `kruxa-math` has no near-sdk | Yes | `scripts/lint.sh`, `scripts/test.sh` ran clean |
| W1-DC-2 unit tests and golden examples | Partly | boundary, rounding, conservation and examples 1 and 2 are tested under different names than the kickoff ids; examples 3 and 4 (three-buyer rounding with token dust, boundary) are covered by `spec_example_three_rounding` and the boundary tests; no test id uses the `U-*` names |
| W1-DC-3 hostile presets | Yes | one failing case per code in `one_failing_case_per_code`; `R_RAISE` is split into `R_HARD_CAP` and `R_SOFT_CAP` (row 23) |
| W1-DC-4 lifecycle PASS and FAIL, `get_invariants` after every step | Partly | L1 and L4 are exposed and asserted after settlement and payouts; L3 is a per-position flag (`conserved`); I2 to I5 as separate view fields are not built |
| W1-DC-5 Walk, `walk_signed`, replay | Yes | `solana_walk_refunds_to_intents_and_walk_signed_checks_signature_nonce_and_deadline` |
| W1-DC-6 stream-lite and `STREAM_CAP` | Partly | exact string and cap are tested; the monotone-cap property test is `linear_unlock_monotone` in kruxa-math; the "draw before PASS refused" case is covered by `require_buckets_ready` but has no dedicated test |
| W1-DC-7 refund safety | Partly | callback failure and double refund tested; partial legs (native ok, Intents fails) and `A-REENTRANCY-REFUND` are not separate tests |
| W1-DC-8 intake against the REAL `intents.near` wasm | No | mock Verifier only; the real wasm run is Wave 0 step 4 |
| W1-DC-9 caps, timelock, pause, FROZEN auto-expiry | Partly | everything except the 7-day expiry, which the sandbox cannot reach cheaply |
| W1-DC-10 `kruxa-sim` verdict, settle, fold, validate | Partly | `verdict`, `settle`, `verify` exist; `fold`, `validate`, `fuzz`, `explain` do not; no `P-RECOMPUTE` property test |
| W1-DC-11 adversarial suite | Partly | self-buy, fake token, fake caller, caps, early settle covered; `A-DUST`, `A-TIMESTAMP-BOUNDARY`, `A-DONATION`, `A-SLOT-SPAM` as named tests are not |
| W1-DC-12 Wave 0 questions answered, `docs/benchmarks.md` | No | not run; Section 13.1 steps 4 to 6 |
| W1-DC-13 reproducible wasm and testnet deploy | No | non-reproducible build only; no deployment |
| W1-DC-14 gate G1 (stream-lite, settle, refund green) | Yes | met in the sandbox |


---

# Section 4: Wave 1 code

Every block in this section is a complete file. Order follows dependencies: workspace configuration, `kruxa-math`, `kruxa-logic`, the contract, test doubles, tooling, tests, scripts, app.

## 4.1 Workspace configuration

### Purpose
Pin every dependency and the toolchain; one release profile shared by all wasm artifacts (`overflow-checks = true` so arithmetic overflow aborts instead of wrapping).

### Code

[VERIFIED] - resolved and built by cargo 1.95.0; versions per S1-A 2.1
```toml
# File: Cargo.toml
[workspace]
resolver = "2"
members = ["crates/kruxa-math", "crates/kruxa-logic", "contracts/core", "contracts/mock-ft", "contracts/mock-intents", "contracts/mock-factory", "tools/kruxa-sim", "tests"]

[workspace.package]
edition = "2021"
rust-version = "1.95"
version = "0.1.0"
publish = false

[workspace.dependencies]
near-sdk = { version = "=5.30.1", default-features = false }
uint = { version = "=0.10.2", default-features = false }
proptest = "=1.12.0"
sha2 = { version = "0.10", default-features = false }
serde = { version = "1", default-features = false, features = ["derive", "alloc"] }
borsh = { version = "1", default-features = false, features = ["derive"] }

[profile.release]
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
```

[VERIFIED] - channel installed locally via rustup; S1-A 2.2
```toml
# File: rust-toolchain.toml
[toolchain]
channel = "1.95.0"
targets = ["wasm32-unknown-unknown"]
components = ["rustfmt", "clippy"]
```

[VERIFIED] - applied by `cargo fmt --all`; `scripts/lint.sh` enforces it
```toml
# File: rustfmt.toml
max_width = 140
use_small_heuristics = "Max"
edition = "2021"
```

### Key Decisions
`default-features = false` for near-sdk (S1-A 2.4); `universal-accounts` and `deterministic-account-ids` stay off because they are unneeded and unaudited (they need protocol 88, and mainnet now reports 88 [VERIFIED 2026-11-08], so the old protocol reason lapses). `uint` is pinned exactly because it provides the U256.

## 4.2 kruxa-math

### Purpose
The money arithmetic. `mul_div_floor/ceil` use a 256-bit intermediate so `a * b` can never overflow; rounding doctrine: charged amounts round up, paid amounts round down.

### Dependencies
`uint`, `serde` (decimal-string adapters so u128 survives JSON and JavaScript).

### Code

[VERIFIED] - built by cargo 1.95.0
```toml
# File: crates/kruxa-math/Cargo.toml
[package]
name = "kruxa-math"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[dependencies]
uint = { workspace = true }
serde = { workspace = true }

[dev-dependencies]
proptest = { workspace = true }
serde_json = "1"
```

[VERIFIED] - 8 unit + property tests pass (rustc 1.95.0, 2026-11-07); S1-A 7.1-7.2 rounding doctrine
```rust
// File: crates/kruxa-math/src/lib.rs
//! kruxa-math: pure integer math. No near-sdk, no I/O. Linked by the contract, kruxa-sim and verify.
#![forbid(unsafe_code)]

/// The macro expansion trips clippy lints we do not control; the allow is scoped to this module only.
#[allow(clippy::manual_div_ceil, clippy::assign_op_pattern)]
mod wide {
    uint::construct_uint! { pub struct U256(4); }
}
pub use wide::U256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    DivByZero,
    Overflow,
}

pub const BPS: u128 = 10_000;
pub const SEC_NS: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * SEC_NS;

fn narrow(x: U256) -> Result<u128, MathError> {
    if x > U256::from(u128::MAX) {
        Err(MathError::Overflow)
    } else {
        Ok(x.low_u128())
    }
}

/// floor(a * b / d) with a 256-bit intermediate. Never overflows internally.
pub fn mul_div_floor(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::DivByZero);
    }
    narrow(U256::from(a) * U256::from(b) / U256::from(d))
}

/// ceil(a * b / d) with a 256-bit intermediate.
pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> Result<u128, MathError> {
    if d == 0 {
        return Err(MathError::DivByZero);
    }
    let (q, r) = (U256::from(a) * U256::from(b)).div_mod(U256::from(d));
    narrow(if r.is_zero() { q } else { q + U256::one() })
}

pub fn bps_floor(amount: u128, bps: u16) -> Result<u128, MathError> {
    mul_div_floor(amount, bps as u128, BPS)
}

pub fn bps_ceil(amount: u128, bps: u16) -> Result<u128, MathError> {
    mul_div_ceil(amount, bps as u128, BPS)
}

pub fn days_to_ns(days: u64) -> Option<u64> {
    days.checked_mul(DAY_NS)
}

pub fn secs_to_ns(secs: u64) -> Option<u64> {
    secs.checked_mul(SEC_NS)
}

/// Saturating elapsed time in ns.
pub fn elapsed(now: u64, since: u64) -> u64 {
    now.saturating_sub(since)
}

/// Linear unlock: 0 at or before `t0`, `total` at or after `t0 + dur`, floor in between.
/// Used by the stream (creator proceeds) and the backer-bonus vest. Depends only on (constants, now).
pub fn linear_unlocked(total: u128, t0: u64, dur_ns: u64, now: u64) -> Result<u128, MathError> {
    if now <= t0 {
        return Ok(0);
    }
    let el = elapsed(now, t0);
    if dur_ns == 0 || el >= dur_ns {
        return Ok(total);
    }
    mul_div_floor(total, el as u128, dur_ns as u128)
}

/// serde adapters: u128/u64 as decimal strings, matching NEAR JSON conventions (JS safe).
pub mod dec {
    use serde::{Deserialize, Deserializer, Serializer};

    pub mod u128 {
        use super::*;
        pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
            s.serialize_str(&v.to_string())
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
            let s = String::deserialize(d)?;
            s.parse().map_err(serde::de::Error::custom)
        }
    }

    pub mod u64 {
        use super::*;
        pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
            s.serialize_str(&v.to_string())
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
            let s = String::deserialize(d)?;
            s.parse().map_err(serde::de::Error::custom)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn floor_and_ceil_basic() {
        assert_eq!(mul_div_floor(10, 3, 4), Ok(7));
        assert_eq!(mul_div_ceil(10, 3, 4), Ok(8));
        assert_eq!(mul_div_ceil(10, 4, 4), Ok(10));
    }

    #[test]
    fn handles_products_beyond_u128() {
        assert_eq!(mul_div_floor(u128::MAX, u128::MAX, u128::MAX), Ok(u128::MAX));
        assert_eq!(mul_div_floor(u128::MAX, 2, 1), Err(MathError::Overflow));
        assert_eq!(mul_div_floor(1, 1, 0), Err(MathError::DivByZero));
    }

    #[test]
    fn spec_example_three_rounding() {
        // S1-B 2.6 example 3: H = 100e6, three buyers of 50_000_001, sigma = 150_000_003.
        assert_eq!(mul_div_ceil(50_000_001, 100_000_000, 150_000_003), Ok(33_333_334));
    }

    #[test]
    fn decimal_string_serde_accepts_owned_and_borrowed_input() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct W(#[serde(with = "dec::u128")] u128);
        let v = serde_json::to_value(W(u128::MAX)).unwrap();
        assert_eq!(serde_json::from_value::<W>(v).unwrap(), W(u128::MAX), "owned strings (from_value) must work");
        assert_eq!(serde_json::from_str::<W>("\"7\"").unwrap(), W(7), "borrowed strings must work");
    }

    #[test]
    fn linear_unlock_bounds() {
        assert_eq!(linear_unlocked(1000, 100, 100, 100), Ok(0));
        assert_eq!(linear_unlocked(1000, 100, 100, 150), Ok(500));
        assert_eq!(linear_unlocked(1000, 100, 100, 999), Ok(1000));
    }

    proptest! {
        #[test]
        fn floor_le_ceil_le_floor_plus_one(a in any::<u128>(), b in any::<u128>(), d in 1u128..) {
            if let (Ok(f), Ok(c)) = (mul_div_floor(a, b, d), mul_div_ceil(a, b, d)) {
                prop_assert!(f <= c && c <= f + 1);
            }
        }

        #[test]
        fn identity_when_numerator_equals_denominator(a in any::<u128>(), d in 1u128..) {
            prop_assert_eq!(mul_div_floor(a, d, d), Ok(a));
            prop_assert_eq!(mul_div_ceil(a, d, d), Ok(a));
        }

        #[test]
        fn matches_u128_when_product_fits(a in 0u64.., b in 0u64.., d in 1u64..) {
            let (a, b, d) = (a as u128, b as u128, d as u128);
            prop_assert_eq!(mul_div_floor(a, b, d), Ok(a * b / d));
        }

        #[test]
        fn linear_unlock_monotone(total in 0u128..u64::MAX as u128, t0 in 0u64..1000, dur in 1u64..1000, n1 in 0u64..3000, n2 in 0u64..3000) {
            let (lo, hi) = if n1 <= n2 { (n1, n2) } else { (n2, n1) };
            prop_assert!(linear_unlocked(total, t0, dur, lo).unwrap() <= linear_unlocked(total, t0, dur, hi).unwrap());
        }
    }
}
```

### Key Decisions
`linear_unlocked` depends only on `(constants, now)`, never on previous draws, so draws are idempotent and replayable by `verify`. The `U256` macro expansion trips clippy lints we do not control; the `allow` is scoped to a private module.

## 4.3 kruxa-logic

### Purpose
Everything deterministic that is not arithmetic: rule codes and constants, parameter validation (check order is fixed), the verdict, the four-bucket allocation, per-position settlement, the rolling book hash, the ledger identities. No near-sdk, so it runs under plain `cargo test` and is linked unchanged by the contract, `kruxa-sim` and (as a TypeScript mirror pinned by test vectors) the app.

### Code

[VERIFIED] - built by cargo 1.95.0
```toml
# File: crates/kruxa-logic/Cargo.toml
[package]
name = "kruxa-logic"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[dependencies]
kruxa-math = { path = "../kruxa-math" }
sha2 = { workspace = true }
serde = { workspace = true }
borsh = { workspace = true }

[dev-dependencies]
proptest = { workspace = true }
serde_json = "1"
```

[VERIFIED] - compiled; constants per RULING R6 and S1-A patch 3.2
```rust
// File: crates/kruxa-logic/src/lib.rs
//! kruxa-logic: the deterministic core. Pure functions over integers and byte strings.
//! One-way dependency flow: kruxa-logic imports kruxa-math only. The contract, the CLI and the
//! tests import kruxa-logic; kruxa-logic never imports an I/O or chain crate.
#![forbid(unsafe_code)]

pub mod ledger;
pub mod rules;
pub mod settle;
pub mod verdict;

pub use ledger::{check_flow, check_pass_conservation, Buckets, LedgerTotals};
pub use rules::{bond_required, validate_params, Derived, FeeTerms, RuleCode, RuleViolation, Rules, TrialParams};
pub use settle::{allocate, launch_fee, phase_at, settle_position, Allocation, Phase, PositionSettlement};
pub use verdict::{book_next, hex, inputs_hash, verdict, Outcome, VerdictInputs};

/// The one name constant (RULING R6). No other crate or account may hard-code the string.
pub const PROJECT_NAME: &str = "Kruxa";
pub const EVENT_STANDARD: &str = "kruxa";
pub const EVENT_VERSION: &str = "1.0.0";
/// Ticker ruling 2026-11-07: $KRUXA.
pub const TICKER: &str = "KRUXA";
/// Storage price: 1e-5 NEAR per byte = 1e19 yocto (S1-A patch 3.2; NOT 1e-4).
pub const STORAGE_BYTE_COST_YOCTO: u128 = 10_000_000_000_000_000_000;
```

[VERIFIED] - 6 unit tests incl. one failing case per validation code and inclusive boundaries pass; rule values per S1-B 2.4 and RECONCILED 3.1/3.3
```rust
// File: crates/kruxa-logic/src/rules.rs
use borsh::{BorshDeserialize, BorshSerialize};
use kruxa_math::{dec, mul_div_ceil, MathError};
use serde::{Deserialize, Serialize};

use crate::STORAGE_BYTE_COST_YOCTO;

/// Append-only. The Borsh tag is the index; never reorder. Message format is always "CODE: text".
#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum RuleCode {
    RSymbol,
    RSupply,
    RBuckets,
    RAlloc,
    RHardCap,
    RSoftCap,
    RMinBuy,
    RWalletCap,
    RFunders,
    RPassable,
    RWindow,
    RStream,
    RCapGlobal,
    RCapLaunch,
    RActiveTrial,
    RDeposit,
    RPaused,
    RFrozen,
    RWrongPhase,
    RNotAuthorized,
    RMath,
    RUnexpectedToken,
    RTokenCreate,
    RMinContribution,
    RCapAccount,
    RCapHolders,
    RSelfBuy,
    RDeliver,
    RNoPosition,
    RSignedMsg,
    RSig,
    RNonce,
    RDeadline,
    RNothingFree,
    RNotClear,
    RTooEarly,
    RTooLate,
    RWalkClosed,
    RRelayFee,
    RSolvency,
    RNothing,
    RNotYet,
    RNoLaunch,
    RFeeTotal,
    RCreatorShare,
    RCreatorTake,
    RPlatformFloor,
    RPlatformFixed,
    RHolderRange,
    RLpRange,
    RHolderLpFloor,
    RReferral,
    RSplitSum,
    RFeeVest,
    ROpening,
}

impl RuleCode {
    pub fn as_str(&self) -> &'static str {
        use RuleCode::*;
        match self {
            RSymbol => "R_SYMBOL",
            RSupply => "R_SUPPLY",
            RBuckets => "R_BUCKETS",
            RAlloc => "R_ALLOC",
            RHardCap => "R_HARD_CAP",
            RSoftCap => "R_SOFT_CAP",
            RMinBuy => "R_MIN_BUY",
            RWalletCap => "R_WALLET_CAP",
            RFunders => "R_FUNDERS",
            RPassable => "R_PASSABLE",
            RWindow => "R_WINDOW",
            RStream => "R_STREAM",
            RCapGlobal => "R_CAP_GLOBAL",
            RCapLaunch => "R_CAP_LAUNCH",
            RActiveTrial => "R_ACTIVE_TRIAL",
            RDeposit => "R_DEPOSIT",
            RPaused => "R_PAUSED",
            RFrozen => "R_FROZEN",
            RWrongPhase => "R_WRONG_PHASE",
            RNotAuthorized => "R_NOT_AUTHORIZED",
            RMath => "R_MATH",
            RUnexpectedToken => "R_UNEXPECTED_TOKEN",
            RTokenCreate => "R_TOKEN_CREATE",
            RMinContribution => "R_MIN_CONTRIBUTION",
            RCapAccount => "R_CAP_ACCOUNT",
            RCapHolders => "R_CAP_HOLDERS",
            RSelfBuy => "R_SELF_BUY",
            RDeliver => "R_DELIVER",
            RNoPosition => "R_NO_POSITION",
            RSignedMsg => "R_SIGNED_MSG",
            RSig => "R_SIG",
            RNonce => "R_NONCE",
            RDeadline => "R_DEADLINE",
            RNothingFree => "R_NOTHING_FREE",
            RNotClear => "R_NOT_CLEAR",
            RTooEarly => "R_TOO_EARLY",
            RTooLate => "R_TOO_LATE",
            RWalkClosed => "R_WALK_CLOSED",
            RRelayFee => "R_RELAY_FEE",
            RSolvency => "R_SOLVENCY",
            RNothing => "R_NOTHING",
            RNotYet => "R_NOT_YET",
            RNoLaunch => "R_NO_LAUNCH",
            RFeeTotal => "R_FEE_TOTAL",
            RCreatorShare => "R_CREATOR_SHARE",
            RCreatorTake => "R_CREATOR_TAKE",
            RPlatformFloor => "R_PLATFORM_FLOOR",
            RPlatformFixed => "R_PLATFORM_FIXED",
            RHolderRange => "R_HOLDER_RANGE",
            RLpRange => "R_LP_RANGE",
            RHolderLpFloor => "R_HOLDER_LP_FLOOR",
            RReferral => "R_REFERRAL",
            RSplitSum => "R_SPLIT_SUM",
            RFeeVest => "R_FEE_VEST",
            ROpening => "R_OPENING",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleViolation {
    pub code: RuleCode,
    pub field: &'static str,
    pub got: String,
    pub limit: String,
}

impl RuleViolation {
    pub fn new(code: RuleCode, field: &'static str, got: impl ToString, limit: impl ToString) -> Self {
        Self { code, field, got: got.to_string(), limit: limit.to_string() }
    }
    /// "R_X: field = got violates limit". Always starts with the code so a UI or agent can match the prefix.
    pub fn message(&self) -> String {
        format!("{}: {} = {} violates {}", self.code.as_str(), self.field, self.got, self.limit)
    }
}

impl From<MathError> for RuleViolation {
    fn from(e: MathError) -> Self {
        RuleViolation::new(RuleCode::RMath, "math", format!("{:?}", e), "no overflow, no division by zero")
    }
}

/// The snapshot stored inside every Charter. USDC only, all money in micro-USDC (6 decimals).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Rules {
    pub rules_version: u16,
    pub decimals: u8,
    pub min_supply_whole: u64,
    pub max_supply_whole: u64,
    pub min_sale_bps: u16,
    pub max_sale_bps: u16,
    pub min_lp_bps: u16,
    pub max_lp_bps: u16,
    pub max_creator_bps: u16,
    pub max_backer_bps: u16,
    pub max_creator_plus_backer_bps: u16,
    #[serde(with = "dec::u128")]
    pub min_hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub max_hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub min_soft_abs: u128,
    pub min_soft_pct_bps: u16,
    #[serde(with = "dec::u128")]
    pub min_buy_abs: u128,
    pub min_buy_divisor: u32,
    pub wallet_bps_min: u16,
    pub wallet_bps_max: u16,
    pub wallet_floor_multiple: u32,
    pub funders_min: u32,
    pub funders_max: u32,
    pub min_commit_secs: u64,
    pub max_commit_secs: u64,
    pub min_tail_secs: u64,
    pub max_tail_secs: u64,
    pub max_open_delay_secs: u64,
    pub max_holders: u32,
    /// Oversubscription ceiling: total_active may reach hard_cap * max_oversub_bps / 10000 (liability cap per launch).
    pub max_oversub_bps: u32,
    #[serde(with = "dec::u128")]
    pub max_relay_fee_abs: u128,
    pub max_relay_fee_bps: u16,
    pub launch_fee_bps: u16,
    pub max_launch_fee_bps: u16,
    #[serde(with = "dec::u128")]
    pub launch_fee_min: u128,
    #[serde(with = "dec::u128")]
    pub launch_fee_max: u128,
    pub min_stream_days_small: u16,
    pub min_stream_days_large: u16,
    pub max_stream_days: u16,
    #[serde(with = "dec::u128")]
    pub stream_large_threshold: u128,
    /// 0 = bonus immediately claimable. Ruling 2026-11-07: 30-day linear.
    pub backer_vest_days: u16,
    // Fee-router ceilings (S1-A 6.2). The market that applies them is Wave 3; the Charter commits to them now.
    pub min_total_fee_bps: u16,
    pub max_total_fee_bps: u16,
    pub max_creator_share_bps: u16,
    /// Exact-integer form: total_fee_bps * creator_bps <= max_creator_take_bps * 10_000.
    pub max_creator_take_bps: u16,
    pub platform_bps: u16,
    pub min_platform_bps: u16,
    pub min_holders_bps: u16,
    pub max_holders_bps: u16,
    pub min_lp_fee_bps: u16,
    pub max_lp_fee_bps: u16,
    pub min_holders_plus_lp_bps: u16,
    pub max_referral_bps: u16,
    pub min_fee_vest_bps: u16,
    pub min_fee_vest_days: u16,
    pub max_fee_vest_days: u16,
    pub max_opening_fee_start_bps: u16,
    pub max_opening_decay_minutes: u16,
}

const USDC: u128 = 1_000_000;

impl Rules {
    /// Capped-ladder profile (RULING 2026-11-07): $1,000 per launch. The global $3,000 cap lives in Config.
    pub fn ladder() -> Self {
        Rules {
            rules_version: 1,
            decimals: 6,
            min_supply_whole: 10_000_000,
            max_supply_whole: 1_000_000_000_000,
            min_sale_bps: 5_000,
            max_sale_bps: 8_000,
            min_lp_bps: 1_500,
            max_lp_bps: 4_000,
            max_creator_bps: 2_000,
            max_backer_bps: 1_000,
            max_creator_plus_backer_bps: 2_500,
            min_hard_cap: 500 * USDC,
            max_hard_cap: 1_000 * USDC,
            min_soft_abs: 350 * USDC,
            min_soft_pct_bps: 2_000,
            min_buy_abs: 20 * USDC,
            min_buy_divisor: 500,
            wallet_bps_min: 50,
            wallet_bps_max: 500,
            wallet_floor_multiple: 5,
            funders_min: 10,
            funders_max: 500,
            min_commit_secs: 86_400,
            max_commit_secs: 2_592_000,
            min_tail_secs: 3_600,
            max_tail_secs: 172_800,
            max_open_delay_secs: 604_800,
            max_holders: 500,
            max_oversub_bps: 20_000,
            max_relay_fee_abs: USDC / 2,
            max_relay_fee_bps: 500,
            launch_fee_bps: 150,
            max_launch_fee_bps: 300,
            launch_fee_min: 10 * USDC,
            launch_fee_max: 2_500 * USDC,
            min_stream_days_small: 30,
            min_stream_days_large: 90,
            max_stream_days: 365,
            stream_large_threshold: 25_000 * USDC,
            backer_vest_days: 30,
            min_total_fee_bps: 30,
            max_total_fee_bps: 200,
            max_creator_share_bps: 6_000,
            max_creator_take_bps: 100,
            platform_bps: 1_500, // CO-5 D-4: was 2_000; DN-15 ruled platform 15% (equals the floor)
            min_platform_bps: 1_500,
            min_holders_bps: 1_000,
            max_holders_bps: 3_000,
            min_lp_fee_bps: 500,
            max_lp_fee_bps: 3_000,
            min_holders_plus_lp_bps: 2_000,
            max_referral_bps: 2_000,
            min_fee_vest_bps: 2_500,
            min_fee_vest_days: 30,
            max_fee_vest_days: 365,
            max_opening_fee_start_bps: 1_000,
            max_opening_decay_minutes: 120,
        }
    }

    /// Labelled demo profile (separate account, same wasm): clock compressed. Hostile-preset checks unchanged.
    pub fn demo_clock() -> Self {
        Rules { min_commit_secs: 90, min_tail_secs: 30, ..Rules::ladder() }
    }
}

/// Trading-fee terms committed in the Charter. In Wave 1 they are validated and stored but INERT: the market contract
/// that applies them is Wave 3 (RECONCILED market_mode). Committing now means a creator cannot loosen them later.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct FeeTerms {
    pub total_fee_bps: u16,
    pub creator_bps: u16,
    pub platform_bps: u16,
    pub holders_bps: u16,
    pub lp_bps: u16,
    pub referral_bps: u16,
    pub opening_fee_start_bps: u16,
    pub opening_decay_minutes: u16,
    pub fee_vest_bps: u16,
    pub fee_vest_days: u16,
}

impl FeeTerms {
    /// 1.00% total; creator 50%, platform 15%, holders 15%, LP 10%, referral 10%; creator take 0.50% of volume (DN-15 RULED, CO-5 D-4).
    pub fn standard() -> Self {
        FeeTerms {
            total_fee_bps: 100,
            creator_bps: 5_000,
            platform_bps: 1_500,
            holders_bps: 1_500,
            lp_bps: 1_000,
            referral_bps: 1_000,
            opening_fee_start_bps: 0,
            opening_decay_minutes: 0,
            fee_vest_bps: 5_000,
            fee_vest_days: 90,
        }
    }
}

/// Numeric launch parameters. Account-dependent checks (creator is not a payee, one active trial) live in the contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct TrialParams {
    pub symbol: String,
    pub name: String,
    pub total_supply_whole: u64,
    pub sale_bps: u16,
    pub lp_bps: u16,
    pub creator_bps: u16,
    pub backer_bps: u16,
    #[serde(with = "dec::u128")]
    pub hard_cap: u128,
    #[serde(with = "dec::u128")]
    pub soft_cap: u128,
    #[serde(with = "dec::u128")]
    pub min_buy: u128,
    pub wallet_bps: u16,
    pub min_funders: u32,
    pub open_delay_secs: u64,
    pub commit_secs: u64,
    pub tail_secs: u64,
    pub stream_days: u16,
    #[serde(default = "FeeTerms::standard")]
    pub fees: FeeTerms,
}

impl TrialParams {
    /// Spec defaults: 1B supply, 60/25/10/5, $1,000 hard cap, 35% soft cap, $20 min buy, 2% wallet, 10 funders.
    pub fn example(symbol: &str) -> Self {
        TrialParams {
            symbol: symbol.to_string(),
            name: format!("{} Test Token", symbol),
            total_supply_whole: 1_000_000_000,
            sale_bps: 6_000,
            lp_bps: 2_500,
            creator_bps: 1_000,
            backer_bps: 500,
            hard_cap: 1_000 * USDC,
            soft_cap: 350 * USDC,
            min_buy: 20 * USDC,
            wallet_bps: 200,
            min_funders: 10,
            open_delay_secs: 0,
            commit_secs: 86_400,
            tail_secs: 21_600,
            stream_days: 30,
            fees: FeeTerms::standard(),
        }
    }
}

/// Everything the contract derives from validated params. Token amounts in base units.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Derived {
    #[serde(with = "dec::u128")]
    pub n_total: u128,
    #[serde(with = "dec::u128")]
    pub n_sale: u128,
    #[serde(with = "dec::u128")]
    pub n_creator: u128,
    #[serde(with = "dec::u128")]
    pub n_backer: u128,
    #[serde(with = "dec::u128")]
    pub n_lp: u128,
    #[serde(with = "dec::u128")]
    pub wallet_cap: u128,
    #[serde(with = "dec::u128")]
    pub max_total_held: u128,
    pub max_holders: u32,
}

const RESERVED_SYMBOLS: [&str; 9] = ["KRUXA", "USDC", "USDT", "NEAR", "WNEAR", "SOL", "ETH", "BTC", "DAI"];

fn within<T: PartialOrd + std::fmt::Display>(code: RuleCode, field: &'static str, v: T, lo: T, hi: T) -> Result<(), RuleViolation> {
    if v < lo || v > hi {
        return Err(RuleViolation::new(code, field, &v, format!("{}..={}", lo, hi)));
    }
    Ok(())
}

fn check_text(p: &TrialParams, brand_ok: bool) -> Result<(), RuleViolation> {
    let sym_ok = (2..=12).contains(&p.symbol.len()) && p.symbol.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let reserved = RESERVED_SYMBOLS.contains(&p.symbol.as_str()) && !brand_ok;
    if !sym_ok || reserved {
        return Err(RuleViolation::new(RuleCode::RSymbol, "symbol", &p.symbol, "2..=12 of [A-Z0-9], not reserved"));
    }
    if p.name.is_empty() || p.name.len() > 32 || !p.name.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        return Err(RuleViolation::new(RuleCode::RSymbol, "name", &p.name, "1..=32 printable ASCII"));
    }
    Ok(())
}

fn check_buckets(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    within(RuleCode::RSupply, "total_supply_whole", p.total_supply_whole, r.min_supply_whole, r.max_supply_whole)?;
    within(RuleCode::RBuckets, "sale_bps", p.sale_bps, r.min_sale_bps, r.max_sale_bps)?;
    within(RuleCode::RBuckets, "lp_bps", p.lp_bps, r.min_lp_bps, r.max_lp_bps)?;
    within(RuleCode::RBuckets, "creator_bps", p.creator_bps, 0, r.max_creator_bps)?;
    within(RuleCode::RBuckets, "backer_bps", p.backer_bps, 0, r.max_backer_bps)?;
    let sum = p.sale_bps as u32 + p.lp_bps as u32 + p.creator_bps as u32 + p.backer_bps as u32;
    if sum != 10_000 {
        return Err(RuleViolation::new(RuleCode::RBuckets, "bucket sum", sum, "== 10000"));
    }
    let cb = p.creator_bps as u32 + p.backer_bps as u32;
    if cb > r.max_creator_plus_backer_bps as u32 {
        return Err(RuleViolation::new(RuleCode::RAlloc, "creator+backer bps", cb, r.max_creator_plus_backer_bps));
    }
    Ok(())
}

fn check_fees(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    let f = &p.fees;
    within(RuleCode::RFeeTotal, "total_fee_bps", f.total_fee_bps, r.min_total_fee_bps, r.max_total_fee_bps)?;
    within(RuleCode::RCreatorShare, "creator_bps", f.creator_bps, 0, r.max_creator_share_bps)?;
    let take = f.total_fee_bps as u64 * f.creator_bps as u64;
    if take > r.max_creator_take_bps as u64 * 10_000 {
        return Err(RuleViolation::new(
            RuleCode::RCreatorTake,
            "total_fee_bps*creator_bps",
            take,
            format!("<= {}", r.max_creator_take_bps as u64 * 10_000),
        ));
    }
    if f.platform_bps < r.min_platform_bps {
        return Err(RuleViolation::new(RuleCode::RPlatformFloor, "platform_bps", f.platform_bps, format!(">= {}", r.min_platform_bps)));
    }
    if f.platform_bps != r.platform_bps {
        return Err(RuleViolation::new(RuleCode::RPlatformFixed, "platform_bps", f.platform_bps, format!("== {}", r.platform_bps)));
    }
    within(RuleCode::RHolderRange, "holders_bps", f.holders_bps, r.min_holders_bps, r.max_holders_bps)?;
    within(RuleCode::RLpRange, "lp_bps", f.lp_bps, r.min_lp_fee_bps, r.max_lp_fee_bps)?;
    if f.holders_bps + f.lp_bps < r.min_holders_plus_lp_bps {
        return Err(RuleViolation::new(
            RuleCode::RHolderLpFloor,
            "holders_bps+lp_bps",
            f.holders_bps + f.lp_bps,
            format!(">= {}", r.min_holders_plus_lp_bps),
        ));
    }
    within(RuleCode::RReferral, "referral_bps", f.referral_bps, 0, r.max_referral_bps)?;
    let sum = [f.creator_bps, f.platform_bps, f.holders_bps, f.lp_bps, f.referral_bps].iter().map(|b| *b as u32).sum::<u32>();
    if sum != 10_000 {
        return Err(RuleViolation::new(RuleCode::RSplitSum, "fee split sum", sum, "== 10000"));
    }
    within(RuleCode::RFeeVest, "fee_vest_bps", f.fee_vest_bps, r.min_fee_vest_bps, 10_000)?;
    within(RuleCode::RFeeVest, "fee_vest_days", f.fee_vest_days, r.min_fee_vest_days, r.max_fee_vest_days)?;
    let (start, decay) = (f.opening_fee_start_bps, f.opening_decay_minutes);
    if (start == 0) != (decay == 0)
        || (start != 0 && (start < f.total_fee_bps || start > r.max_opening_fee_start_bps || decay > r.max_opening_decay_minutes))
    {
        return Err(RuleViolation::new(
            RuleCode::ROpening,
            "opening fee",
            format!("{start} bps over {decay} min"),
            "both zero, or start in total..=max over <= max minutes",
        ));
    }
    Ok(())
}

fn check_raise(p: &TrialParams, r: &Rules) -> Result<u128, RuleViolation> {
    within(RuleCode::RHardCap, "hard_cap", p.hard_cap, r.min_hard_cap, r.max_hard_cap)?;
    let soft_floor = r.min_soft_abs.max(mul_div_ceil(p.hard_cap, r.min_soft_pct_bps as u128, 10_000)?);
    if p.soft_cap < soft_floor || p.soft_cap > p.hard_cap {
        return Err(RuleViolation::new(RuleCode::RSoftCap, "soft_cap", p.soft_cap, format!("{}..={}", soft_floor, p.hard_cap)));
    }
    let min_buy_floor = r.min_buy_abs.max(mul_div_ceil(p.hard_cap, 1, r.min_buy_divisor as u128)?);
    if p.min_buy < min_buy_floor || p.min_buy > p.soft_cap {
        return Err(RuleViolation::new(RuleCode::RMinBuy, "min_buy", p.min_buy, format!(">= {}", min_buy_floor)));
    }
    within(RuleCode::RWalletCap, "wallet_bps", p.wallet_bps, r.wallet_bps_min, r.wallet_bps_max)?;
    within(RuleCode::RFunders, "min_funders", p.min_funders, r.funders_min, r.funders_max)?;
    if (p.min_funders as u128).saturating_mul(p.min_buy) > p.soft_cap {
        return Err(RuleViolation::new(
            RuleCode::RPassable,
            "min_funders*min_buy",
            p.min_funders as u128 * p.min_buy,
            format!("<= soft_cap {}", p.soft_cap),
        ));
    }
    let by_bps = mul_div_ceil(p.hard_cap, p.wallet_bps as u128, 10_000)?;
    Ok(by_bps.max(p.min_buy.saturating_mul(r.wallet_floor_multiple as u128)))
}

fn check_window(p: &TrialParams, r: &Rules) -> Result<(), RuleViolation> {
    within(RuleCode::RWindow, "commit_secs", p.commit_secs, r.min_commit_secs, r.max_commit_secs)?;
    within(RuleCode::RWindow, "tail_secs", p.tail_secs, r.min_tail_secs, r.max_tail_secs)?;
    within(RuleCode::RWindow, "open_delay_secs", p.open_delay_secs, 0, r.max_open_delay_secs)?;
    let need = if p.hard_cap <= r.stream_large_threshold { r.min_stream_days_small } else { r.min_stream_days_large };
    within(RuleCode::RStream, "stream_days", p.stream_days, need, r.max_stream_days)
}

/// Check order is fixed: text, buckets, raise, window/stream, caps. First violation wins.
/// `global_headroom` = global cap minus hard caps already reserved by other launches.
pub fn validate_params(p: &TrialParams, r: &Rules, global_headroom: u128, brand_ok: bool) -> Result<Derived, RuleViolation> {
    check_text(p, brand_ok)?;
    check_buckets(p, r)?;
    check_fees(p, r)?;
    let wallet_cap = check_raise(p, r)?;
    check_window(p, r)?;
    if p.hard_cap > global_headroom {
        return Err(RuleViolation::new(RuleCode::RCapGlobal, "hard_cap", p.hard_cap, format!("global headroom {}", global_headroom)));
    }
    let n_total = (p.total_supply_whole as u128) * 10u128.pow(r.decimals as u32);
    let part = |bps: u16| kruxa_math::bps_floor(n_total, bps);
    let (n_sale, n_creator, n_backer) = (part(p.sale_bps)?, part(p.creator_bps)?, part(p.backer_bps)?);
    let n_lp = n_total - n_sale - n_creator - n_backer;
    let cap_by_math = mul_div_ceil(2 * p.hard_cap, 1, p.min_buy)?;
    let max_holders = (r.max_holders as u128).min(cap_by_math) as u32;
    let max_total_held = kruxa_math::mul_div_floor(p.hard_cap, r.max_oversub_bps as u128, 10_000)?;
    Ok(Derived { n_total, n_sale, n_creator, n_backer, n_lp, wallet_cap, max_total_held, max_holders })
}

/// Position-storage bond the creator attaches (refundable): max_holders x bytes x 1e-5 NEAR + record overhead.
pub const POSITION_BYTES: u128 = 330;
pub const LAUNCH_RECORD_BYTES: u128 = 3_000;

pub fn bond_required(max_holders: u32) -> u128 {
    (max_holders as u128 * POSITION_BYTES + LAUNCH_RECORD_BYTES) * STORAGE_BYTE_COST_YOCTO
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(p: &TrialParams) -> Result<Derived, RuleViolation> {
        validate_params(p, &Rules::ladder(), 3_000 * USDC, false)
    }

    fn with_fees(base: &TrialParams, edit: impl FnOnce(&mut FeeTerms)) -> TrialParams {
        let mut p = base.clone();
        edit(&mut p.fees);
        p
    }

    fn code(p: &TrialParams) -> RuleCode {
        ok(p).unwrap_err().code
    }

    #[test]
    fn defaults_pass_and_derive() {
        let d = ok(&TrialParams::example("ABCD")).unwrap();
        assert_eq!(d.n_total, 1_000_000_000_000_000);
        assert_eq!(d.n_sale, 600_000_000_000_000);
        assert_eq!(d.n_lp, 250_000_000_000_000);
        assert_eq!(d.n_sale + d.n_creator + d.n_backer + d.n_lp, d.n_total);
        assert_eq!(d.wallet_cap, 100 * USDC);
        assert_eq!(d.max_holders, 100);
        assert_eq!(d.max_total_held, 2_000 * USDC);
    }

    #[test]
    fn one_failing_case_per_code() {
        let base = TrialParams::example("ABCD");
        let cases: Vec<(RuleCode, TrialParams)> = vec![
            (RuleCode::RSymbol, TrialParams { symbol: "abcd".into(), ..base.clone() }),
            (RuleCode::RSymbol, TrialParams { symbol: "USDC".into(), ..base.clone() }),
            (RuleCode::RSupply, TrialParams { total_supply_whole: 9_999_999, ..base.clone() }),
            (RuleCode::RBuckets, TrialParams { sale_bps: 5_900, ..base.clone() }),
            (RuleCode::RBuckets, TrialParams { sale_bps: 4_900, lp_bps: 3_600, ..base.clone() }),
            (RuleCode::RAlloc, TrialParams { creator_bps: 1_900, backer_bps: 700, sale_bps: 5_400, lp_bps: 2_000, ..base.clone() }),
            (RuleCode::RHardCap, TrialParams { hard_cap: 1_000 * USDC + 1, ..base.clone() }),
            (RuleCode::RHardCap, TrialParams { hard_cap: 499 * USDC, ..base.clone() }),
            (RuleCode::RSoftCap, TrialParams { soft_cap: 349 * USDC, ..base.clone() }),
            (RuleCode::RMinBuy, TrialParams { min_buy: 19 * USDC, ..base.clone() }),
            (RuleCode::RWalletCap, TrialParams { wallet_bps: 49, ..base.clone() }),
            (RuleCode::RFunders, TrialParams { min_funders: 9, ..base.clone() }),
            (RuleCode::RPassable, TrialParams { min_funders: 18, ..base.clone() }),
            (RuleCode::RWindow, TrialParams { commit_secs: 86_399, ..base.clone() }),
            (RuleCode::RWindow, TrialParams { tail_secs: 3_599, ..base.clone() }),
            (RuleCode::RFeeTotal, with_fees(&base, |f| f.total_fee_bps = 201)),
            (RuleCode::RFeeTotal, with_fees(&base, |f| f.total_fee_bps = 29)),
            (RuleCode::RCreatorShare, with_fees(&base, |f| f.creator_bps = 6_001)),
            (
                RuleCode::RCreatorTake,
                with_fees(&base, |f| {
                    f.total_fee_bps = 200;
                    f.creator_bps = 5_100;
                }),
            ),
            (RuleCode::RPlatformFloor, with_fees(&base, |f| f.platform_bps = 1_400)),
            (RuleCode::RPlatformFixed, with_fees(&base, |f| f.platform_bps = 2_100)),
            (RuleCode::RHolderRange, with_fees(&base, |f| f.holders_bps = 999)),
            (RuleCode::RLpRange, with_fees(&base, |f| f.lp_bps = 3_001)),
            (
                RuleCode::RHolderLpFloor,
                with_fees(&base, |f| {
                    f.holders_bps = 1_000;
                    f.lp_bps = 900;
                }),
            ),
            (RuleCode::RReferral, with_fees(&base, |f| f.referral_bps = 2_001)),
            (RuleCode::RSplitSum, with_fees(&base, |f| f.referral_bps = 400)),
            (RuleCode::RFeeVest, with_fees(&base, |f| f.fee_vest_bps = 2_499)),
            (RuleCode::ROpening, with_fees(&base, |f| f.opening_fee_start_bps = 500)),
            (RuleCode::RStream, TrialParams { stream_days: 29, ..base.clone() }),
        ];
        for (want, p) in cases {
            assert_eq!(code(&p), want, "{:?}", p);
        }
        let e = validate_params(&base, &Rules::ladder(), 999 * USDC, false).unwrap_err();
        assert_eq!(e.code, RuleCode::RCapGlobal);
        assert!(e.message().starts_with("R_CAP_GLOBAL: "));
    }

    #[test]
    fn boundaries_are_inclusive() {
        let base = TrialParams::example("ABCD");
        assert!(ok(&TrialParams { soft_cap: 350 * USDC, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { hard_cap: 1_000 * USDC, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { commit_secs: 86_400, tail_secs: 3_600, ..base.clone() }).is_ok());
        assert!(ok(&TrialParams { min_funders: 17, ..base.clone() }).is_ok());
        assert!(validate_params(&TrialParams::example("KRUXA"), &Rules::ladder(), 3_000 * USDC, true).is_ok());
    }

    #[test]
    fn json_without_fees_gets_the_standard_terms_and_roundtrips() {
        let mut v = serde_json::to_value(TrialParams::example("ABCD")).unwrap();
        v.as_object_mut().unwrap().remove("fees");
        let p: TrialParams = serde_json::from_value(v).unwrap();
        assert_eq!(p.fees, FeeTerms::standard());
        assert_eq!(p.hard_cap, 1_000 * USDC);
        let back: TrialParams = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn demo_clock_only_relaxes_time() {
        let mut p = TrialParams::example("ABCD");
        p.commit_secs = 90;
        p.tail_secs = 30;
        assert_eq!(code(&p), RuleCode::RWindow);
        assert!(validate_params(&p, &Rules::demo_clock(), 3_000 * USDC, false).is_ok());
    }

    #[test]
    fn storage_constant_is_1e5_near_per_byte() {
        assert_eq!(STORAGE_BYTE_COST_YOCTO, 10u128.pow(19));
        assert_eq!(bond_required(100), (100 * 330 + 3_000) * 10u128.pow(19));
    }
}
```

[VERIFIED] - 3 tests pass; algorithm per S1-B 4.1; hashes pinned by the TypeScript mirror's vitest
```rust
// File: crates/kruxa-logic/src/verdict.rs
use borsh::{BorshDeserialize, BorshSerialize};
use kruxa_math::dec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const BELOW_SOFT_CAP: u8 = 1;
pub const BELOW_MIN_FUNDERS: u8 = 2;
pub const CANCELLED: u8 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct VerdictInputs {
    #[serde(with = "dec::u64")]
    pub launch_id: u64,
    pub charter_hash: [u8; 32],
    #[serde(with = "dec::u128")]
    pub total_active: u128,
    pub active_funders: u32,
    #[serde(with = "dec::u128")]
    pub soft_cap: u128,
    pub min_funders: u32,
    pub cancelled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Outcome {
    Pass,
    /// Bitset of BELOW_SOFT_CAP, BELOW_MIN_FUNDERS, CANCELLED.
    Fail(u8),
}

/// The deterministic verdict. No floats, no clock, no address, no discretion.
pub fn verdict(i: &VerdictInputs) -> Outcome {
    let mut reasons = 0u8;
    if i.cancelled {
        reasons |= CANCELLED;
    }
    if i.total_active < i.soft_cap {
        reasons |= BELOW_SOFT_CAP;
    }
    if i.active_funders < i.min_funders {
        reasons |= BELOW_MIN_FUNDERS;
    }
    if reasons == 0 {
        Outcome::Pass
    } else {
        Outcome::Fail(reasons)
    }
}

/// Canonical byte encoding (little endian, fixed order). A judge recomputes this with any language.
pub fn encode_inputs(i: &VerdictInputs) -> Vec<u8> {
    let mut b = Vec::with_capacity(8 + 32 + 16 + 4 + 16 + 4 + 1);
    b.extend_from_slice(&i.launch_id.to_le_bytes());
    b.extend_from_slice(&i.charter_hash);
    b.extend_from_slice(&i.total_active.to_le_bytes());
    b.extend_from_slice(&i.active_funders.to_le_bytes());
    b.extend_from_slice(&i.soft_cap.to_le_bytes());
    b.extend_from_slice(&i.min_funders.to_le_bytes());
    b.push(i.cancelled as u8);
    b
}

pub fn inputs_hash(i: &VerdictInputs) -> [u8; 32] {
    Sha256::digest(encode_inputs(i)).into()
}

/// Rolling book hash: book_k = sha256(book_{k-1} || kind || len(holder) u16 || holder || amount u128 || total_after u128 || funders_after u32).
/// kind: 1 = contributed, 2 = walked. Updated by the contract on every commit and walk; replayed by verify.
pub fn book_next(prev: &[u8; 32], kind: u8, holder: &[u8], amount: u128, total_after: u128, funders_after: u32) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(prev);
    h.update([kind]);
    h.update((holder.len() as u16).to_le_bytes());
    h.update(holder);
    h.update(amount.to_le_bytes());
    h.update(total_after.to_le_bytes());
    h.update(funders_after.to_le_bytes());
    h.finalize().into()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(total: u128, funders: u32, cancelled: bool) -> VerdictInputs {
        VerdictInputs {
            launch_id: 7,
            charter_hash: [9; 32],
            total_active: total,
            active_funders: funders,
            soft_cap: 350_000_000,
            min_funders: 10,
            cancelled,
        }
    }

    #[test]
    fn boundary_is_inclusive() {
        assert_eq!(verdict(&inputs(350_000_000, 10, false)), Outcome::Pass);
        assert_eq!(verdict(&inputs(349_999_999, 10, false)), Outcome::Fail(BELOW_SOFT_CAP));
        assert_eq!(verdict(&inputs(350_000_000, 9, false)), Outcome::Fail(BELOW_MIN_FUNDERS));
    }

    #[test]
    fn empty_book_and_cancel() {
        assert_eq!(verdict(&inputs(0, 0, false)), Outcome::Fail(BELOW_SOFT_CAP | BELOW_MIN_FUNDERS));
        assert_eq!(verdict(&inputs(10u128.pow(12), 500, true)), Outcome::Fail(CANCELLED));
    }

    #[test]
    fn hash_changes_with_any_field_and_book_fold_is_order_sensitive() {
        let a = inputs(350_000_000, 10, false);
        let mut b = a;
        b.total_active += 1;
        assert_ne!(inputs_hash(&a), inputs_hash(&b));
        let z = [0u8; 32];
        let ab = book_next(&book_next(&z, 1, b"a.near", 5, 5, 1), 1, b"b.near", 7, 12, 2);
        let ba = book_next(&book_next(&z, 1, b"b.near", 7, 7, 1), 1, b"a.near", 5, 12, 2);
        assert_ne!(ab, ba);
        assert_eq!(hex(&[0, 255]), "00ff");
    }
}
```

[VERIFIED] - 5 tests incl. S1-B examples 1 and 2 to the unit and a proptest of conservation over random books pass
```rust
// File: crates/kruxa-logic/src/settle.rs
use kruxa_math::{bps_ceil, bps_floor, mul_div_ceil, mul_div_floor, MathError};
use serde::{Deserialize, Serialize};

use crate::rules::Rules;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Scheduled,
    Open,
    Closing,
    Ready,
}

/// Clock-derived phase. Nothing is stored, so nothing can fail to happen.
pub fn phase_at(now: u64, opens_at: u64, commit_end: u64, walk_end: u64) -> Phase {
    if now < opens_at {
        Phase::Scheduled
    } else if now < commit_end {
        Phase::Open
    } else if now < walk_end {
        Phase::Closing
    } else {
        Phase::Ready
    }
}

/// Launch fee = min(max_fee, 3% of A, max(ceil(1.5% of A), min_fee)). Rounded so the platform never loses a unit.
pub fn launch_fee(accepted: u128, r: &Rules) -> Result<u128, MathError> {
    let rate = bps_ceil(accepted, r.launch_fee_bps)?;
    let ceiling = bps_floor(accepted, r.max_launch_fee_bps)?;
    Ok(r.launch_fee_max.min(ceiling).min(rate.max(r.launch_fee_min)))
}

/// The four settlement buckets. launch_fee + lp_quote + stream + excess_pool == total_active, always.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Allocation {
    pub accepted: u128,
    pub launch_fee: u128,
    pub lp_quote: u128,
    pub stream: u128,
    pub excess_pool: u128,
}

pub fn allocate(total_active: u128, hard_cap: u128, sale_bps: u16, lp_bps: u16, r: &Rules) -> Result<Allocation, MathError> {
    let accepted = total_active.min(hard_cap);
    let fee = launch_fee(accepted, r)?;
    let lp_quote = mul_div_floor(accepted, lp_bps as u128, sale_bps as u128)?;
    let stream = accepted.checked_sub(fee).and_then(|x| x.checked_sub(lp_quote)).ok_or(MathError::Overflow)?;
    Ok(Allocation { accepted, launch_fee: fee, lp_quote, stream, excess_pool: total_active - accepted })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PositionSettlement {
    pub spend: u128,
    pub refund: u128,
    pub tokens: u128,
    pub bonus: u128,
}

/// Uniform-price pro-rata. Charged amounts round UP, paid amounts round DOWN; dust goes to the LP bucket.
pub fn settle_position(
    commit: u128,
    total_active: u128,
    accepted: u128,
    n_sale: u128,
    n_backer: u128,
) -> Result<PositionSettlement, MathError> {
    let spend = mul_div_ceil(commit, accepted, total_active)?;
    Ok(PositionSettlement {
        spend,
        refund: commit - spend,
        tokens: mul_div_floor(commit, n_sale, total_active)?,
        bonus: mul_div_floor(commit, n_backer, total_active)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const U: u128 = 1_000_000;

    #[test]
    fn spec_example_one_oversubscribed() {
        // S1-B 2.6 example 1 with H = 5,000 USDC, sigma = 12,500 USDC (rules relaxed to allow the cap).
        let r = Rules { max_hard_cap: 5_000 * U, ..Rules::ladder() };
        let a = allocate(12_500 * U, 5_000 * U, 6_000, 2_500, &r).unwrap();
        assert_eq!(a.launch_fee, 75_000_000);
        assert_eq!(a.lp_quote, 2_083_333_333);
        assert_eq!(a.stream, 2_841_666_667);
        assert_eq!(a.excess_pool, 7_500 * U);
        let s = settle_position(100 * U, 12_500 * U, a.accepted, 600_000_000_000_000, 50_000_000_000_000).unwrap();
        assert_eq!((s.spend, s.refund), (40 * U, 60 * U));
        assert_eq!(s.tokens, 4_800_000_000_000);
    }

    #[test]
    fn spec_example_two_undersubscribed_sells_everything_cheaper() {
        let r = Rules { max_hard_cap: 5_000 * U, ..Rules::ladder() };
        let a = allocate(2_000 * U, 5_000 * U, 6_000, 2_500, &r).unwrap();
        assert_eq!((a.accepted, a.excess_pool), (2_000 * U, 0));
        let s = settle_position(50 * U, 2_000 * U, a.accepted, 600_000_000_000_000, 0).unwrap();
        assert_eq!((s.spend, s.refund, s.tokens), (50 * U, 0, 15_000_000_000_000));
    }

    #[test]
    fn minimum_fee_applies_at_the_soft_cap() {
        let r = Rules::ladder();
        assert_eq!(launch_fee(350 * U, &r).unwrap(), 10 * U);
        assert_eq!(launch_fee(1_000 * U, &r).unwrap(), 15 * U);
    }

    #[test]
    fn phases_follow_the_clock() {
        assert_eq!(phase_at(5, 10, 20, 30), Phase::Scheduled);
        assert_eq!(phase_at(10, 10, 20, 30), Phase::Open);
        assert_eq!(phase_at(20, 10, 20, 30), Phase::Closing);
        assert_eq!(phase_at(30, 10, 20, 30), Phase::Ready);
    }

    proptest! {
        #[test]
        fn conservation_across_random_books(commits in proptest::collection::vec(20u128 * U..=100 * U, 10..60), hard in 500u128 * U..=1_000 * U) {
            let r = Rules::ladder();
            let total: u128 = commits.iter().sum();
            prop_assume!(total >= 350 * U);
            let (n_sale, n_backer) = (600_000_000_000_000u128, 50_000_000_000_000u128);
            let a = allocate(total, hard, 6_000, 2_500, &r).unwrap();
            prop_assert_eq!(a.launch_fee + a.lp_quote + a.stream + a.excess_pool, total);
            let (mut spend, mut refund, mut tokens, mut bonus) = (0u128, 0u128, 0u128, 0u128);
            for c in &commits {
                let s = settle_position(*c, total, a.accepted, n_sale, n_backer).unwrap();
                prop_assert_eq!(s.spend + s.refund, *c);
                spend += s.spend; refund += s.refund; tokens += s.tokens; bonus += s.bonus;
            }
            prop_assert_eq!(spend + refund, total);
            prop_assert!(spend >= a.accepted && spend - a.accepted < commits.len() as u128);
            prop_assert!(refund <= a.excess_pool);
            prop_assert!(tokens <= n_sale && bonus <= n_backer);
            prop_assert!(n_sale - tokens < commits.len() as u128);
        }
    }
}
```

[VERIFIED] - 2 tests pass; identities L1 and L4 (S1-A 5.3 as amended by RECONCILED 3.1)
```rust
// File: crates/kruxa-logic/src/ledger.rs
use serde::{Deserialize, Serialize};

/// Per-launch money counters (micro-USDC). Every unit credited is in exactly one of these places.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerTotals {
    pub credited: u128,
    pub open: u128,
    pub due: u128,
    pub in_flight: u128,
    pub refunded: u128,
    pub spent: u128,
}

/// L1 flow conservation: credited == open + due + in_flight + refunded + spent.
pub fn check_flow(t: &LedgerTotals) -> Result<(), &'static str> {
    let sum = t
        .open
        .checked_add(t.due)
        .and_then(|x| x.checked_add(t.in_flight))
        .and_then(|x| x.checked_add(t.refunded))
        .and_then(|x| x.checked_add(t.spent));
    if sum == Some(t.credited) {
        Ok(())
    } else {
        Err("L1: credited != open + due + in_flight + refunded + spent")
    }
}

/// Settlement buckets after PASS.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Buckets {
    pub launch_fee_due: u128,
    pub lp_seed_due: u128,
    pub stream_total: u128,
    pub excess_pool: u128,
}

/// L4: launch_fee + lp_seed + stream + excess_pool == open + spent. Holds at settle and after every lazy position settlement.
pub fn check_pass_conservation(b: &Buckets, open: u128, spent: u128) -> Result<(), &'static str> {
    let lhs = b.launch_fee_due + b.lp_seed_due + b.stream_total + b.excess_pool;
    if lhs == open + spent {
        Ok(())
    } else {
        Err("L4: buckets != open + spent")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_detects_a_missing_unit() {
        let ok = LedgerTotals { credited: 100, open: 40, due: 20, in_flight: 10, refunded: 5, spent: 25 };
        assert!(check_flow(&ok).is_ok());
        assert!(check_flow(&LedgerTotals { spent: 24, ..ok }).is_err());
    }

    #[test]
    fn pass_conservation_survives_a_lazy_settlement_step() {
        let b = Buckets { launch_fee_due: 10, lp_seed_due: 40, stream_total: 50, excess_pool: 100 };
        assert!(check_pass_conservation(&b, 200, 0).is_ok());
        // one position (commit 60) settles: spend 18, refund 42 -> excess_pool -= 42, open -= 60, spent += 18
        let after = Buckets { excess_pool: 58, ..b };
        assert!(check_pass_conservation(&after, 140, 18).is_ok());
    }
}
```

### Key Decisions
- **Verdict inputs are four numbers and a flag** (`total_active`, `active_funders`, `soft_cap`, `min_funders`, `cancelled`) plus the Charter hash that pins the thresholds. `total_active` is gross, so oversubscription changes allocation, never the verdict.
- **Fee formula** `min(max_fee, 3% of A, max(ceil(1.5% of A), min_fee))` (RECONCILED row 33): at the soft cap ($350) the $10 minimum is 2.86%, under the 3% ceiling.
- **L4 holds step by step**, not just at the end: when a position settles, `open` and the `excess_pool` both fall by its refund. That is what lets the contract assert conservation after every lazy settlement.

## 4.4 kruxa-core (the contract)

### Purpose
The only module that touches the chain. [SYNC 2026-11-10: the list below is the Wave 1 list as first written; the final method set is in 5.15 and `docs/interfaces/CORE-ABI.md`. Beyond the list, the built core adds `open_beta`, `set_market`, `open_market` (returns `u8`, not `Promise`), `set_genesis_relayer`, `pause_genesis`, `resume_genesis`, `reopen_genesis`, `register_f0_message`, `sign_genesis`, `get_phase`, `preview_charter`, `preview_settlement`, `declared_wallets`, `get_book_hash`, `get_market_link`, `get_genesis`, `get_genesis_spec`] Public methods (Wave 1): `new`, `create_trial`, `on_token_created`, `on_token_verified`, `finalize_creation`, `ft_on_transfer`, `mt_on_transfer`, `contribute_via_intents` (feature), `on_contribute_intents`, `walk`, `walk_signed`, `cancel_trial`, `settle`, `settle_positions_page`, `sweep_residue`, `claim_refund`, `claim_tokens`, `consolidate`, `pay_launch_fee`, `draw`, `pay_relay_fees`, `on_payout`, `dissolve`, `reclaim_bond`, `pause`, `freeze`, `unpause`, `lower_global_cap`, `queue_global_cap`, `apply_global_cap`, `queue_launch_cap`, `apply_launch_cap`, and the views `get_config`, `get_charter`, `get_state`, `get_ledger`, `get_position`, `list_positions`, `get_verdict_inputs`, `get_settlement`, `preview_contribution`, `required_deposit`, `get_invariants`.

### Dependencies
`near-sdk`, `kruxa-logic`, `kruxa-math`. External calls go to the USDC contract, `intents.near`, the token factory and the launch token only.

### Code

[VERIFIED] - built by cargo-near 0.23.0; reproducible-build image tag is UNVERIFIED (S1-A 2.4: run `cargo near build reproducible-wasm` once and use the tag it prints)
```toml
# File: contracts/core/Cargo.toml
[package]
name = "kruxa-core"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = ["s4-fallback"]
# S4 fallback: buyer-signed intent parsed and forwarded by anyone (S3 mt_on_transfer is the primary path).
s4-fallback = []

[dependencies]
near-sdk = { workspace = true }
kruxa-math = { path = "../../crates/kruxa-math" }
kruxa-logic = { path = "../../crates/kruxa-logic" }

[dev-dependencies]
near-sdk = { workspace = true, features = ["unit-testing"] }

[package.metadata.near.reproducible_build]
image = "sourcescan/cargo-near:0.23.0-rust-1.95.0"
image_digest = ""
passed_env = []
container_build_command = ["cargo", "near", "build", "non-reproducible-wasm", "--locked"]
```

[VERIFIED] - compiled to wasm and exercised by the 19-test sandbox suite (2026-11-07)
```rust
// File: contracts/core/src/lib.rs
//! kruxa-core: the NEAR contract. Wave 1 = trial lifecycle (create, commit, Walk, settle, refunds, claims).
//! Dependency direction: kruxa-core -> kruxa-logic -> kruxa-math. The pure crates never import this one.
#![forbid(unsafe_code)]
// The one init method takes the eight account/profile parameters explicitly; the near macro repeats the lint on its wrapper.
#![allow(clippy::too_many_arguments)]

mod admin;
mod events;
mod ext;
mod intake;
mod lifecycle;
mod model;
mod payout;
#[cfg(feature = "s4-fallback")]
mod s4;
mod token;
mod views;

use kruxa_logic::{RuleCode, Rules};
use model::*;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const GAS_OUT: Gas = Gas::from_tgas(20);
pub const GAS_CB: Gas = Gas::from_tgas(25);
pub const CREATION_TIMEOUT_NS: u64 = 600_000_000_000;
pub const FREEZE_MAX_NS: u64 = 7 * 86_400_000_000_000;
pub const CAP_TIMELOCK_NS: u64 = 7 * 86_400_000_000_000;
pub const GLOBAL_CAP_USDC: u128 = 3_000_000_000;
pub const FACTORY_DEPOSIT_YOCTO: u128 = 60_000_000_000_000_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Charters,
    States,
    Positions,
    SeqIndex,
    ActiveByCreator,
    Symbols,
    WalkNonces,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    cfg: Config,
    charters: LookupMap<u64, Charter>,
    states: LookupMap<u64, LaunchState>,
    positions: LookupMap<(u64, HolderId), Position>,
    seq_index: LookupMap<(u64, u32), HolderId>,
    active_by_creator: LookupMap<AccountId, u64>,
    symbols: LookupSet<String>,
    walk_nonces: LookupMap<[u8; 32], u64>,
    next_launch_id: u64,
}

/// Every panic message starts with the rule code so a UI or agent can match on the prefix.
pub(crate) fn fail(code: RuleCode, text: &str) -> ! {
    env::panic_str(&format!("{}: {}", code.as_str(), text))
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        treasury: AccountId,
        relay_fees: AccountId,
        usdc: AccountId,
        intents: AccountId,
        factory: AccountId,
        profile: String,
    ) -> Self {
        let rules = if profile == "demo" { Rules::demo_clock() } else { Rules::ladder() };
        let cfg = Config {
            owner,
            guardian,
            treasury,
            relay_fees,
            usdc_token_id: format!("nep141:{}", usdc),
            usdc,
            intents,
            factory,
            rules,
            global_cap: GLOBAL_CAP_USDC,
            pending_global_cap: None,
            pending_launch_cap: None,
            global_held: 0,
            pause: PauseLevel::None,
            frozen_until: 0,
            factory_deposit: FACTORY_DEPOSIT_YOCTO,
            profile,
        };
        Self {
            cfg,
            charters: LookupMap::new(Key::Charters),
            states: LookupMap::new(Key::States),
            positions: LookupMap::new(Key::Positions),
            seq_index: LookupMap::new(Key::SeqIndex),
            active_by_creator: LookupMap::new(Key::ActiveByCreator),
            symbols: LookupSet::new(Key::Symbols),
            walk_nonces: LookupMap::new(Key::WalkNonces),
            next_launch_id: 1,
        }
    }
}

impl Contract {
    pub(crate) fn charter(&self, id: u64) -> Charter {
        self.charters.get(&id).cloned().unwrap_or_else(|| fail(RuleCode::RNoLaunch, &format!("launch {} not found", id)))
    }

    pub(crate) fn state(&self, id: u64) -> LaunchState {
        self.states.get(&id).cloned().unwrap_or_else(|| fail(RuleCode::RNoLaunch, &format!("launch {} not found", id)))
    }

    pub(crate) fn save_state(&mut self, id: u64, st: LaunchState) {
        self.states.insert(id, st);
    }

    /// Pause level with the FROZEN auto-expiry applied on read: no transaction is needed to lift it.
    pub(crate) fn pause_level(&self) -> PauseLevel {
        match self.cfg.pause {
            PauseLevel::Frozen if env::block_timestamp() >= self.cfg.frozen_until => PauseLevel::Paused,
            p => p,
        }
    }

    /// New risk is blocked while PAUSED or FROZEN.
    pub(crate) fn require_live(&self) {
        match self.pause_level() {
            PauseLevel::None => {}
            PauseLevel::Paused => fail(RuleCode::RPaused, "new activity is paused; exits stay open"),
            PauseLevel::Frozen => fail(RuleCode::RFrozen, "frozen by guardian"),
        }
    }

    /// Exits (Walk, refunds, claims) stay open while PAUSED, close only while FROZEN.
    pub(crate) fn require_exit_open(&self) {
        if self.pause_level() == PauseLevel::Frozen {
            fail(RuleCode::RFrozen, "frozen by guardian");
        }
    }
}
```

[VERIFIED] - compiled; exercised by the sandbox suite
```rust
// File: contracts/core/src/model.rs
use kruxa_logic::{hex, Derived, Rules, TrialParams};
use near_sdk::{bs58, near, AccountId};

/// Who owns a position. A 64-hex Intents signer is a Solana key only if `deliver` says so (RECONCILED row 13).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum HolderId {
    Near(AccountId),
    Solana([u8; 32]),
}

impl HolderId {
    /// Stable text key used in events, views, the book hash and the walk_signed preimage.
    pub fn key(&self) -> String {
        match self {
            HolderId::Near(a) => format!("near:{}", a),
            HolderId::Solana(b) => format!("sol:{}", bs58::encode(b).into_string()),
        }
    }

    pub fn parse(s: &str) -> Option<HolderId> {
        if let Some(a) = s.strip_prefix("near:") {
            return a.parse().ok().map(HolderId::Near);
        }
        let raw = bs58::decode(s.strip_prefix("sol:")?).into_vec().ok()?;
        <[u8; 32]>::try_from(raw.as_slice()).ok().map(HolderId::Solana)
    }

    /// The account that holds this holder's balance inside intents.near.
    pub fn intents_account(&self) -> AccountId {
        match self {
            HolderId::Near(a) => a.clone(),
            HolderId::Solana(b) => hex(b).parse().expect("64 hex chars is a valid implicit account id"),
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Custody {
    Native,
    Intents,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseLevel {
    None,
    Paused,
    Frozen,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenRoute {
    FactoryPrimitives,
    /// Reserved: own immutable FT published by hash. Not approved (RULING 2026-11-07), trait seam only.
    OwnGlobalByHash([u8; 32]),
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Charter {
    pub launch_id: u64,
    pub creator: AccountId,
    pub stream_recipient: AccountId,
    pub created_at: u64,
    pub params: TrialParams,
    pub derived: Derived,
    pub rules: Rules,
    pub opens_at: u64,
    pub commit_end: u64,
    pub walk_end: u64,
    pub route: TokenRoute,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Creating,
    CreationFailed,
    Open,
    Passed,
    /// Reason bitset: 1 below soft cap, 2 below min funders, 4 cancelled.
    Failed(u8),
    Dissolved,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Ledger {
    pub credited: u128,
    pub open_native: u128,
    pub open_intents: u128,
    pub due_native: u128,
    pub due_intents: u128,
    pub inflight_native: u128,
    pub inflight_intents: u128,
    pub refunded: u128,
    pub spent_native: u128,
    pub spent_intents: u128,
    pub consolidated: u128,
    pub consolidating: u128,
    pub excess_pool: u128,
    pub launch_fee_due: u128,
    pub launch_fee_paid: u128,
    pub launch_fee_inflight: u128,
    pub lp_seed_due: u128,
    pub stream_total: u128,
    pub stream_drawn: u128,
    pub stream_inflight: u128,
    pub relay_fee_total: u128,
    pub relay_fee_paid: u128,
    pub relay_fee_inflight: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Settlement {
    pub pass: bool,
    pub reasons: u8,
    pub settled_at: u64,
    pub total_active: u128,
    pub accepted: u128,
    pub launch_fee: u128,
    pub lp_quote: u128,
    pub stream: u128,
    pub excess_pool: u128,
    pub inputs_hash: [u8; 32],
    pub book_hash: [u8; 32],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct LaunchState {
    pub charter_hash: [u8; 32],
    pub status: Status,
    pub halted: bool,
    pub cancelled: bool,
    pub token: Option<AccountId>,
    pub total_active: u128,
    pub active_funders: u32,
    pub holder_count: u32,
    pub positions_live: u32,
    pub positions_unsettled: u32,
    pub residue_swept: bool,
    pub bond: u128,
    pub bond_reclaimed: bool,
    pub book_hash: [u8; 32],
    pub ledger: Ledger,
    pub settlement: Option<Settlement>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Position {
    pub seq: u32,
    pub deliver: HolderId,
    pub referrer: Option<AccountId>,
    pub contributed: u128,
    pub open_native: u128,
    pub open_intents: u128,
    pub due_native: u128,
    pub due_intents: u128,
    pub inflight_native: u128,
    pub inflight_intents: u128,
    pub refunded: u128,
    pub spent: u128,
    pub tokens_entitled: u128,
    pub bonus_entitled: u128,
    pub claimed: u128,
    pub settled: bool,
}

impl Position {
    pub fn open(&self) -> u128 {
        self.open_native + self.open_intents
    }
    pub fn owed(&self) -> u128 {
        self.due_native + self.due_intents
    }
    pub fn inflight(&self) -> u128 {
        self.inflight_native + self.inflight_intents
    }
    /// L3: contributed == open + due + in_flight + refunded + spent.
    pub fn conserved(&self) -> bool {
        self.contributed == self.open() + self.owed() + self.inflight() + self.refunded + self.spent
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub treasury: AccountId,
    pub relay_fees: AccountId,
    pub usdc: AccountId,
    pub usdc_token_id: String,
    pub intents: AccountId,
    pub factory: AccountId,
    pub rules: Rules,
    pub global_cap: u128,
    pub pending_global_cap: Option<(u128, u64)>,
    pub pending_launch_cap: Option<(u128, u64)>,
    pub global_held: u128,
    pub pause: PauseLevel,
    pub frozen_until: u64,
    pub factory_deposit: u128,
    pub profile: String,
}
```

[VERIFIED] - compiled; events asserted in tests via logs
```rust
// File: contracts/core/src/events.rs
use kruxa_logic::{EVENT_STANDARD, EVENT_VERSION};
use near_sdk::log;
use near_sdk::serde_json::{json, Value};

/// NEP-297 event. `data` is always a single object; no unbounded arrays (log stays well under 16 KB).
pub fn emit(event: &str, data: Value) {
    log!("EVENT_JSON:{}", json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] }));
}
```

[UNVERIFIED] - compiles and works against the mocks; real `intents.near` signatures (`mt_transfer` with `approval, memo`; `ft_withdraw(token, receiver_id, amount, memo, msg)`; `execute_intents`) are from W0 and S1-B, not exercised live
```rust
// File: contracts/core/src/ext.rs
use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::{ext_contract, AccountId};

/// NEP-141 surface used by the core (USDC and the launch token).
#[allow(dead_code)] // the trait only exists to generate the ext_ft call builders
#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

/// intents.near surface: NEP-245 transfer, ft_withdraw to native, and execute_intents for S4.
#[allow(dead_code)] // the trait only exists to generate the ext_intents call builders
#[ext_contract(ext_intents)]
pub trait ExtIntents {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
    fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128;
    fn ft_withdraw(&mut self, token: AccountId, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: Option<String>);
    fn execute_intents(&mut self, signed: Vec<Value>);
}
```

[UNVERIFIED] - compiles; the `create_token` call shape is from S1-A 8.4 (`{"args":{owner_id,total_supply,metadata}}`) and the mock enforces it; the real factory is a Wave 0 testnet probe against `token.primitives.testnet`
```rust
// File: contracts/core/src/token.rs
use kruxa_logic::TrialParams;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, Gas, NearToken, Promise};

use crate::model::TokenRoute;

/// The seam that lets the own-FT-by-hash route be added later without touching the lifecycle.
pub trait TokenProvider {
    fn route(&self) -> TokenRoute;
    /// The account the launch token will live at.
    fn token_account(&self, p: &TrialParams) -> AccountId;
    /// Promise that creates the token with its whole supply minted to `owner`.
    fn create(&self, p: &TrialParams, supply_base: u128, owner: &AccountId, deposit: u128) -> Promise;
}

/// Default for every launch (RULING 2026-11-07): token.primitives factory, disclosed as a trust caveat.
pub struct FactoryPrimitives {
    pub factory: AccountId,
}

impl TokenProvider for FactoryPrimitives {
    fn route(&self) -> TokenRoute {
        TokenRoute::FactoryPrimitives
    }

    fn token_account(&self, p: &TrialParams) -> AccountId {
        format!("{}.{}", p.symbol.to_lowercase(), self.factory).parse().expect("symbol is [A-Z0-9], factory is a valid account")
    }

    fn create(&self, p: &TrialParams, supply_base: u128, owner: &AccountId, deposit: u128) -> Promise {
        let args = json!({ "args": {
            "owner_id": owner,
            "total_supply": supply_base.to_string(),
            "metadata": { "spec": "ft-1.0.0", "name": p.name, "symbol": p.symbol, "decimals": 6 }
        }});
        Promise::new(self.factory.clone()).function_call(
            "create_token".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(deposit),
            Gas::from_tgas(80),
        )
    }
}
```

[UNVERIFIED] - compiles; native path, S3 and walk_signed pass sandbox tests against the mock Verifier; real `mt_on_transfer` semantics are W0 source-read (sender_id = signer, return amounts = refund), live confirmation pending the approved <= $1 test
```rust
// File: contracts/core/src/intake.rs
use crate::ContractExt;
use kruxa_logic::{book_next, hex, phase_at, Phase, RuleCode, RuleViolation};
use kruxa_math::bps_floor;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::{assert_one_yocto, bs58, env, near, AccountId, PromiseOrValue};

use crate::events::emit;
use crate::model::*;
use crate::{fail, Contract};

/// Commit message carried by ft_transfer_call (native path) and by the signed intent's flat `msg` (S3 path).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
pub struct IntakeMsg {
    pub v: u8,
    pub op: String,
    pub launch_id: String,
    pub deliver: Option<String>,
    pub relay_fee: Option<String>,
    pub referrer: Option<AccountId>,
}

pub(crate) fn parse_msg(msg: &str) -> Result<(u64, IntakeMsg), RuleViolation> {
    let bad = |t: &str| RuleViolation::new(RuleCode::RSignedMsg, "msg", t, "v1 contribute JSON <= 512 bytes");
    if msg.len() > 512 {
        return Err(bad("too long"));
    }
    let m: IntakeMsg = serde_json::from_str(msg).map_err(|_| bad("not valid IntakeMsg JSON"))?;
    if m.v != 1 || m.op != "contribute" {
        return Err(bad("unknown version or op"));
    }
    let id = m.launch_id.parse::<u64>().map_err(|_| bad("launch_id is not a u64 string"))?;
    Ok((id, m))
}

/// 64 lowercase hex chars -> 32 bytes.
fn hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(out)
}

/// RECONCILED row 13: a hex signer is a Solana holder ONLY if `deliver == sol:<same key>`. Any other mix is R_DELIVER.
pub(crate) fn resolve_holder(sender: &AccountId, deliver: &Option<String>, custody: Custody) -> Result<HolderId, RuleViolation> {
    let bad = |t: &str| RuleViolation::new(RuleCode::RDeliver, "deliver", t, "near:<sender> or sol:<same key as signer>");
    match deliver.as_deref() {
        None => Ok(HolderId::Near(sender.clone())),
        Some(d) if d == format!("near:{}", sender) => Ok(HolderId::Near(sender.clone())),
        Some(d) if d.starts_with("sol:") && custody == Custody::Intents => match (HolderId::parse(d), hex32(sender.as_str())) {
            (Some(HolderId::Solana(a)), Some(b)) if a == b => Ok(HolderId::Solana(a)),
            _ => Err(bad("signer is not the delivered Solana key")),
        },
        Some(_) => Err(bad("unsupported deliver for this path")),
    }
}

#[near]
impl Contract {
    /// Native path: USDC.ft_transfer_call(core, amount, msg). Rejections return the whole amount; they never panic.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.cfg.usdc {
            // A different token contract. Nothing is credited; the amount goes back to that token's sender.
            emit(
                "deposit_rejected",
                json!({ "payer": sender_id, "amount": amount.0.to_string(), "code": RuleCode::RUnexpectedToken.as_str(), "token": env::predecessor_account_id() }),
            );
            return PromiseOrValue::Value(amount);
        }
        let accepted = parse_msg(&msg).and_then(|(id, m)| {
            let holder = resolve_holder(&sender_id, &m.deliver, Custody::Native)?;
            if m.relay_fee.is_some() {
                return Err(RuleViolation::new(RuleCode::RRelayFee, "relay_fee", "set", "absent on the native path"));
            }
            self.try_commit(id, holder, Custody::Native, amount.0, 0, m.referrer)
        });
        match accepted {
            Ok(()) => PromiseOrValue::Value(U128(0)),
            Err(v) => {
                emit(
                    "deposit_rejected",
                    json!({ "payer": sender_id, "amount": amount.0.to_string(), "code": v.code.as_str(), "detail": v.message() }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Intents path (S3 primary, S2 identical): intents.near moved the balance to us BEFORE this call.
    /// Returning the amounts refunds them to the signer's Intents balance automatically; so does a panic.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        if env::predecessor_account_id() != self.cfg.intents {
            fail(RuleCode::RNotAuthorized, "mt_on_transfer is callable by intents.near only");
        }
        let refund = || PromiseOrValue::Value(amounts.clone());
        if token_ids.len() != 1
            || amounts.len() != 1
            || token_ids[0] != self.cfg.usdc_token_id
            || previous_owner_ids.first() != Some(&sender_id)
        {
            return refund();
        }
        let gross = amounts[0].0;
        let accepted = parse_msg(&msg).and_then(|(id, m)| {
            let holder = resolve_holder(&sender_id, &m.deliver, Custody::Intents)?;
            let fee = m
                .relay_fee
                .as_deref()
                .map(str::parse::<u128>)
                .transpose()
                .map_err(|_| RuleViolation::new(RuleCode::RRelayFee, "relay_fee", "not a u128", "decimal string"))?
                .unwrap_or(0);
            self.try_commit(id, holder, Custody::Intents, gross, fee, m.referrer)
        });
        match accepted {
            Ok(()) => PromiseOrValue::Value(vec![U128(0)]),
            Err(v) => {
                emit(
                    "deposit_rejected",
                    json!({ "payer": sender_id, "amount": gross.to_string(), "code": v.code.as_str(), "detail": v.message() }),
                );
                refund()
            }
        }
    }

    /// Exit by the holder's own NEAR key. 1 yocto forces a wallet confirmation.
    #[payable]
    pub fn walk(&mut self, launch_id: U64) -> PromiseOrValue<bool> {
        assert_one_yocto();
        self.require_exit_open();
        let holder = HolderId::Near(env::predecessor_account_id());
        self.walk_inner(launch_id.0, holder)
    }

    /// Exit authorised by an ed25519 signature, for payers with no NEAR key (Phantom-only). Anyone may submit;
    /// the refund destination is fixed by the position. Preimage: kruxa:walk:v1|<contract>|<launch_id>|<holder key>|<nonce>|<deadline_ns>.
    pub fn walk_signed(&mut self, launch_id: U64, holder: String, nonce: U64, deadline: U64, signature: String) -> PromiseOrValue<bool> {
        self.require_exit_open();
        let Some(HolderId::Solana(pk)) = HolderId::parse(&holder) else { fail(RuleCode::RDeliver, "holder must be sol:<base58 key>") };
        if env::block_timestamp() > deadline.0 {
            fail(RuleCode::RDeadline, "signature expired");
        }
        if nonce.0 <= self.walk_nonces.get(&pk).copied().unwrap_or(0) {
            fail(RuleCode::RNonce, "nonce must increase");
        }
        let sig = bs58::decode(&signature)
            .into_vec()
            .ok()
            .and_then(|v| <[u8; 64]>::try_from(v.as_slice()).ok())
            .unwrap_or_else(|| fail(RuleCode::RSig, "signature must be base58 of 64 bytes"));
        let msg = format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env::current_account_id(), launch_id.0, holder, nonce.0, deadline.0);
        if !env::ed25519_verify(&sig, msg.as_bytes(), &pk) {
            fail(RuleCode::RSig, "signature does not verify");
        }
        self.walk_nonces.insert(pk, nonce.0);
        self.walk_inner(launch_id.0, HolderId::Solana(pk))
    }
}

impl Contract {
    /// Non-mutating admission check shared by every commit path (used again by S4 before forwarding).
    pub(crate) fn check_commit(&self, id: u64, holder: &HolderId, custody: Custody, gross: u128, fee: u128) -> Result<u128, RuleViolation> {
        let v = |c: RuleCode, f: &'static str, got: String, lim: String| RuleViolation::new(c, f, got, lim);
        if self.pause_level() != PauseLevel::None {
            return Err(v(RuleCode::RPaused, "pause", "on".into(), "none".into()));
        }
        let (Some(ch), Some(st)) = (self.charters.get(&id), self.states.get(&id)) else {
            return Err(v(RuleCode::RNoLaunch, "launch_id", id.to_string(), "exists".into()));
        };
        if st.status != Status::Open || phase_at(env::block_timestamp(), ch.opens_at, ch.commit_end, ch.walk_end) != Phase::Open {
            return Err(v(RuleCode::RWrongPhase, "phase", format!("{:?}", st.status), "Open window".into()));
        }
        if let HolderId::Near(a) = holder {
            if *a == ch.creator || *a == ch.stream_recipient {
                return Err(v(RuleCode::RSelfBuy, "holder", a.to_string(), "not creator or payee".into()));
            }
        }
        let max_fee = ch.rules.max_relay_fee_abs.min(bps_floor(gross, ch.rules.max_relay_fee_bps).unwrap_or(0));
        if fee > max_fee || (custody == Custody::Native && fee != 0) {
            return Err(v(RuleCode::RRelayFee, "relay_fee", fee.to_string(), format!("<= {}", max_fee)));
        }
        let net = gross.saturating_sub(fee);
        if net < ch.params.min_buy {
            return Err(v(RuleCode::RMinContribution, "net amount", net.to_string(), format!(">= {}", ch.params.min_buy)));
        }
        let existing = self.positions.get(&(id, holder.clone()));
        if existing.map_or(0, |p| p.open()) + net > ch.derived.wallet_cap {
            return Err(v(RuleCode::RCapAccount, "wallet total", net.to_string(), format!("<= {}", ch.derived.wallet_cap)));
        }
        if existing.is_none() && st.holder_count >= ch.derived.max_holders {
            return Err(v(RuleCode::RCapHolders, "holders", st.holder_count.to_string(), format!("< {}", ch.derived.max_holders)));
        }
        if st.total_active + net > ch.derived.max_total_held {
            return Err(v(
                RuleCode::RCapLaunch,
                "launch total",
                (st.total_active + net).to_string(),
                format!("<= {}", ch.derived.max_total_held),
            ));
        }
        if self.cfg.global_held + net > self.cfg.global_cap {
            return Err(v(
                RuleCode::RCapGlobal,
                "global held",
                (self.cfg.global_held + net).to_string(),
                format!("<= {}", self.cfg.global_cap),
            ));
        }
        Ok(net)
    }

    /// Single choke point that credits money. All checks first, then every mutation. No promises inside.
    pub(crate) fn try_commit(
        &mut self,
        id: u64,
        holder: HolderId,
        custody: Custody,
        gross: u128,
        fee: u128,
        referrer: Option<AccountId>,
    ) -> Result<(), RuleViolation> {
        let net = self.check_commit(id, &holder, custody, gross, fee)?;
        let mut st = self.state(id);
        let key = (id, holder.clone());
        let mut pos = match self.positions.get(&key).cloned() {
            Some(p) => p,
            None => {
                st.holder_count += 1;
                st.positions_live += 1;
                self.seq_index.insert((id, st.holder_count - 1), holder.clone());
                Position {
                    seq: st.holder_count - 1,
                    deliver: holder.clone(),
                    referrer,
                    contributed: 0,
                    open_native: 0,
                    open_intents: 0,
                    due_native: 0,
                    due_intents: 0,
                    inflight_native: 0,
                    inflight_intents: 0,
                    refunded: 0,
                    spent: 0,
                    tokens_entitled: 0,
                    bonus_entitled: 0,
                    claimed: 0,
                    settled: false,
                }
            }
        };
        if pos.open() == 0 {
            st.active_funders += 1;
        }
        pos.contributed += net;
        match custody {
            Custody::Native => {
                pos.open_native += net;
                st.ledger.open_native += net;
            }
            Custody::Intents => {
                pos.open_intents += net;
                st.ledger.open_intents += net;
            }
        }
        st.ledger.credited += net;
        st.ledger.relay_fee_total += fee;
        st.total_active += net;
        self.cfg.global_held += net;
        st.book_hash = book_next(&st.book_hash, 1, holder.key().as_bytes(), net, st.total_active, st.active_funders);
        emit(
            "contributed",
            json!({ "launch_id": id.to_string(), "holder": holder.key(), "net": net.to_string(), "relay_fee": fee.to_string(), "custody": format!("{:?}", custody), "total_active": st.total_active.to_string(), "funders": st.active_funders, "book_hash": hex(&st.book_hash) }),
        );
        self.positions.insert(key, pos);
        self.save_state(id, st);
        Ok(())
    }

    /// Step 1 is synchronous and atomic: the verdict inputs shrink and the money becomes `due`. Step 2 pays it out (retryable).
    pub(crate) fn walk_inner(&mut self, id: u64, holder: HolderId) -> PromiseOrValue<bool> {
        let (mut st, ch) = (self.state(id), self.charter(id));
        let now = env::block_timestamp();
        if st.status != Status::Open || now >= ch.walk_end || now < ch.opens_at {
            fail(RuleCode::RWalkClosed, "Walk is open from opens_at until walk_end");
        }
        let key = (id, holder.clone());
        let mut pos = self.positions.get(&key).cloned().unwrap_or_else(|| fail(RuleCode::RNoPosition, "no position for this holder"));
        let (on, oi) = (pos.open_native, pos.open_intents);
        if on + oi == 0 {
            fail(RuleCode::RNoPosition, "position has nothing active");
        }
        pos.open_native = 0;
        pos.open_intents = 0;
        pos.due_native += on;
        pos.due_intents += oi;
        let l = &mut st.ledger;
        l.open_native -= on;
        l.open_intents -= oi;
        l.due_native += on;
        l.due_intents += oi;
        st.total_active -= on + oi;
        st.active_funders -= 1;
        st.book_hash = book_next(&st.book_hash, 2, holder.key().as_bytes(), on + oi, st.total_active, st.active_funders);
        emit(
            "walked",
            json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": (on + oi).to_string(), "total_active": st.total_active.to_string(), "funders": st.active_funders, "book_hash": hex(&st.book_hash) }),
        );
        self.positions.insert(key, pos);
        self.save_state(id, st);
        match self.pay_due(id, &holder) {
            Some(p) => PromiseOrValue::Promise(p),
            None => PromiseOrValue::Value(true),
        }
    }
}
```

[VERIFIED] - compiled; create, callbacks, cancel, settle (PASS and FAIL), residue, dissolve, bond all exercised by sandbox tests
```rust
// File: contracts/core/src/lifecycle.rs
use crate::ContractExt;
use kruxa_logic::{
    allocate, bond_required, check_pass_conservation, inputs_hash, phase_at, settle_position, validate_params, verdict, Buckets, Outcome,
    Phase, RuleCode, TrialParams, VerdictInputs,
};
use kruxa_math::{mul_div_floor, secs_to_ns};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Promise, PromiseOrValue};

use crate::events::emit;
use crate::ext::ext_ft;
use crate::model::*;
use crate::token::{FactoryPrimitives, TokenProvider};
use crate::{fail, Contract, GAS_CB, GAS_OUT};

fn math<T>(r: Result<T, kruxa_math::MathError>) -> T {
    r.unwrap_or_else(|e| fail(RuleCode::RMath, &format!("{:?}", e)))
}

#[near]
impl Contract {
    /// Creator attaches `required_deposit` (position-storage bond + factory deposit). Everything above the factory deposit is the bond.
    #[payable]
    pub fn create_trial(&mut self, params: TrialParams, stream_recipient: Option<AccountId>) -> Promise {
        self.require_live();
        let creator = env::predecessor_account_id();
        if self.active_by_creator.contains_key(&creator) {
            fail(RuleCode::RActiveTrial, "one active trial per account");
        }
        if self.symbols.contains(&params.symbol) {
            fail(RuleCode::RSymbol, "symbol already used");
        }
        let headroom = self.cfg.global_cap.saturating_sub(self.cfg.global_held);
        let derived =
            validate_params(&params, &self.cfg.rules, headroom, creator == self.cfg.owner).unwrap_or_else(|v| env::panic_str(&v.message()));
        let attached = env::attached_deposit().as_yoctonear();
        let need = bond_required(derived.max_holders) + self.cfg.factory_deposit;
        if attached < need {
            fail(RuleCode::RDeposit, &format!("attach at least {} yocto, got {}", need, attached));
        }
        let id = self.next_launch_id;
        self.next_launch_id += 1;
        let now = env::block_timestamp();
        let opens_at = now + math(secs_to_ns(params.open_delay_secs).ok_or(kruxa_math::MathError::Overflow));
        let commit_end = opens_at + math(secs_to_ns(params.commit_secs).ok_or(kruxa_math::MathError::Overflow));
        let walk_end = commit_end + math(secs_to_ns(params.tail_secs).ok_or(kruxa_math::MathError::Overflow));
        let provider = FactoryPrimitives { factory: self.cfg.factory.clone() };
        let charter = Charter {
            launch_id: id,
            stream_recipient: stream_recipient.unwrap_or_else(|| creator.clone()),
            creator: creator.clone(),
            created_at: now,
            derived: derived.clone(),
            rules: self.cfg.rules.clone(),
            opens_at,
            commit_end,
            walk_end,
            route: provider.route(),
            params: params.clone(),
        };
        let charter_hash = env::sha256_array(near_sdk::borsh::to_vec(&charter).expect("charter serializes"));
        let state = LaunchState {
            charter_hash,
            status: Status::Creating,
            halted: false,
            cancelled: false,
            token: None,
            total_active: 0,
            active_funders: 0,
            holder_count: 0,
            positions_live: 0,
            positions_unsettled: 0,
            residue_swept: false,
            bond: attached - self.cfg.factory_deposit,
            bond_reclaimed: false,
            book_hash: [0; 32],
            ledger: Ledger::default(),
            settlement: None,
        };
        self.charters.insert(id, charter);
        self.states.insert(id, state);
        self.active_by_creator.insert(creator.clone(), id);
        self.symbols.insert(params.symbol.clone());
        emit(
            "charter_created",
            json!({ "launch_id": id.to_string(), "creator": creator, "symbol": params.symbol, "charter_hash": kruxa_logic::hex(&charter_hash) }),
        );
        provider
            .create(&params, derived.n_total, &env::current_account_id(), self.cfg.factory_deposit)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_token_created(U64(id)))
    }

    #[private]
    pub fn on_token_created(&mut self, launch_id: U64) -> PromiseOrValue<bool> {
        let id = launch_id.0;
        if self.state(id).status != Status::Creating {
            return PromiseOrValue::Value(false);
        }
        if env::promise_result_checked(0, 4096).is_err() {
            self.fail_creation(id, "factory call failed");
            return PromiseOrValue::Value(false);
        }
        PromiseOrValue::Promise(self.verify_token(id))
    }

    #[private]
    pub fn on_token_verified(&mut self, launch_id: U64) -> bool {
        let id = launch_id.0;
        let mut st = self.state(id);
        if st.status != Status::Creating {
            return false;
        }
        let ch = self.charter(id);
        let supply_ok = match env::promise_result_checked(0, 128) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).map(|u| u.0 == ch.derived.n_total).unwrap_or(false),
            Err(_) => false,
        };
        if !supply_ok {
            self.fail_creation(id, "token supply is not at core");
            return false;
        }
        st.token = Some(self.provider().token_account(&ch.params));
        st.status = Status::Open;
        self.save_state(id, st);
        emit(
            "trial_opened",
            json!({ "launch_id": id.to_string(), "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string() }),
        );
        true
    }

    /// Permissionless recovery if a creation callback never ran or failed: re-query the supply after 10 minutes.
    pub fn finalize_creation(&mut self, launch_id: U64) -> Promise {
        let (st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if st.status != Status::Creating {
            fail(RuleCode::RWrongPhase, "launch is not in Creating");
        }
        if env::block_timestamp() < ch.created_at + crate::CREATION_TIMEOUT_NS {
            fail(RuleCode::RTooEarly, "wait 10 minutes after create_trial");
        }
        self.verify_token(launch_id.0)
    }

    /// Creator-only, before commit_end. Every position becomes refundable at once; launch fee is zero.
    pub fn cancel_trial(&mut self, launch_id: U64) {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if env::predecessor_account_id() != ch.creator {
            fail(RuleCode::RNotAuthorized, "creator only");
        }
        if st.status != Status::Open {
            fail(RuleCode::RWrongPhase, "launch is not Open");
        }
        if env::block_timestamp() >= ch.commit_end {
            fail(RuleCode::RTooLate, "commit window is over");
        }
        st.cancelled = true;
        self.finish_fail(&ch, &mut st, kruxa_logic::verdict::CANCELLED);
        self.save_state(launch_id.0, st);
    }

    /// Permissionless. Pure function of frozen state: no promises, no yield/resume, cannot be blocked by an outage.
    pub fn settle(&mut self, launch_id: U64) -> bool {
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        match (&st.status, &st.settlement) {
            (Status::Open, _) => {}
            (_, Some(s)) => return s.pass,
            _ => fail(RuleCode::RWrongPhase, "launch is not Open"),
        }
        // A PAUSE must not hold the verdict hostage (it has no expiry); only a FROZEN state, which auto-expires, stops it.
        self.require_exit_open();
        let now = env::block_timestamp();
        if phase_at(now, ch.opens_at, ch.commit_end, ch.walk_end) != Phase::Ready {
            fail(RuleCode::RTooEarly, "walk tail is still running");
        }
        let inputs = VerdictInputs {
            launch_id: id,
            charter_hash: st.charter_hash,
            total_active: st.total_active,
            active_funders: st.active_funders,
            soft_cap: ch.params.soft_cap,
            min_funders: ch.params.min_funders,
            cancelled: st.cancelled,
        };
        match verdict(&inputs) {
            Outcome::Fail(reasons) => self.finish_fail(&ch, &mut st, reasons),
            Outcome::Pass => {
                let a = math(allocate(st.total_active, ch.params.hard_cap, ch.params.sale_bps, ch.params.lp_bps, &ch.rules));
                let l = &mut st.ledger;
                l.excess_pool = a.excess_pool;
                l.launch_fee_due = a.launch_fee;
                l.lp_seed_due = a.lp_quote;
                l.stream_total = a.stream;
                let buckets =
                    Buckets { launch_fee_due: a.launch_fee, lp_seed_due: a.lp_quote, stream_total: a.stream, excess_pool: a.excess_pool };
                if check_pass_conservation(&buckets, st.total_active, 0).is_err() {
                    fail(RuleCode::RSolvency, "bucket conservation broken at settle");
                }
                st.settlement = Some(Settlement {
                    pass: true,
                    reasons: 0,
                    settled_at: now,
                    total_active: st.total_active,
                    accepted: a.accepted,
                    launch_fee: a.launch_fee,
                    lp_quote: a.lp_quote,
                    stream: a.stream,
                    excess_pool: a.excess_pool,
                    inputs_hash: inputs_hash(&inputs),
                    book_hash: st.book_hash,
                });
                st.status = Status::Passed;
                st.positions_unsettled = st.active_funders;
                self.active_by_creator.remove(&ch.creator);
                emit(
                    "verdict",
                    json!({ "launch_id": id.to_string(), "outcome": "PASS", "inputs_hash": kruxa_logic::hex(&inputs_hash(&inputs)), "total_active": st.total_active.to_string(), "funders": st.active_funders }),
                );
                emit(
                    "pass_allocated",
                    json!({ "launch_id": id.to_string(), "accepted": a.accepted.to_string(), "launch_fee": a.launch_fee.to_string(), "lp_quote": a.lp_quote.to_string(), "stream": a.stream.to_string(), "excess_pool": a.excess_pool.to_string() }),
                );
            }
        }
        let pass = st.status == Status::Passed;
        self.save_state(id, st);
        pass
    }

    /// Lazily settles up to 25 positions in sequence order. Required before consolidation and payouts.
    pub fn settle_positions_page(&mut self, launch_id: U64, from_seq: u32, limit: u32) -> u32 {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if !matches!(st.status, Status::Passed | Status::Failed(_)) {
            fail(RuleCode::RWrongPhase, "launch has no verdict yet");
        }
        let end = from_seq.saturating_add(limit.min(25));
        for seq in from_seq..end {
            if let Some(holder) = self.seq_index.get(&(launch_id.0, seq)).cloned() {
                self.settle_position_inner(&ch, &mut st, &holder);
            }
        }
        self.save_state(launch_id.0, st);
        end
    }

    /// Moves oversubscription rounding residue to the LP bucket once every position is settled. Never to creator or platform.
    pub fn sweep_residue(&mut self, launch_id: U64) {
        let mut st = self.state(launch_id.0);
        if st.status != Status::Passed || st.positions_unsettled != 0 || st.residue_swept {
            fail(RuleCode::RNotClear, "needs Passed, all positions settled, not yet swept");
        }
        let residue = st.ledger.excess_pool;
        st.ledger.lp_seed_due += residue;
        st.ledger.excess_pool = 0;
        st.residue_swept = true;
        emit("residue_swept", json!({ "launch_id": launch_id.0.to_string(), "amount": residue.to_string() }));
        self.save_state(launch_id.0, st);
    }

    /// FAIL path terminal state, once every refund is cleared and every position deleted.
    pub fn dissolve(&mut self, launch_id: U64) {
        let mut st = self.state(launch_id.0);
        let l = &st.ledger;
        let clear = l.due_native + l.due_intents + l.inflight_native + l.inflight_intents + l.open_native + l.open_intents == 0;
        if !matches!(st.status, Status::Failed(_)) || !clear || st.positions_unsettled != 0 || st.positions_live != 0 {
            fail(RuleCode::RNotClear, "refunds are not all cleared");
        }
        st.status = Status::Dissolved;
        emit("dissolved", json!({ "launch_id": launch_id.0.to_string() }));
        self.save_state(launch_id.0, st);
    }

    /// Returns the creator's position-storage bond once no position records remain.
    pub fn reclaim_bond(&mut self, launch_id: U64) -> Promise {
        let (mut st, ch) = (self.state(launch_id.0), self.charter(launch_id.0));
        if env::predecessor_account_id() != ch.creator {
            fail(RuleCode::RNotAuthorized, "creator only");
        }
        let done = matches!(st.status, Status::Dissolved | Status::CreationFailed | Status::Passed);
        if !done || st.bond_reclaimed || st.positions_live != 0 || (st.status == Status::Passed && !st.residue_swept) {
            fail(RuleCode::RNotClear, "bond is not reclaimable yet");
        }
        st.bond_reclaimed = true;
        let amount = if st.status == Status::CreationFailed { st.bond + self.cfg.factory_deposit } else { st.bond };
        self.save_state(launch_id.0, st);
        emit("bond_reclaimed", json!({ "launch_id": launch_id.0.to_string(), "amount": amount.to_string() }));
        Promise::new(ch.creator).transfer(near_sdk::NearToken::from_yoctonear(amount))
    }
}

impl Contract {
    pub(crate) fn provider(&self) -> FactoryPrimitives {
        FactoryPrimitives { factory: self.cfg.factory.clone() }
    }

    fn verify_token(&self, id: u64) -> Promise {
        let token = self.provider().token_account(&self.charter(id).params);
        ext_ft::ext(token)
            .with_static_gas(GAS_OUT)
            .ft_balance_of(env::current_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_token_verified(U64(id)))
    }

    fn fail_creation(&mut self, id: u64, reason: &str) {
        let (mut st, ch) = (self.state(id), self.charter(id));
        st.status = Status::CreationFailed;
        self.active_by_creator.remove(&ch.creator);
        self.symbols.remove(&ch.params.symbol);
        self.save_state(id, st);
        emit("token_creation_failed", json!({ "launch_id": id.to_string(), "code": RuleCode::RTokenCreate.as_str(), "reason": reason }));
    }

    fn finish_fail(&mut self, ch: &Charter, st: &mut LaunchState, reasons: u8) {
        st.status = Status::Failed(reasons);
        st.positions_unsettled = st.active_funders;
        st.settlement = Some(Settlement {
            pass: false,
            reasons,
            settled_at: env::block_timestamp(),
            total_active: st.total_active,
            accepted: 0,
            launch_fee: 0,
            lp_quote: 0,
            stream: 0,
            excess_pool: 0,
            inputs_hash: [0; 32],
            book_hash: st.book_hash,
        });
        self.active_by_creator.remove(&ch.creator);
        emit(
            "verdict",
            json!({ "launch_id": ch.launch_id.to_string(), "outcome": "FAIL", "reasons": reasons, "total_active": st.total_active.to_string(), "funders": st.active_funders }),
        );
    }

    /// Idempotent, O(1). Turns an Active position into its final spend/refund/entitlement (PASS) or into a full refund (FAIL).
    pub(crate) fn settle_position_inner(&mut self, ch: &Charter, st: &mut LaunchState, holder: &HolderId) {
        let key = (ch.launch_id, holder.clone());
        let Some(mut pos) = self.positions.get(&key).cloned() else { return };
        if pos.settled {
            return;
        }
        let (on, oi) = (pos.open_native, pos.open_intents);
        let c = on + oi;
        let l = &mut st.ledger;
        match st.status {
            Status::Failed(_) => {
                l.open_native -= on;
                l.open_intents -= oi;
                l.due_native += on;
                l.due_intents += oi;
                pos.due_native += on;
                pos.due_intents += oi;
            }
            Status::Passed if c > 0 => {
                let s = st.settlement.clone().expect("Passed always has a settlement");
                let r = math(settle_position(c, s.total_active, s.accepted, ch.derived.n_sale, ch.derived.n_backer));
                let refund_native = math(mul_div_floor(r.refund, on, c));
                let refund_intents = r.refund - refund_native;
                l.open_native -= on;
                l.open_intents -= oi;
                l.due_native += refund_native;
                l.due_intents += refund_intents;
                l.spent_native += on - refund_native;
                l.spent_intents += oi - refund_intents;
                l.excess_pool -= r.refund;
                pos.due_native += refund_native;
                pos.due_intents += refund_intents;
                pos.spent = r.spend;
                pos.tokens_entitled = r.tokens;
                pos.bonus_entitled = r.bonus;
            }
            Status::Passed => {}
            _ => return,
        }
        pos.open_native = 0;
        pos.open_intents = 0;
        pos.settled = true;
        if c > 0 {
            st.positions_unsettled -= 1;
        }
        self.positions.insert(key, pos);
    }

    /// Removes a position record once nothing is owed either way. Frees storage so the creator bond becomes reclaimable.
    pub(crate) fn try_delete_position(&mut self, st: &mut LaunchState, launch_id: u64, holder: &HolderId) {
        let key = (launch_id, holder.clone());
        let Some(pos) = self.positions.get(&key) else { return };
        let tokens_done = match st.status {
            Status::Passed => pos.claimed == pos.tokens_entitled + pos.bonus_entitled && matches!(holder, HolderId::Near(_)),
            _ => true,
        };
        if !pos.settled || pos.owed() + pos.inflight() + pos.open() != 0 || !tokens_done {
            return;
        }
        let seq = pos.seq;
        self.positions.remove(&key);
        self.seq_index.remove(&(launch_id, seq));
        st.positions_live -= 1;
    }
}
```

[UNVERIFIED] - compiled; refunds, claims, fee, stream cap, consolidate, relay-fee payout exercised against mocks; `ft_withdraw` to native is mock-only (OV15 is the unproven live piece)
```rust
// File: contracts/core/src/payout.rs
use crate::ContractExt;
use kruxa_logic::RuleCode;
use kruxa_math::{dec, linear_unlocked};
use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, Promise, PromiseOrValue};

use crate::events::emit;
use crate::ext::{ext_ft, ext_intents};
use crate::model::*;
use crate::{fail, Contract, GAS_CB, GAS_OUT, ONE_YOCTO};
use near_sdk::serde_json::json;

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutKind {
    RefundNative,
    RefundIntents,
    LaunchFee,
    Stream,
    RelayFee,
    Consolidate,
    Claim,
}

/// Everything a callback needs to undo or confirm one outbound leg. Debit happened before the call.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PayoutOp {
    pub kind: PayoutKind,
    #[serde(with = "dec::u64")]
    pub launch_id: u64,
    pub holder: Option<String>,
    #[serde(with = "dec::u128")]
    pub amount: u128,
}

#[near]
impl Contract {
    /// Pull-based refund. Permissionless: the destination is fixed by the position, so a keeper can push everyone's refund.
    pub fn claim_refund(&mut self, launch_id: U64Arg, holder: Option<String>) -> PromiseOrValue<bool> {
        self.require_exit_open();
        let id = launch_id.0;
        let holder = match holder {
            Some(s) => HolderId::parse(&s).unwrap_or_else(|| fail(RuleCode::RNoPosition, "holder must be near:<account> or sol:<base58>")),
            None => HolderId::Near(env::predecessor_account_id()),
        };
        let (mut st, ch) = (self.state(id), self.charter(id));
        if matches!(st.status, Status::Passed | Status::Failed(_)) {
            self.settle_position_inner(&ch, &mut st, &holder);
            self.save_state(id, st);
        }
        match self.pay_due(id, &holder) {
            Some(p) => PromiseOrValue::Promise(p),
            None => PromiseOrValue::Value(false),
        }
    }

    /// Delivers sale tokens plus the vested part of the backer bonus to a NEAR holder. The holder must already be
    /// registered on the launch token (NEP-145). A failed transfer restores `claimed` in the callback.
    #[payable]
    pub fn claim_tokens(&mut self, launch_id: U64Arg) -> Promise {
        assert_one_yocto();
        self.require_exit_open();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        let holder = HolderId::Near(env::predecessor_account_id());
        if st.status != Status::Passed {
            fail(RuleCode::RWrongPhase, "tokens exist only after PASS");
        }
        self.settle_position_inner(&ch, &mut st, &holder);
        let Some(mut pos) = self.positions.get(&(id, holder.clone())).cloned() else { fail(RuleCode::RNoPosition, "no position") };
        let s = st.settlement.clone().expect("Passed has a settlement");
        let vest_ns = kruxa_math::days_to_ns(ch.rules.backer_vest_days as u64).unwrap_or(0);
        let bonus = linear_unlocked(pos.bonus_entitled, s.settled_at, vest_ns, env::block_timestamp()).unwrap_or(0);
        let amount = (pos.tokens_entitled + bonus).saturating_sub(pos.claimed);
        if amount == 0 {
            fail(RuleCode::RNothing, "nothing claimable yet");
        }
        pos.claimed += amount;
        self.positions.insert((id, holder.clone()), pos);
        self.save_state(id, st.clone());
        let token = st.token.clone().expect("Passed launches have a token");
        let op = PayoutOp { kind: PayoutKind::Claim, launch_id: id, holder: Some(holder.key()), amount };
        emit("tokens_claimed", json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": amount.to_string() }));
        ext_ft::ext(token)
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(env::predecessor_account_id(), U128(amount), None)
            .then(self.callback(op))
    }

    /// Moves settled Intents-held proceeds to native USDC so the fee, stream and LP buckets can be paid. Debit first.
    pub fn consolidate(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        self.require_buckets_ready(&st);
        let amount = st.ledger.spent_intents - st.ledger.consolidated - st.ledger.consolidating;
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no settled Intents proceeds to move");
        }
        st.ledger.consolidating += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::Consolidate, launch_id: id, holder: None, amount };
        ext_intents::ext(self.cfg.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(near_sdk::Gas::from_tgas(100))
            .ft_withdraw(self.cfg.usdc.clone(), env::current_account_id(), U128(amount), None, None)
            .then(self.callback(op))
    }

    /// Launch fee to the treasury. Permissionless; limited by funds actually held natively.
    pub fn pay_launch_fee(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        self.require_buckets_ready(&st);
        let l = &st.ledger;
        let amount = (l.launch_fee_due - l.launch_fee_paid - l.launch_fee_inflight).min(Self::native_free(l));
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no launch fee payable yet (consolidate first)");
        }
        st.ledger.launch_fee_inflight += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::LaunchFee, launch_id: id, holder: None, amount };
        ext_ft::ext(self.cfg.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(self.cfg.treasury.clone(), U128(amount), None)
            .then(self.callback(op))
    }

    /// Stream-lite: the creator's proceeds unlock linearly from PASS. Drawing more than elapsed x rate panics with STREAM_CAP.
    pub fn draw(&mut self, launch_id: U64Arg, amount: Option<U128>) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let (mut st, ch) = (self.state(id), self.charter(id));
        self.require_buckets_ready(&st);
        if env::predecessor_account_id() != ch.stream_recipient {
            fail(RuleCode::RNotAuthorized, "stream recipient only");
        }
        let s = st.settlement.clone().expect("Passed has a settlement");
        let dur = kruxa_math::days_to_ns(ch.params.stream_days as u64).unwrap_or(0);
        let cap = linear_unlocked(st.ledger.stream_total, s.settled_at, dur, env::block_timestamp()).unwrap_or(0);
        let drawable = cap.saturating_sub(st.ledger.stream_drawn + st.ledger.stream_inflight);
        let want = amount.map(|a| a.0).unwrap_or(drawable);
        if want > drawable {
            env::panic_str(&format!("STREAM_CAP: requested {} > drawable {}", want, drawable));
        }
        if want == 0 || want > Self::native_free(&st.ledger) {
            fail(RuleCode::RNothingFree, "nothing drawable or funds not consolidated");
        }
        st.ledger.stream_inflight += want;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::Stream, launch_id: id, holder: None, amount: want };
        ext_ft::ext(self.cfg.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .ft_transfer(ch.stream_recipient, U128(want), None)
            .then(self.callback(op))
    }

    /// Relay fees (R2) are not principal: they go to relay-fees.kruxa.near out of core's Intents balance.
    pub fn pay_relay_fees(&mut self, launch_id: U64Arg) -> Promise {
        self.require_live();
        let id = launch_id.0;
        let mut st = self.state(id);
        let amount = st.ledger.relay_fee_total - st.ledger.relay_fee_paid - st.ledger.relay_fee_inflight;
        if amount == 0 {
            fail(RuleCode::RNothingFree, "no relay fees accrued");
        }
        st.ledger.relay_fee_inflight += amount;
        self.save_state(id, st);
        let op = PayoutOp { kind: PayoutKind::RelayFee, launch_id: id, holder: None, amount };
        ext_intents::ext(self.cfg.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_OUT)
            .mt_transfer(self.cfg.relay_fees.clone(), self.cfg.usdc_token_id.clone(), U128(amount), None, None)
            .then(self.callback(op))
    }

    /// Callback for every outbound leg. Tiny, never panics on user data, idempotent through the debit/credit counters.
    #[private]
    pub fn on_payout(&mut self, op: PayoutOp) {
        let ok = env::promise_result_checked(0, 1 << 16).is_ok();
        let Some(mut st) = self.states.get(&op.launch_id).cloned() else { return };
        let a = op.amount;
        let holder = op.holder.as_deref().and_then(HolderId::parse);
        let mut pos = holder.as_ref().and_then(|h| self.positions.get(&(op.launch_id, h.clone())).cloned());
        let l = &mut st.ledger;
        match (op.kind, ok) {
            (PayoutKind::RefundNative, true) => {
                l.inflight_native = l.inflight_native.saturating_sub(a);
                l.refunded += a;
                self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                pos.iter_mut().for_each(|p| {
                    p.inflight_native = p.inflight_native.saturating_sub(a);
                    p.refunded += a;
                });
            }
            (PayoutKind::RefundIntents, true) => {
                l.inflight_intents = l.inflight_intents.saturating_sub(a);
                l.refunded += a;
                self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                pos.iter_mut().for_each(|p| {
                    p.inflight_intents = p.inflight_intents.saturating_sub(a);
                    p.refunded += a;
                });
            }
            (PayoutKind::RefundNative, false) => {
                l.inflight_native = l.inflight_native.saturating_sub(a);
                l.due_native += a;
                pos.iter_mut().for_each(|p| {
                    p.inflight_native = p.inflight_native.saturating_sub(a);
                    p.due_native += a;
                });
            }
            (PayoutKind::RefundIntents, false) => {
                l.inflight_intents = l.inflight_intents.saturating_sub(a);
                l.due_intents += a;
                pos.iter_mut().for_each(|p| {
                    p.inflight_intents = p.inflight_intents.saturating_sub(a);
                    p.due_intents += a;
                });
            }
            (PayoutKind::LaunchFee, ok) => {
                l.launch_fee_inflight = l.launch_fee_inflight.saturating_sub(a);
                if ok {
                    l.launch_fee_paid += a;
                    self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                }
            }
            (PayoutKind::Stream, ok) => {
                l.stream_inflight = l.stream_inflight.saturating_sub(a);
                if ok {
                    l.stream_drawn += a;
                    self.cfg.global_held = self.cfg.global_held.saturating_sub(a);
                }
            }
            (PayoutKind::RelayFee, ok) => {
                l.relay_fee_inflight = l.relay_fee_inflight.saturating_sub(a);
                if ok {
                    l.relay_fee_paid += a;
                }
            }
            (PayoutKind::Consolidate, ok) => {
                l.consolidating = l.consolidating.saturating_sub(a);
                if ok {
                    l.consolidated += a;
                }
            }
            (PayoutKind::Claim, false) => pos.iter_mut().for_each(|p| p.claimed = p.claimed.saturating_sub(a)),
            (PayoutKind::Claim, true) => {}
        }
        if let (Some(h), Some(p)) = (holder.as_ref(), pos) {
            self.positions.insert((op.launch_id, h.clone()), p);
            self.try_delete_position(&mut st, op.launch_id, h);
        }
        emit(
            "payout_resolved",
            json!({ "launch_id": op.launch_id.to_string(), "kind": format!("{:?}", op.kind), "amount": a.to_string(), "ok": ok }),
        );
        self.save_state(op.launch_id, st);
    }
}

pub type U64Arg = near_sdk::json_types::U64;

impl Contract {
    fn callback(&self, op: PayoutOp) -> Promise {
        Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_payout(op)
    }

    fn require_buckets_ready(&self, st: &LaunchState) {
        if st.status != Status::Passed || st.positions_unsettled != 0 || !st.residue_swept {
            fail(RuleCode::RNotClear, "needs Passed, every position settled and sweep_residue done");
        }
    }

    /// Native USDC that belongs to the fee and stream buckets (the LP bucket stays untouched).
    fn native_free(l: &Ledger) -> u128 {
        let held = l.spent_native + l.consolidated;
        let reserved = l.lp_seed_due + l.launch_fee_paid + l.launch_fee_inflight + l.stream_drawn + l.stream_inflight;
        held.saturating_sub(reserved)
    }

    /// Debit first (due -> in_flight), then one outbound leg per custody. Each leg has its own callback.
    pub(crate) fn pay_due(&mut self, id: u64, holder: &HolderId) -> Option<Promise> {
        let key = (id, holder.clone());
        let mut pos = self.positions.get(&key).cloned()?;
        let (dn, di) = (pos.due_native, pos.due_intents);
        if dn + di == 0 {
            return None;
        }
        let mut st = self.state(id);
        pos.due_native = 0;
        pos.due_intents = 0;
        pos.inflight_native += dn;
        pos.inflight_intents += di;
        let l = &mut st.ledger;
        l.due_native -= dn;
        l.due_intents -= di;
        l.inflight_native += dn;
        l.inflight_intents += di;
        self.positions.insert(key, pos);
        self.save_state(id, st);
        let mut legs: Vec<Promise> = Vec::new();
        if let (true, HolderId::Near(account)) = (dn > 0, holder) {
            let op = PayoutOp { kind: PayoutKind::RefundNative, launch_id: id, holder: Some(holder.key()), amount: dn };
            legs.push(
                ext_ft::ext(self.cfg.usdc.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_OUT)
                    .ft_transfer(account.clone(), U128(dn), None)
                    .then(self.callback(op)),
            );
        }
        if di > 0 {
            let op = PayoutOp { kind: PayoutKind::RefundIntents, launch_id: id, holder: Some(holder.key()), amount: di };
            legs.push(
                ext_intents::ext(self.cfg.intents.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_OUT)
                    .mt_transfer(holder.intents_account(), self.cfg.usdc_token_id.clone(), U128(di), None, None)
                    .then(self.callback(op)),
            );
        }
        legs.into_iter().reduce(|a, b| a.and(b))
    }
}
```

[VERIFIED] - compiled; views used by every sandbox test and by kruxa-sim
```rust
// File: contracts/core/src/views.rs
use crate::ContractExt;
use kruxa_logic::{
    bond_required, check_flow, check_pass_conservation, hex, inputs_hash, phase_at, validate_params, Buckets, LedgerTotals, TrialParams,
    VerdictInputs,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, to_value, Value};
use near_sdk::{env, near};

use crate::model::*;
use crate::Contract;

fn pos_json(key: &str, p: &Position) -> Value {
    json!({
        "holder": key, "seq": p.seq, "deliver": p.deliver.key(),
        "contributed": p.contributed.to_string(), "open_native": p.open_native.to_string(), "open_intents": p.open_intents.to_string(),
        "due_native": p.due_native.to_string(), "due_intents": p.due_intents.to_string(),
        "inflight": p.inflight().to_string(), "refunded": p.refunded.to_string(), "spent": p.spent.to_string(),
        "tokens_entitled": p.tokens_entitled.to_string(), "bonus_entitled": p.bonus_entitled.to_string(), "claimed": p.claimed.to_string(),
        "settled": p.settled, "conserved": p.conserved(),
    })
}

#[near]
impl Contract {
    pub fn get_config(&self) -> Value {
        let c = &self.cfg;
        json!({ "owner": c.owner, "guardian": c.guardian, "treasury": c.treasury, "relay_fees": c.relay_fees, "usdc": c.usdc, "intents": c.intents, "factory": c.factory,
                "profile": c.profile, "global_cap": c.global_cap.to_string(), "global_held": c.global_held.to_string(), "pause": format!("{:?}", self.pause_level()),
                "pending_global_cap": c.pending_global_cap.map(|(v, t)| json!({ "value": v.to_string(), "effective_at": t.to_string() })),
                "rules": to_value(&c.rules).expect("rules serialize") })
    }

    pub fn get_charter(&self, launch_id: U64) -> Option<Value> {
        let ch = self.charters.get(&launch_id.0)?;
        Some(
            json!({ "launch_id": ch.launch_id.to_string(), "creator": ch.creator, "stream_recipient": ch.stream_recipient, "created_at": ch.created_at.to_string(),
                     "opens_at": ch.opens_at.to_string(), "commit_end": ch.commit_end.to_string(), "walk_end": ch.walk_end.to_string(),
                     "params": to_value(&ch.params).expect("params serialize"), "derived": to_value(&ch.derived).expect("derived serialize"),
                     "route": format!("{:?}", ch.route) }),
        )
    }

    pub fn get_state(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let phase = phase_at(env::block_timestamp(), ch.opens_at, ch.commit_end, ch.walk_end);
        Some(
            json!({ "status": format!("{:?}", st.status), "phase": format!("{:?}", phase), "token": st.token, "total_active": st.total_active.to_string(),
                     "active_funders": st.active_funders, "holder_count": st.holder_count, "positions_live": st.positions_live, "positions_unsettled": st.positions_unsettled,
                     "residue_swept": st.residue_swept, "charter_hash": hex(&st.charter_hash), "book_hash": hex(&st.book_hash), "bond": st.bond.to_string() }),
        )
    }

    pub fn get_ledger(&self, launch_id: U64) -> Option<Value> {
        let l = &self.states.get(&launch_id.0)?.ledger;
        Some(
            json!({ "credited": l.credited.to_string(), "open_native": l.open_native.to_string(), "open_intents": l.open_intents.to_string(),
                     "due_native": l.due_native.to_string(), "due_intents": l.due_intents.to_string(), "inflight_native": l.inflight_native.to_string(),
                     "inflight_intents": l.inflight_intents.to_string(), "refunded": l.refunded.to_string(), "spent_native": l.spent_native.to_string(),
                     "spent_intents": l.spent_intents.to_string(), "consolidated": l.consolidated.to_string(), "excess_pool": l.excess_pool.to_string(),
                     "launch_fee_due": l.launch_fee_due.to_string(), "launch_fee_paid": l.launch_fee_paid.to_string(), "lp_seed_due": l.lp_seed_due.to_string(),
                     "stream_total": l.stream_total.to_string(), "stream_drawn": l.stream_drawn.to_string(), "relay_fee_total": l.relay_fee_total.to_string() }),
        )
    }

    pub fn get_position(&self, launch_id: U64, holder: String) -> Option<Value> {
        let h = HolderId::parse(&holder)?;
        self.positions.get(&(launch_id.0, h)).map(|p| pos_json(&holder, p))
    }

    pub fn list_positions(&self, launch_id: U64, from_seq: u32, limit: u32) -> Vec<Value> {
        (from_seq..from_seq.saturating_add(limit.min(50)))
            .filter_map(|s| self.seq_index.get(&(launch_id.0, s)))
            .filter_map(|h| self.positions.get(&(launch_id.0, h.clone())).map(|p| pos_json(&h.key(), p)))
            .collect()
    }

    /// The exact numbers a judge feeds to the pure verdict function. Frozen once the launch is settled.
    pub fn get_verdict_inputs(&self, launch_id: U64) -> Option<Value> {
        let (ch, st) = (self.charters.get(&launch_id.0)?, self.states.get(&launch_id.0)?);
        let i = VerdictInputs {
            launch_id: launch_id.0,
            charter_hash: st.charter_hash,
            total_active: st.total_active,
            active_funders: st.active_funders,
            soft_cap: ch.params.soft_cap,
            min_funders: ch.params.min_funders,
            cancelled: st.cancelled,
        };
        Some(json!({ "inputs": to_value(i).expect("inputs serialize"), "inputs_hash": hex(&inputs_hash(&i)) }))
    }

    pub fn get_settlement(&self, launch_id: U64) -> Option<Value> {
        let s = self.states.get(&launch_id.0)?.settlement.as_ref()?;
        Some(
            json!({ "pass": s.pass, "reasons": s.reasons, "settled_at": s.settled_at.to_string(), "total_active": s.total_active.to_string(), "accepted": s.accepted.to_string(),
                     "launch_fee": s.launch_fee.to_string(), "lp_quote": s.lp_quote.to_string(), "stream": s.stream.to_string(), "excess_pool": s.excess_pool.to_string(),
                     "inputs_hash": hex(&s.inputs_hash), "book_hash": hex(&s.book_hash) }),
        )
    }

    pub fn preview_contribution(&self, launch_id: U64, holder: String, amount: U128, relay_fee: Option<U128>) -> Value {
        let Some(h) = HolderId::parse(&holder) else {
            return json!({ "ok": false, "code": "R_DELIVER", "detail": "holder must be near:<account> or sol:<base58>" });
        };
        let custody = if matches!(h, HolderId::Solana(_)) { Custody::Intents } else { Custody::Native };
        match self.check_commit(launch_id.0, &h, custody, amount.0, relay_fee.map_or(0, |f| f.0)) {
            Ok(net) => json!({ "ok": true, "net": net.to_string() }),
            Err(v) => json!({ "ok": false, "code": v.code.as_str(), "detail": v.message() }),
        }
    }

    /// Exactly what create_trial will demand: position-storage bond for the validated max_holders plus the factory deposit.
    pub fn required_deposit(&self, params: TrialParams) -> U128 {
        let d = validate_params(&params, &self.cfg.rules, self.cfg.global_cap, true).unwrap_or_else(|v| env::panic_str(&v.message()));
        U128(bond_required(d.max_holders) + self.cfg.factory_deposit)
    }

    /// Ledger identities L1 and L4, evaluated on the stored counters.
    pub fn get_invariants(&self, launch_id: U64) -> Option<Value> {
        let st = self.states.get(&launch_id.0)?;
        let l = &st.ledger;
        let totals = LedgerTotals {
            credited: l.credited,
            open: l.open_native + l.open_intents,
            due: l.due_native + l.due_intents,
            in_flight: l.inflight_native + l.inflight_intents,
            refunded: l.refunded,
            spent: l.spent_native + l.spent_intents,
        };
        let l1 = check_flow(&totals);
        let l4 = if st.status == Status::Passed {
            check_pass_conservation(
                &Buckets {
                    launch_fee_due: l.launch_fee_due,
                    lp_seed_due: l.lp_seed_due,
                    stream_total: l.stream_total,
                    excess_pool: l.excess_pool,
                },
                totals.open,
                totals.spent,
            )
            .err()
        } else {
            None
        };
        Some(json!({ "l1_ok": l1.is_ok(), "l1_err": l1.err(), "l4_ok": l4.is_none(), "l4_err": l4 }))
    }
}
```

[VERIFIED] - compiled; pause, freeze, role checks and the timelock exercised; FROZEN 7-day auto-expiry is not exercised (the sandbox cannot move 7 days cheaply)
```rust
// File: contracts/core/src/admin.rs
use crate::ContractExt;
use kruxa_logic::RuleCode;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::events::emit;
use crate::model::PauseLevel;
use crate::{fail, Contract, CAP_TIMELOCK_NS, FREEZE_MAX_NS};

impl Contract {
    fn require_owner(&self) {
        if env::predecessor_account_id() != self.cfg.owner {
            fail(RuleCode::RNotAuthorized, "owner only");
        }
    }

    fn require_owner_or_guardian(&self) {
        let p = env::predecessor_account_id();
        if p != self.cfg.owner && p != self.cfg.guardian {
            fail(RuleCode::RNotAuthorized, "owner or guardian only");
        }
    }
}

#[near]
impl Contract {
    /// Stops NEW risk (create, commit, settle). Exits stay open.
    pub fn pause(&mut self) {
        self.require_owner_or_guardian();
        if self.pause_level() == PauseLevel::None {
            self.cfg.pause = PauseLevel::Paused;
        }
        emit("paused", json!({ "by": env::predecessor_account_id() }));
    }

    /// Stops everything including exits, auto-expires to Paused after 7 days.
    pub fn freeze(&mut self) {
        self.require_owner_or_guardian();
        self.cfg.pause = PauseLevel::Frozen;
        self.cfg.frozen_until = env::block_timestamp() + FREEZE_MAX_NS;
        emit("frozen", json!({ "by": env::predecessor_account_id(), "until": self.cfg.frozen_until.to_string() }));
    }

    pub fn unpause(&mut self) {
        self.require_owner();
        self.cfg.pause = PauseLevel::None;
        emit("unpaused", json!({}));
    }

    /// Lowering a cap is instant for owner or guardian.
    pub fn lower_global_cap(&mut self, value: U128) {
        self.require_owner_or_guardian();
        if value.0 >= self.cfg.global_cap {
            fail(RuleCode::RCapGlobal, "can only lower");
        }
        self.cfg.global_cap = value.0;
        emit("global_cap_lowered", json!({ "value": value.0.to_string() }));
    }

    /// Raising a cap is timelocked 7 days and public.
    pub fn queue_global_cap(&mut self, value: U128) {
        self.require_owner();
        let at = env::block_timestamp() + CAP_TIMELOCK_NS;
        self.cfg.pending_global_cap = Some((value.0, at));
        emit("global_cap_queued", json!({ "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    pub fn apply_global_cap(&mut self) {
        match self.cfg.pending_global_cap {
            Some((v, at)) if env::block_timestamp() >= at => {
                self.cfg.global_cap = v;
                self.cfg.pending_global_cap = None;
                emit("global_cap_applied", json!({ "value": v.to_string() }));
            }
            Some(_) => fail(RuleCode::RNotYet, "timelock has not elapsed"),
            None => fail(RuleCode::RNothing, "nothing queued"),
        }
    }

    /// Per-launch hard cap for NEW launches only (existing Charters are snapshots).
    pub fn queue_launch_cap(&mut self, value: U128) {
        self.require_owner();
        let at = env::block_timestamp() + CAP_TIMELOCK_NS;
        self.cfg.pending_launch_cap = Some((value.0, at));
        emit("launch_cap_queued", json!({ "value": value.0.to_string(), "effective_at": at.to_string() }));
    }

    pub fn apply_launch_cap(&mut self) {
        match self.cfg.pending_launch_cap {
            Some((v, at)) if env::block_timestamp() >= at => {
                self.cfg.rules.max_hard_cap = v;
                self.cfg.pending_launch_cap = None;
                emit("launch_cap_applied", json!({ "value": v.to_string() }));
            }
            Some(_) => fail(RuleCode::RNotYet, "timelock has not elapsed"),
            None => fail(RuleCode::RNothing, "nothing queued"),
        }
    }
}
```

[UNVERIFIED] - compiles; strict-payload refusals and the happy path pass against the mock Verifier; W0 shows `execute_intents` parses this payload shape on mainnet (simulate_intents)
```rust
// File: contracts/core/src/s4.rs
//! S4 fallback (cargo feature `s4-fallback`): anyone submits a buyer-signed raw_ed25519 transfer intent.
//! The contract parses the payload with a strict typed struct, checks it against the commit rules, then forwards
//! the SAME signed bytes to intents.near.execute_intents. The Verifier authenticates signer and key; we only attribute.
use crate::ContractExt;
use kruxa_logic::{hex, RuleCode};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{bs58, env, near, AccountId, Gas, Promise};
use std::collections::BTreeMap;

use crate::events::emit;
use crate::ext::ext_intents;
use crate::model::*;
use crate::{fail, Contract, GAS_CB};

#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
struct S4Payload {
    signer_id: AccountId,
    verifying_contract: AccountId,
    deadline: String,
    nonce: String,
    intents: Vec<S4Intent>,
}

#[near(serializers = [json])]
#[serde(tag = "intent", rename_all = "snake_case", deny_unknown_fields)]
enum S4Intent {
    Transfer { receiver_id: AccountId, tokens: BTreeMap<String, String>, memo: Option<String> },
}

/// memo = "kruxa:v1:t=<launch id>;d=sol:<base58>;fee=<micro-USDC>"
fn parse_memo(memo: &str) -> Option<(u64, String, u128)> {
    let body = memo.strip_prefix("kruxa:v1:")?;
    let (mut t, mut d, mut f) = (None, None, None);
    for part in body.split(';') {
        match part.split_once('=')? {
            ("t", v) if t.is_none() => t = Some(v.parse().ok()?),
            ("d", v) if d.is_none() => d = Some(v.to_string()),
            ("fee", v) if f.is_none() => f = Some(v.parse().ok()?),
            _ => return None,
        }
    }
    Some((t?, d?, f?))
}

fn pubkey(signed: &Value) -> Option<[u8; 32]> {
    let raw = bs58::decode(signed.get("public_key")?.as_str()?.strip_prefix("ed25519:")?).into_vec().ok()?;
    <[u8; 32]>::try_from(raw.as_slice()).ok()
}

#[near]
impl Contract {
    pub fn contribute_via_intents(&mut self, signed: Value) -> Promise {
        self.require_live();
        let bad = |t: &str| -> ! { fail(RuleCode::RSignedMsg, t) };
        if signed.get("standard").and_then(Value::as_str) != Some("raw_ed25519") {
            bad("only the raw_ed25519 standard (Phantom) is accepted");
        }
        let raw = signed.get("payload").and_then(Value::as_str).unwrap_or_else(|| bad("payload must be a string"));
        let payload: S4Payload = serde_json::from_str(raw).unwrap_or_else(|_| bad("payload is not the strict Kruxa transfer shape"));
        let pk = pubkey(&signed).unwrap_or_else(|| bad("public_key must be ed25519:<base58 of 32 bytes>"));
        if payload.verifying_contract != self.cfg.intents || payload.signer_id.as_str() != hex(&pk) {
            bad("verifying_contract must be intents.near and signer_id the lowercase hex of the key");
        }
        let [S4Intent::Transfer { receiver_id, tokens, memo }] = payload.intents.as_slice() else { bad("exactly one transfer intent") };
        let amount = match tokens.iter().collect::<Vec<_>>().as_slice() {
            [(token, amount)] if **token == self.cfg.usdc_token_id => {
                amount.parse::<u128>().unwrap_or_else(|_| bad("amount is not a decimal string"))
            }
            _ => bad("exactly one token, and it must be USDC"),
        };
        if *receiver_id != env::current_account_id() {
            bad("receiver_id must be this contract");
        }
        let (id, deliver, fee) =
            parse_memo(memo.as_deref().unwrap_or("")).unwrap_or_else(|| bad("memo must be kruxa:v1:t=<id>;d=sol:<key>;fee=<micro>"));
        let holder =
            HolderId::parse(&deliver).filter(|h| *h == HolderId::Solana(pk)).unwrap_or_else(|| bad("d must be sol:<the signing key>"));
        if let Err(v) = self.check_commit(id, &holder, Custody::Intents, amount, fee) {
            env::panic_str(&v.message());
        }
        emit("contribution_submitted", json!({ "launch_id": id.to_string(), "holder": holder.key(), "amount": amount.to_string() }));
        ext_intents::ext(self.cfg.intents.clone()).with_static_gas(Gas::from_tgas(150)).execute_intents(vec![signed]).then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_contribute_intents(
                U64(id),
                holder.key(),
                U128(amount),
                U128(fee),
            ),
        )
    }

    #[private]
    pub fn on_contribute_intents(&mut self, launch_id: U64, holder: String, amount: U128, fee: U128) {
        if env::promise_result_checked(0, 1 << 16).is_err() {
            emit("contribution_failed", json!({ "launch_id": launch_id.0.to_string(), "holder": holder }));
            return;
        }
        let Some(h) = HolderId::parse(&holder) else { return };
        if let Err(v) = self.try_commit(launch_id.0, h.clone(), Custody::Intents, amount.0, fee.0, None) {
            self.park_rejected(launch_id.0, h, amount.0);
            emit("deposit_rejected_refundable", json!({ "launch_id": launch_id.0.to_string(), "holder": holder, "code": v.code.as_str() }));
        }
    }
}

impl Contract {
    /// The window closed between forwarding and the callback: the money is already ours, so record it as owed back.
    fn park_rejected(&mut self, id: u64, holder: HolderId, amount: u128) {
        let mut st = self.state(id);
        let key = (id, holder.clone());
        let mut pos = self.positions.get(&key).cloned().unwrap_or_else(|| {
            st.holder_count += 1;
            st.positions_live += 1;
            self.seq_index.insert((id, st.holder_count - 1), holder.clone());
            Position {
                seq: st.holder_count - 1,
                deliver: holder.clone(),
                referrer: None,
                contributed: 0,
                open_native: 0,
                open_intents: 0,
                due_native: 0,
                due_intents: 0,
                inflight_native: 0,
                inflight_intents: 0,
                refunded: 0,
                spent: 0,
                tokens_entitled: 0,
                bonus_entitled: 0,
                claimed: 0,
                settled: false,
            }
        });
        pos.contributed += amount;
        pos.due_intents += amount;
        st.ledger.credited += amount;
        st.ledger.due_intents += amount;
        self.cfg.global_held += amount;
        self.positions.insert(key, pos);
        self.save_state(id, st);
    }
}
```

### Key Decisions
- **Checks, then effects, never a promise inside `try_commit`.** `check_commit` is non-mutating and shared by the preview view, the native path, S3 and S4, so the preview a buyer sees is the same code that decides.
- **Debit before outbound, re-credit in the callback.** `pay_due`, `consolidate`, `pay_launch_fee`, `draw`, `pay_relay_fees` and `claim_tokens` all move the counter first; `on_payout` undoes it on failure and never panics on user data (saturating arithmetic, no indexing, no loops).
- **Rejection is a return value, not a panic**, on both intake paths, so the token contract or the Verifier refunds automatically and indexers see a `deposit_rejected` event with the code.
- **Settlement is lazy and O(1) per position**; `settle` itself is O(1) for any number of participants.
- **The creator bond is the storage payer** (330 bytes x 1e-5 NEAR per holder plus a 3,000-byte launch record), refundable through `reclaim_bond` once no position record remains.
- **Wave 1 cuts, stated:** no creator-allocation vesting, no LP-token distribution, no Solana genesis, no fee router (Section 5), and `claim_tokens` requires the claimant to be registered on the launch token first.

## 4.5 Test doubles

### Purpose
Faithful-enough stand-ins so the whole money path runs in the free sandbox. They are `[ASSUMED]` to mirror the real contracts' call shapes; each is small enough to audit by eye, and each was already corrected once by running (the mock factory initially expected the wrong argument nesting, which the first sandbox run caught).

### Code

[VERIFIED] - built
```toml
# File: contracts/mock-ft/Cargo.toml
[package]
name = "mock-ft"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = { workspace = true }
```

[ASSUMED] - NEP-141/NEP-145 behaviour mirrors the standard (receiver must be registered; unused amount refunded by the resolver); not the real USDC contract
```rust
// File: contracts/mock-ft/src/lib.rs
//! Test-only NEP-141 + NEP-145 token. Stands in for native USDC and for the launch token. Never deployed anywhere real.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

#[ext_contract(ext_receiver)]
pub trait Receiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    balances: LookupMap<AccountId, u128>,
    registered: LookupMap<AccountId, bool>,
    total: u128,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let mut s = Self { balances: LookupMap::new(b"b"), registered: LookupMap::new(b"r"), total: total_supply.0 };
        s.balances.insert(owner_id.clone(), total_supply.0);
        s.registered.insert(owner_id, true);
        s
    }

    /// Test helper: mint to an account (registers it).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let b = self.bal(&account_id);
        self.balances.insert(account_id.clone(), b + amount.0);
        self.registered.insert(account_id, true);
        self.total += amount.0;
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, _registration_only: Option<bool>) -> Value {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        self.registered.insert(who, true);
        json!({ "total": "1250000000000000000000", "available": "0" })
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<Value> {
        self.registered.get(&account_id).map(|_| json!({ "total": "1250000000000000000000", "available": "0" }))
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.bal(&account_id))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>) {
        assert_one_yocto();
        self.move_tokens(&env::predecessor_account_id(), &receiver_id, amount.0);
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>, msg: String) -> Promise {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, amount.0);
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(Gas::from_tgas(60))
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).ft_resolve_transfer(sender, receiver_id, amount))
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).map(|u| u.0).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let refund = unused.min(amount.0).min(self.bal(&receiver_id));
        if refund > 0 {
            self.move_tokens(&receiver_id, &sender_id, refund);
        }
        U128(amount.0 - refund)
    }
}

impl MockFt {
    fn bal(&self, a: &AccountId) -> u128 {
        self.balances.get(a).copied().unwrap_or(0)
    }

    fn move_tokens(&mut self, from: &AccountId, to: &AccountId, amount: u128) {
        require!(self.registered.get(to).copied().unwrap_or(false), "receiver is not registered");
        let fb = self.bal(from);
        require!(fb >= amount, "insufficient balance");
        self.balances.insert(from.clone(), fb - amount);
        let tb = self.bal(to);
        self.balances.insert(to.clone(), tb + amount);
        let _ = NearToken::from_yoctonear(0);
    }
}

#[near]
impl MockFt {
    /// Test helper: drop an account's registration, to make an outbound ft_transfer fail.
    pub fn unregister(&mut self, account_id: AccountId) {
        self.registered.insert(account_id, false);
    }
}
```

[VERIFIED] - built
```toml
# File: contracts/mock-intents/Cargo.toml
[package]
name = "mock-intents"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = { workspace = true }
```

[ASSUMED] - models W0 OV1/OV2: flat `msg`, balance moved before `mt_on_transfer`, unused amounts refunded to the signer, no signature verification
```rust
// File: contracts/mock-intents/src/lib.rs
//! Test-only intents.near. Implements the slice Kruxa touches: mt_balance_of, mt_transfer, ft_withdraw and
//! execute_intents for transfer intents with the flat `msg` / `min_gas` keys (W0 OV1). It does NOT verify signatures.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value};
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[ext_contract(ext_usdc)]
pub trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockIntents {
    balances: LookupMap<(AccountId, String), u128>,
}

#[near]
impl MockIntents {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b") }
    }

    /// Test helper: credit an internal balance (the harness sends the underlying USDC here separately).
    pub fn mt_deposit(&mut self, account_id: AccountId, token_id: String, amount: U128) {
        let b = self.bal(&account_id, &token_id);
        self.balances.insert((account_id, token_id), b + amount.0);
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.bal(&account_id, &token_id))
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        _approval: Option<(AccountId, u64)>,
        _memo: Option<String>,
    ) {
        assert_one_yocto();
        self.mv(&env::predecessor_account_id(), &receiver_id, &token_id, amount.0);
    }

    /// Withdraw to the native token contract: debit first, re-credit in the resolver on failure.
    #[payable]
    pub fn ft_withdraw(
        &mut self,
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
        _memo: Option<String>,
        _msg: Option<String>,
    ) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let tid = format!("nep141:{}", token);
        let b = self.bal(&who, &tid);
        require!(b >= amount.0, "insufficient balance");
        self.balances.insert((who.clone(), tid.clone()), b - amount.0);
        ext_usdc::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(20))
            .ft_transfer(receiver_id, amount, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).resolve_withdraw(who, tid, amount))
    }

    #[private]
    pub fn resolve_withdraw(&mut self, who: AccountId, token_id: String, amount: U128) {
        if env::promise_result_checked(0, 64).is_err() {
            let b = self.bal(&who, &token_id);
            self.balances.insert((who, token_id), b + amount.0);
        }
    }

    /// Executes transfer intents. Moves the balance first, then notifies the receiver when `msg` is present (S3).
    pub fn execute_intents(&mut self, signed: Vec<Value>) {
        let mut calls = Vec::new();
        for s in signed {
            let payload: Value = serde_json::from_str(s["payload"].as_str().expect("payload string")).expect("payload json");
            let signer: AccountId = payload["signer_id"].as_str().expect("signer_id").parse().expect("account");
            for it in payload["intents"].as_array().expect("intents") {
                require!(it["intent"] == "transfer", "only transfer intents");
                let receiver: AccountId = it["receiver_id"].as_str().expect("receiver").parse().expect("account");
                for (tid, amt) in it["tokens"].as_object().expect("tokens") {
                    let amount: u128 = amt.as_str().expect("amount").parse().expect("u128");
                    self.mv(&signer, &receiver, tid, amount);
                    if let Some(msg) = it.get("msg").and_then(Value::as_str) {
                        calls.push(self.notify(&signer, &receiver, tid, amount, msg.to_string()));
                    }
                }
            }
        }
        drop(calls);
    }

    #[private]
    pub fn resolve_notify(&mut self, sender: AccountId, receiver: AccountId, token_id: String, amount: U128) -> Vec<U128> {
        let unused = match env::promise_result_checked(0, 256) {
            Ok(b) => serde_json::from_slice::<Vec<U128>>(&b).ok().and_then(|v| v.first().map(|u| u.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let refund = unused.min(amount.0).min(self.bal(&receiver, &token_id));
        if refund > 0 {
            self.mv(&receiver, &sender, &token_id, refund);
        }
        vec![U128(amount.0 - refund)]
    }
}

impl MockIntents {
    fn bal(&self, a: &AccountId, t: &str) -> u128 {
        self.balances.get(&(a.clone(), t.to_string())).copied().unwrap_or(0)
    }

    fn mv(&mut self, from: &AccountId, to: &AccountId, t: &str, amount: u128) {
        require!(from != to, "invalid intent: sender == receiver");
        let fb = self.bal(from, t);
        require!(fb >= amount, "insufficient balance or overflow");
        self.balances.insert((from.clone(), t.to_string()), fb - amount);
        let tb = self.bal(to, t);
        self.balances.insert((to.clone(), t.to_string()), tb + amount);
    }

    fn notify(&self, signer: &AccountId, receiver: &AccountId, tid: &str, amount: u128, msg: String) -> Promise {
        ext_mt_receiver::ext(receiver.clone())
            .with_static_gas(Gas::from_tgas(50))
            .mt_on_transfer(signer.clone(), vec![signer.clone()], vec![tid.to_string()], vec![U128(amount)], msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).resolve_notify(
                signer.clone(),
                receiver.clone(),
                tid.to_string(),
                U128(amount),
            ))
    }
}
```

[VERIFIED] - built
```toml
# File: contracts/mock-factory/Cargo.toml
[package]
name = "mock-factory"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = { workspace = true }
```

[ASSUMED] - enforces the `create_token` argument shape of S1-A 8.4; creates nothing (the harness pre-deploys the token account)
```rust
// File: contracts/mock-factory/src/lib.rs
//! Test-only stand-in for token.primitives.near. The harness pre-deploys the token account the real factory would create.
use near_sdk::serde_json::Value;
use near_sdk::{env, near, require, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFactory {
    fail: bool,
}

#[near]
impl MockFactory {
    #[init]
    pub fn new() -> Self {
        Self { fail: false }
    }

    /// Test switch: make create_token fail, to exercise the CreationFailed path.
    pub fn set_fail(&mut self, fail: bool) {
        self.fail = fail;
    }

    #[payable]
    pub fn create_token(&mut self, args: Value) {
        require!(!self.fail, "factory refuses");
        require!(args.get("total_supply").is_some() && args.get("owner_id").is_some(), "args.total_supply / args.owner_id missing");
        require!(env::attached_deposit().as_yoctonear() > 0, "deposit required");
    }
}
```

## 4.6 kruxa-sim and verify.sh

### Purpose
The judge path with no keys: recompute a verdict or a settlement with the contract's own pure code; `--tamper` flips one unit of the recorded inputs and must print MISMATCH. `scripts/verify.sh golden` needs no network.

### Code

[VERIFIED] - built
```toml
# File: tools/kruxa-sim/Cargo.toml
[package]
name = "kruxa-sim"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[dependencies]
kruxa-logic = { path = "../../crates/kruxa-logic" }
kruxa-math = { path = "../../crates/kruxa-math" }
serde_json = "1"
ureq = { version = "2", features = ["json"] }
base64 = "0.22"
```

[VERIFIED] - `verdict` and `settle` subcommands run and match S1-B example 1; `verify` against a live RPC is UNVERIFIED until a testnet deployment exists
```rust
// File: tools/kruxa-sim/src/main.rs
//! kruxa-sim: recompute Kruxa results with the SAME pure code the contract runs.
//!   kruxa-sim verdict --launch-id 1 --total-active 360000000 --funders 12 --soft-cap 350000000 --min-funders 10 [--cancelled] [--charter-hash <64 hex>]
//!   kruxa-sim verify --rpc https://rpc.testnet.near.org --contract core.kruxa.testnet --launch 1 [--tamper]
//!   kruxa-sim settle --total-active 1400000000 --hard-cap 1000000000 --commit 100000000
use kruxa_logic::{allocate, hex, inputs_hash, settle_position, verdict, Outcome, Rules, VerdictInputs};
use serde_json::{json, Value};
use std::collections::HashMap;

fn flags(args: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(k) = args[i].strip_prefix("--") {
            let takes_value = args.get(i + 1).is_some_and(|v| !v.starts_with("--"));
            m.insert(k.to_string(), if takes_value { args[i + 1].clone() } else { "true".into() });
            i += if takes_value { 2 } else { 1 };
        } else {
            i += 1;
        }
    }
    m
}

fn num<T: std::str::FromStr>(f: &HashMap<String, String>, k: &str) -> T {
    f.get(k).and_then(|v| v.parse().ok()).unwrap_or_else(|| die(&format!("--{k} is required and must be a number")))
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(2)
}

fn parse_hash(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    if s.len() != 64 || (0..32).any(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map(|b| out[i] = b).is_err()) {
        die("charter hash must be 64 hex chars");
    }
    out
}

fn describe(i: &VerdictInputs) -> (String, String) {
    let out = match verdict(i) {
        Outcome::Pass => "PASS".to_string(),
        Outcome::Fail(r) => format!("FAIL(reasons={r})"),
    };
    (out, hex(&inputs_hash(i)))
}

fn view(rpc: &str, contract: &str, method: &str, args: Value) -> Value {
    let body = json!({ "jsonrpc": "2.0", "id": "kruxa", "method": "query", "params": { "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method, "args_base64": base64_encode(args.to_string().as_bytes()) } });
    let resp: Value = ureq::post(rpc)
        .send_json(body)
        .unwrap_or_else(|e| die(&format!("rpc: {e}")))
        .into_json()
        .unwrap_or_else(|e| die(&format!("rpc json: {e}")));
    let bytes: Vec<u8> = resp["result"]["result"]
        .as_array()
        .unwrap_or_else(|| die(&format!("view {method} failed: {resp}")))
        .iter()
        .map(|b| b.as_u64().unwrap_or(0) as u8)
        .collect();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn base64_encode(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let f = flags(&args);
    match args.first().map(String::as_str) {
        Some("verdict") => {
            let i = VerdictInputs {
                launch_id: num(&f, "launch-id"),
                charter_hash: f.get("charter-hash").map_or([0; 32], |h| parse_hash(h)),
                total_active: num(&f, "total-active"),
                active_funders: num(&f, "funders"),
                soft_cap: num(&f, "soft-cap"),
                min_funders: num(&f, "min-funders"),
                cancelled: f.contains_key("cancelled"),
            };
            let (out, h) = describe(&i);
            println!("outcome={out}\ninputs_hash={h}");
        }
        Some("settle") => {
            let (total, hard, commit): (u128, u128, u128) = (num(&f, "total-active"), num(&f, "hard-cap"), num(&f, "commit"));
            let r = Rules { max_hard_cap: hard.max(Rules::ladder().max_hard_cap), ..Rules::ladder() };
            let a = allocate(total, hard, 6_000, 2_500, &r).unwrap_or_else(|e| die(&format!("{e:?}")));
            let p = settle_position(commit, total, a.accepted, 600_000_000_000_000, 50_000_000_000_000)
                .unwrap_or_else(|e| die(&format!("{e:?}")));
            println!(
                "accepted={} launch_fee={} lp_quote={} stream={} excess_pool={}\nspend={} refund={} tokens={} bonus={}",
                a.accepted, a.launch_fee, a.lp_quote, a.stream, a.excess_pool, p.spend, p.refund, p.tokens, p.bonus
            );
        }
        Some("verify") => {
            let (rpc, contract, launch) = (
                f.get("rpc").cloned().unwrap_or_else(|| die("--rpc")),
                f.get("contract").cloned().unwrap_or_else(|| die("--contract")),
                f.get("launch").cloned().unwrap_or_else(|| die("--launch")),
            );
            let vi = view(&rpc, &contract, "get_verdict_inputs", json!({ "launch_id": launch }));
            let st = view(&rpc, &contract, "get_settlement", json!({ "launch_id": launch }));
            let mut i: VerdictInputs = serde_json::from_value(vi["inputs"].clone()).unwrap_or_else(|e| die(&format!("inputs: {e}")));
            if f.contains_key("tamper") {
                i.total_active += 1;
            }
            let (out, h) = describe(&i);
            let stored_pass = st["pass"].as_bool();
            let stored_hash = st["inputs_hash"].as_str().unwrap_or("");
            let ok = stored_pass == Some(out == "PASS") && stored_hash == h;
            println!(
                "recomputed outcome={out} inputs_hash={h}\nstored     pass={stored_pass:?} inputs_hash={stored_hash}\n{}",
                if ok { "MATCH" } else { "MISMATCH" }
            );
            std::process::exit(if ok { 0 } else { 1 });
        }
        _ => die("usage: kruxa-sim verdict|settle|verify (see the file header)"),
    }
}
```

[VERIFIED] - `golden` mode ran 2026-11-07 and printed the expected PASS / FAIL / example-1 numbers; `chain` mode needs a deployment
```bash
# File: scripts/verify.sh
#!/usr/bin/env bash
# Judge entry point. No keys, no funds.
#   ./scripts/verify.sh golden                         offline: recompute the documented vectors
#   ./scripts/verify.sh chain <rpc> <contract> <id>    recompute a live launch's verdict from its public views
#   ./scripts/verify.sh chain <rpc> <contract> <id> --tamper   flips one unit of the recorded inputs; MUST print MISMATCH
set -euo pipefail
cd "$(dirname "$0")/.."
SIM="cargo run -q -p kruxa-sim --"
case "${1:-}" in
  golden)
    echo "== boundary: total == soft cap and funders == min  -> PASS"
    $SIM verdict --launch-id 1 --total-active 350000000 --funders 10 --soft-cap 350000000 --min-funders 10
    echo "== one micro-USDC below the soft cap               -> FAIL(reasons=1)"
    $SIM verdict --launch-id 1 --total-active 349999999 --funders 10 --soft-cap 350000000 --min-funders 10
    echo "== S1-B example 1: 12,500 USDC against a 5,000 USDC cap, one 100 USDC buyer pays 40 and is refunded 60"
    $SIM settle --total-active 12500000000 --hard-cap 5000000000 --commit 100000000
    ;;
  chain)
    shift
    $SIM verify --rpc "$1" --contract "$2" --launch "$3" ${4:+"$4"}
    ;;
  *) echo "usage: $0 golden | chain <rpc> <contract> <launch_id> [--tamper]"; exit 2 ;;
esac
```

> **Sync 2026-11-10 (4.6).** `kruxa-sim verify` and `scripts/verify.sh` follow the CO-6 exit-code contract and add `--rpc2`, `--tamper <field>`, `--tamper-all`, `fold`, `validate`, `fuzz` and a full-run mode. `kruxa-sim validate` exits 65 on a refused parameter set and 0 on an accepted one (the Wave 1 text here says exit 0 with no rule code). The embedded `kruxa-sim` and `verify.sh` code above is the pre-patch version by design. Check coverage is C1 to C28 plus the NEAR recompute lines C31 to C34 printed by `kruxa-sim`; checks C33 and C34 have no live transcript in `evidence/`. On plain RPC the latest F0 run (`evidence/testnet-core3/verify-8-f0.txt`) passes 21 checks and skips 7: C12 (needs `--charter`), C28 (needs `--rpc2`), C10 (needs the hosted metadata JSON), C22 (no creator allocation in the record), C23 (plain RPC cannot enumerate a contract's events), C25 (no Verdict Rail attestation), C30 (FAIL-path check on a PASS launch). The F1 run (`verify-4-f1.txt`) skips 8 (the same seven plus C27, no derived key). The CODE line compares `view_code` with `artifacts/SHA256SUMS`; after any redeploy run `./scripts/build-artifacts.sh --local` first or the run exits 2 on a CODE MISMATCH.

## 4.7 Sandbox test suite

### Purpose
End-to-end and adversarial coverage against the real compiled wasm in the near-workspaces sandbox: 19 tests, one failing case for every reachable `R_*` code, plus callback re-credit, fake token, direct callback, pause/freeze and creation failure.

### Code

[VERIFIED] - built
```toml
# File: tests/Cargo.toml
[package]
name = "kruxa-tests"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[dependencies]
near-workspaces = { version = "=0.24.0" }
tokio = { version = "1", features = ["full"] }
serde_json = "1"
anyhow = "1"
ed25519-dalek = "2"
bs58 = "0.5"
kruxa-logic = { path = "../crates/kruxa-logic" }
```

[VERIFIED] - harness used by all 19 tests
```rust
// File: tests/src/lib.rs
//! Sandbox harness: deploys core + mock USDC + mock intents + mock factory, and wraps the calls the tests repeat.
use ed25519_dalek::{Signer, SigningKey};
use kruxa_logic::{hex, TrialParams};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const GAS: Gas = Gas::from_tgas(300);

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../target/near/{}/{}.wasm", env!("CARGO_MANIFEST_DIR"), name, name);
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}: run scripts/build.sh first"))
}

async fn funded(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(200)).transact().await?.into_result()?)
}

async fn deploy_at(root: &Account, name: &str, code: Vec<u8>) -> anyhow::Result<Contract> {
    let a = root.create_subaccount(name).initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    Ok(a.deploy(&code).await?.into_result()?)
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub core: Contract,
    pub usdc: Contract,
    pub intents: Contract,
    pub factory: Contract,
    pub owner: Account,
    pub guardian: Account,
    pub creator: Account,
    pub treasury: Account,
    pub relay_fees: Account,
    pub next_id: std::cell::Cell<u64>,
}

/// True if any log of the execution carries the rule code (events and panics both start with it).
pub fn has_code(res: &ExecutionFinalResult, code: &str) -> bool {
    res.logs().iter().any(|l| l.contains(code)) || format!("{:?}", res.failures()).contains(code)
}

pub fn msg(launch_id: u64, deliver: Option<&str>, relay_fee: Option<u128>) -> String {
    let mut m = json!({ "v": 1, "op": "contribute", "launch_id": launch_id.to_string() });
    if let Some(d) = deliver {
        m["deliver"] = json!(d);
    }
    if let Some(f) = relay_fee {
        m["relay_fee"] = json!(f.to_string());
    }
    m.to_string()
}

/// A Solana-style holder: ed25519 key, its 64-hex Intents account, and its base58 form.
pub struct SolHolder {
    pub sk: SigningKey,
    pub hex: String,
    pub b58: String,
}

pub fn sol_holder(seed: u8) -> SolHolder {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = sk.verifying_key().to_bytes();
    SolHolder { hex: hex(&pk), b58: bs58::encode(pk).into_string(), sk }
}

impl SolHolder {
    pub fn key(&self) -> String {
        format!("sol:{}", self.b58)
    }
    pub fn sign(&self, message: &str) -> String {
        bs58::encode(self.sk.sign(message.as_bytes()).to_bytes()).into_string()
    }
}

impl Env {
    pub async fn new() -> anyhow::Result<Env> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let owner = funded(&root, "owner").await?;
        let guardian = funded(&root, "guardian").await?;
        let creator = funded(&root, "creator").await?;
        let treasury = funded(&root, "treasury").await?;
        let relay_fees = funded(&root, "relayfees").await?;
        let usdc = deploy_at(&root, "usdc", wasm("mock_ft")).await?;
        usdc.call("new").args_json(json!({ "owner_id": owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
        let intents = deploy_at(&root, "intents", wasm("mock_intents")).await?;
        intents.call("new").transact().await?.into_result()?;
        let factory = deploy_at(&root, "factory", wasm("mock_factory")).await?;
        factory.call("new").transact().await?.into_result()?;
        let core = deploy_at(&root, "core", wasm("kruxa_core")).await?;
        core.call("new")
            .args_json(json!({ "owner": owner.id(), "guardian": guardian.id(), "treasury": treasury.id(), "relay_fees": relay_fees.id(), "usdc": usdc.id(), "intents": intents.id(), "factory": factory.id(), "profile": "demo" }))
            .transact()
            .await?
            .into_result()?;
        let env =
            Env { worker, core, usdc, intents, factory, owner, guardian, creator, treasury, relay_fees, next_id: std::cell::Cell::new(1) };
        for who in [env.core.id().clone(), env.intents.id().clone(), env.treasury.id().clone(), env.creator.id().clone()] {
            env.register(&env.usdc, &who).await?;
        }
        Ok(env)
    }

    pub async fn register(&self, token: &Contract, who: &AccountId) -> anyhow::Result<()> {
        self.owner
            .call(token.id(), "storage_deposit")
            .args_json(json!({ "account_id": who }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn user(&self, name: &str, usdc: u128) -> anyhow::Result<Account> {
        let a = self
            .worker
            .root_account()?
            .create_subaccount(name)
            .initial_balance(NearToken::from_near(20))
            .transact()
            .await?
            .into_result()?;
        self.register(&self.usdc, a.id()).await?;
        self.usdc.call("mint").args_json(json!({ "account_id": a.id(), "amount": usdc.to_string() })).transact().await?.into_result()?;
        Ok(a)
    }

    pub async fn usdc_balance(&self, who: &AccountId) -> u128 {
        let v: String = self.usdc.view("ft_balance_of").args_json(json!({ "account_id": who })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }

    pub async fn intents_balance(&self, who: &str) -> u128 {
        let v: String = self
            .intents
            .view("mt_balance_of")
            .args_json(json!({ "account_id": who, "token_id": format!("nep141:{}", self.usdc.id()) }))
            .await
            .unwrap()
            .json()
            .unwrap();
        v.parse().unwrap()
    }

    /// Gives `who` an Intents balance backed by real mock-USDC held by the intents contract.
    pub async fn fund_intents(&self, who: &str, amount: u128) -> anyhow::Result<()> {
        self.usdc
            .call("mint")
            .args_json(json!({ "account_id": self.intents.id(), "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        self.intents
            .call("mt_deposit")
            .args_json(json!({ "account_id": who, "token_id": format!("nep141:{}", self.usdc.id()), "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// Pre-deploys the token account the real factory would create, then calls create_trial. Returns the launch id.
    pub async fn create_launch(&self, p: &TrialParams) -> anyhow::Result<u64> {
        let required: String = self.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
        let supply = (p.total_supply_whole as u128) * USDC;
        let token = self
            .factory
            .as_account()
            .create_subaccount(&p.symbol.to_lowercase())
            .initial_balance(NearToken::from_near(5))
            .transact()
            .await?
            .into_result()?;
        let token = token.deploy(&wasm("mock_ft")).await?.into_result()?;
        token
            .call("new")
            .args_json(json!({ "owner_id": self.core.id(), "total_supply": supply.to_string() }))
            .transact()
            .await?
            .into_result()?;
        let id = self.next_id.get();
        let res = self
            .creator
            .call(self.core.id(), "create_trial")
            .args_json(json!({ "params": p, "stream_recipient": null }))
            .deposit(NearToken::from_yoctonear(required.parse()?))
            .gas(GAS)
            .transact()
            .await?;
        if std::env::var("KRUXA_DEBUG").is_ok() {
            eprintln!("create_trial logs: {:#?}\nfailures: {:#?}", res.logs(), res.failures());
        }
        res.into_result()?;
        self.next_id.set(id + 1);
        Ok(id)
    }

    pub fn token_id(&self, symbol: &str) -> AccountId {
        format!("{}.{}", symbol.to_lowercase(), self.factory.id()).parse().unwrap()
    }

    pub async fn token_balance(&self, symbol: &str, who: &AccountId) -> u128 {
        let v: String = self
            .worker
            .view(&self.token_id(symbol), "ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await
            .unwrap()
            .json()
            .unwrap();
        v.parse().unwrap()
    }

    pub async fn register_on_token(&self, symbol: &str, who: &AccountId) -> anyhow::Result<()> {
        self.owner
            .call(&self.token_id(symbol), "storage_deposit")
            .args_json(json!({ "account_id": who }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn view(&self, method: &str, args: Value) -> Value {
        self.core.view(method).args_json(args).await.unwrap().json().unwrap()
    }

    pub async fn state(&self, id: u64) -> Value {
        self.view("get_state", json!({ "launch_id": id.to_string() })).await
    }

    /// Fast-forwards the sandbox until the launch reaches `phase` (Open | Closing | Ready).
    pub async fn advance_to(&self, id: u64, phase: &str) {
        for _ in 0..400 {
            if self.state(id).await["phase"] == phase {
                return;
            }
            self.worker.fast_forward(100).await.unwrap();
        }
        panic!("launch {id} never reached {phase}");
    }

    /// Sends USDC to core with a commit message (native path).
    pub async fn commit_native(&self, who: &Account, id: u64, amount: u128, deliver: Option<&str>) -> ExecutionFinalResult {
        who.call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.core.id(), "amount": amount.to_string(), "msg": msg(id, deliver, None) }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await
            .unwrap()
    }

    /// S3 path through the mock Verifier: a signed-transfer-shaped payload with the flat `msg` key.
    pub async fn commit_s3(&self, holder: &SolHolder, id: u64, amount: u128, relay_fee: u128) -> ExecutionFinalResult {
        self.s3_payload(&holder.hex, id, amount, Some(msg(id, Some(&holder.key()), Some(relay_fee)))).await
    }

    pub async fn s3_payload(&self, signer: &str, _id: u64, amount: u128, msg: Option<String>) -> ExecutionFinalResult {
        let mut intent = json!({ "intent": "transfer", "receiver_id": self.core.id(), "tokens": { format!("nep141:{}", self.usdc.id()): amount.to_string() } });
        if let Some(m) = msg {
            intent["msg"] = json!(m);
            intent["min_gas"] = json!("50000000000000");
        }
        let payload = json!({ "signer_id": signer, "verifying_contract": self.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": "AAAA", "intents": [intent] });
        let signed = json!({ "standard": "raw_ed25519", "payload": payload.to_string(), "public_key": "ed25519:11111111111111111111111111111111", "signature": "ed25519:1" });
        self.worker_call(&self.owner, self.intents.id(), "execute_intents", json!({ "signed": [signed] })).await
    }

    /// S4: the buyer signs a transfer WITHOUT msg; anyone forwards it through contribute_via_intents.
    pub fn s4_signed(&self, h: &SolHolder, id: u64, amount: u128, fee: u128) -> Value {
        let intent = json!({ "intent": "transfer", "receiver_id": self.core.id(), "tokens": { format!("nep141:{}", self.usdc.id()): amount.to_string() },
                             "memo": format!("kruxa:v1:t={};d={};fee={}", id, h.key(), fee) });
        let payload = json!({ "signer_id": h.hex, "verifying_contract": self.intents.id(), "deadline": "2099-01-01T00:00:00.000Z", "nonce": "AAAA", "intents": [intent] });
        json!({ "standard": "raw_ed25519", "payload": payload.to_string(), "public_key": format!("ed25519:{}", h.b58), "signature": "ed25519:1" })
    }

    pub async fn worker_call(&self, who: &Account, to: &AccountId, method: &str, args: Value) -> ExecutionFinalResult {
        who.call(to, method).args_json(args).gas(GAS).transact().await.unwrap()
    }

    pub async fn call(&self, who: &Account, method: &str, args: Value, deposit: NearToken) -> ExecutionFinalResult {
        who.call(self.core.id(), method).args_json(args).deposit(deposit).gas(GAS).transact().await.unwrap()
    }
}
```

[VERIFIED] - 6 tests pass
```rust
// File: tests/tests/lifecycle.rs
//! End-to-end lifecycle against the sandbox: create, commit, Walk, settle PASS (under- and oversubscribed), settle FAIL, refunds, claims.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().unwrap().parse().unwrap()
}

fn lid(id: u64) -> Value {
    json!({ "launch_id": id.to_string() })
}

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

async fn fill(env: &Env, id: u64, n: usize, each: u128) -> Vec<Account> {
    let mut users = Vec::new();
    for i in 0..n {
        let u = env.user(&format!("u{i}"), 1_000 * USDC).await.unwrap();
        let r = env.commit_native(&u, id, each, None).await;
        assert!(r.is_success(), "commit {i} failed: {:?}", r.failures());
        users.push(u);
    }
    users
}

async fn settle_all(env: &Env, id: u64) {
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result().unwrap();
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()
        .unwrap();
}

#[tokio::test]
async fn create_trial_opens_after_token_verification() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    let st = env.state(id).await;
    assert_eq!((st["status"].as_str(), st["phase"].as_str()), (Some("Open"), Some("Open")));
    assert_eq!(st["token"], format!("abcd.{}", env.factory.id()));
    Ok(())
}

#[tokio::test]
async fn pass_undersubscribed_full_money_path() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("ABCD")).await?;
    fill(&env, id, 12, 30 * USDC).await; // 360 USDC >= soft cap 350, 12 funders >= 10
    assert_eq!(env.state(id).await["total_active"], (360 * USDC).to_string());
    let early = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(has_code(&early, "R_TOO_EARLY"), "settle before walk_end must fail");
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?, "settle must PASS");
    let again = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(again.json::<bool>()?, "settle is idempotent");
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    let led = env.view("get_ledger", lid(id)).await;
    assert_eq!((num(&led, "launch_fee_due"), num(&led, "excess_pool")), (10 * USDC, 0));
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    let all = env.call(&env.creator, "draw", json!({ "launch_id": id.to_string(), "amount": led["stream_total"] }), ZERO).await;
    assert!(has_code(&all, "STREAM_CAP"), "withdraw-all must hit STREAM_CAP");
    Ok(())
}

#[tokio::test]
async fn pass_oversubscribed_four_buckets_refunds_and_claims() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("OVER")).await?;
    let users = fill(&env, id, 14, 100 * USDC).await; // 1,400 > hard cap 1,000
    settle_all(&env, id).await;
    let st = env.view("get_settlement", lid(id)).await;
    assert_eq!((num(&st, "accepted"), num(&st, "excess_pool")), (1_000 * USDC, 400 * USDC));
    let (spend, refund) = (71_428_572u128, 28_571_428u128); // S1-B rounding rules: spend ceil, refund floor
    let before = env.usdc_balance(users[0].id()).await;
    env.call(&users[1], "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) }), ZERO)
        .await
        .into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await - before, refund, "anyone may push a refund; destination is fixed");
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", users[0].id()) })).await;
    assert_eq!((num(&pos, "spent"), pos["conserved"].as_bool()), (spend, Some(true)));
    let noop = env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(noop.is_success() && !noop.json::<bool>()?, "second refund call is a harmless no-op");
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    // tokens: the holder registers on the launch token first, then claims sale tokens (+ the tiny vested bonus)
    env.register_on_token("OVER", users[2].id()).await?;
    env.call(&users[2], "claim_tokens", lid(id), ONE).await.into_result()?;
    let got = env.token_balance("OVER", users[2].id()).await;
    let expected = 42_857_142_857_142u128; // floor(100e6 * 600e12 / 1400e6)
    assert!(got >= expected && got < expected + 1_000_000_000, "got {got}");
    Ok(())
}

#[tokio::test]
async fn fail_below_soft_cap_refunds_everyone_then_dissolves_and_returns_bond() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FAIL")).await?;
    let users = fill(&env, id, 5, 30 * USDC).await;
    env.advance_to(id, "Ready").await;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && !r.json::<bool>()?);
    assert_eq!(env.state(id).await["status"], "Failed(3)");
    for u in &users {
        env.call(u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    }
    env.call(&env.creator, "dissolve", lid(id), ZERO).await.into_result()?;
    let bal = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(id), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > bal, "bond returned");
    assert_eq!(env.state(id).await["status"], "Dissolved");
    Ok(())
}

#[tokio::test]
async fn cancel_trial_makes_everyone_refundable_at_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("CNCL")).await?;
    let users = fill(&env, id, 3, 50 * USDC).await;
    assert!(has_code(&env.call(&users[0], "cancel_trial", lid(id), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.creator, "cancel_trial", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.state(id).await["status"], "Failed(4)");
    env.call(&users[0], "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC);
    Ok(())
}

#[tokio::test]
async fn walk_shrinks_the_book_refunds_and_closes_at_walk_end() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("WALK")).await?;
    let users = fill(&env, id, 2, 40 * USDC).await;
    env.call(&users[0], "walk", lid(id), ONE).await.into_result()?;
    let st = env.state(id).await;
    assert_eq!((st["total_active"].as_str(), st["active_funders"].as_u64()), (Some("40000000"), Some(1)));
    assert_eq!(env.usdc_balance(users[0].id()).await, 1_000 * USDC, "principal returned in full, no fee");
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_NO_POSITION"));
    assert!(env.commit_native(&users[0], id, 20 * USDC, None).await.is_success(), "a walker may commit again while Open");
    env.advance_to(id, "Closing").await;
    env.call(&users[1], "walk", lid(id), ONE).await.into_result()?;
    env.advance_to(id, "Ready").await;
    assert!(has_code(&env.call(&users[0], "walk", lid(id), ONE).await, "R_WALK_CLOSED"));
    Ok(())
}
```

[VERIFIED] - 9 tests pass (one is `#[ignore]` and slow; `scripts/test.sh --include-ignored` runs it)
```rust
// File: tests/tests/adversarial.rs
//! Adversarial cases: one failing case per R_* code reachable through the public API, plus pause/freeze,
//! callback re-credit, fake-token and direct-callback attacks, and creation failures.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);
const ONE: NearToken = NearToken::from_yoctonear(1);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> serde_json::Value {
    json!({ "launch_id": id.to_string() })
}

#[tokio::test]
async fn commits_that_break_a_rule_are_rejected_and_the_money_comes_back() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("RULE")).await?;
    let u = env.user("buyer", 1_000 * USDC).await?;
    let cases: Vec<(&str, u128, Option<&str>, &str)> = vec![
        ("R_MIN_CONTRIBUTION", 19 * USDC, None, "below min_buy"),
        ("R_CAP_ACCOUNT", 101 * USDC, None, "above wallet cap"),
        ("R_DELIVER", 30 * USDC, Some("sol:11111111111111111111111111111111"), "native payer may not deliver to Solana"),
    ];
    for (code, amount, deliver, why) in cases {
        let r = env.commit_native(&u, id, amount, deliver).await;
        assert!(has_code(&r, code), "{why}: expected {code}, logs {:?}", r.logs());
        assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "{why}: nothing may be kept");
    }
    // malformed and unknown-field messages
    for bad in [
        "{}",
        "not json",
        &json!({"v":1,"op":"contribute","launch_id":"1","evil":true}).to_string(),
        &json!({"v":1,"op":"contribute","launch_id":"1","relay_fee":"1"}).to_string(),
    ] {
        let r = u
            .call(env.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": env.core.id(), "amount": (30 * USDC).to_string(), "msg": bad }))
            .deposit(ONE)
            .gas(GAS)
            .transact()
            .await?;
        assert!(has_code(&r, "R_SIGNED_MSG") || has_code(&r, "R_RELAY_FEE"), "msg {bad}: {:?}", r.logs());
    }
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    // creator self-buy
    env.usdc
        .call("mint")
        .args_json(json!({ "account_id": env.creator.id(), "amount": (50 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    let r = env.commit_native(&env.creator, id, 30 * USDC, None).await;
    assert!(has_code(&r, "R_SELF_BUY"));
    assert_eq!(env.state(id).await["total_active"], "0");
    // after commit_end the window is closed
    env.advance_to(id, "Closing").await;
    assert!(has_code(&env.commit_native(&u, id, 30 * USDC, None).await, "R_WRONG_PHASE"));
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    Ok(())
}

#[tokio::test]
async fn fake_tokens_and_direct_callbacks_cannot_credit_anything() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("FAKE")).await?;
    let fake =
        env.worker.root_account()?.create_subaccount("fake").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let fake =
        fake.deploy(&std::fs::read(format!("{}/../target/near/mock_ft/mock_ft.wasm", env!("CARGO_MANIFEST_DIR")))?).await?.into_result()?;
    fake.call("new").args_json(json!({ "owner_id": env.owner.id(), "total_supply": "0" })).transact().await?.into_result()?;
    let attacker = env
        .worker
        .root_account()?
        .create_subaccount("attacker")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    fake.call("mint")
        .args_json(json!({ "account_id": attacker.id(), "amount": (500 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    env.owner
        .call(fake.id(), "storage_deposit")
        .args_json(json!({ "account_id": env.core.id() }))
        .deposit(NearToken::from_millinear(2))
        .transact()
        .await?
        .into_result()?;
    let r = attacker
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": env.core.id(), "amount": (50 * USDC).to_string(), "msg": msg(id, None, None) }))
        .deposit(ONE)
        .gas(GAS)
        .transact()
        .await?;
    assert!(r.is_success());
    assert!(has_code(&r, "R_UNEXPECTED_TOKEN"), "{:?}", r.logs());
    assert_eq!(env.state(id).await["total_active"], "0", "a different token must never credit a position");
    let direct = env.worker_call(&attacker, env.core.id(), "mt_on_transfer", json!({ "sender_id": attacker.id(), "previous_owner_ids": [attacker.id()], "token_ids": [format!("nep141:{}", env.usdc.id())], "amounts": ["30000000"], "msg": msg(id, None, None) })).await;
    assert!(has_code(&direct, "R_NOT_AUTHORIZED"));
    let cb = env
        .worker_call(
            &attacker,
            env.core.id(),
            "on_payout",
            json!({ "op": { "kind": "Stream", "launch_id": id.to_string(), "holder": null, "amount": "1" } }),
        )
        .await;
    assert!(cb.is_failure(), "private callbacks reject outside callers");
    Ok(())
}

#[tokio::test]
async fn create_trial_rejects_bad_params_deposit_duplicates_and_recovers_from_factory_failure() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let p = params("GOOD");
    let required: String = env.core.view("required_deposit").args_json(json!({ "params": p })).await?.json()?;
    let attempt = |p: TrialParams, dep: u128| {
        let (creator, core) = (env.creator.clone(), env.core.id().clone());
        async move {
            creator
                .call(&core, "create_trial")
                .args_json(json!({ "params": p, "stream_recipient": null }))
                .deposit(NearToken::from_yoctonear(dep))
                .gas(GAS)
                .transact()
                .await
                .unwrap()
        }
    };
    let req: u128 = required.parse()?;
    assert!(has_code(&attempt(p.clone(), req - 1).await, "R_DEPOSIT"));
    assert!(has_code(&attempt(TrialParams { soft_cap: 100 * USDC, ..p.clone() }, req).await, "R_SOFT_CAP"));
    assert!(has_code(&attempt(TrialParams { symbol: "good".into(), ..p.clone() }, req).await, "R_SYMBOL"));
    let mut greedy = p.clone();
    greedy.fees.total_fee_bps = 200;
    greedy.fees.creator_bps = 5_100; // 200 x 5,100 = 1,020,000 > 100 x 10,000: the creator would take more than 1.00% of volume
    assert!(has_code(&attempt(greedy, req).await, "R_CREATOR_TAKE"));
    assert!(
        has_code(&attempt(TrialParams { symbol: "KRUXA".into(), ..p.clone() }, req).await, "R_SYMBOL"),
        "brand symbol is reserved for the owner"
    );
    // factory failure: launch ends CreationFailed, symbol is freed, bond + factory deposit come back
    env.factory.call("set_fail").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let r = attempt(p.clone(), req).await;
    assert!(r.is_success());
    assert_eq!(env.state(1).await["status"], "CreationFailed");
    assert!(has_code(&r, "R_TOKEN_CREATE"), "{:?}", r.logs());
    let before = env.creator.view_account().await?.balance;
    env.call(&env.creator, "reclaim_bond", lid(1), ZERO).await.into_result()?;
    assert!(env.creator.view_account().await?.balance > before);
    env.factory.call("set_fail").args_json(json!({ "fail": false })).transact().await?.into_result()?;
    // a healthy launch reusing the freed symbol (launch id 1 was the failed one), then a second one from the same creator is refused
    env.next_id.set(2);
    let id = env.create_launch(&p).await?;
    assert_eq!(env.state(id).await["status"], "Open");
    assert!(has_code(&attempt(params("SECOND"), req).await, "R_ACTIVE_TRIAL"));
    Ok(())
}

#[tokio::test]
async fn pause_blocks_new_risk_but_not_exits_and_freeze_blocks_exits() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("PAUS")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    assert!(has_code(&env.call(&env.creator, "pause", json!({}), ZERO).await, "R_NOT_AUTHORIZED"));
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.commit_native(&u, id, 40 * USDC, None).await, "R_PAUSED"), "new commits are refused while paused");
    assert_eq!(env.usdc_balance(u.id()).await, 960 * USDC);
    env.call(&env.guardian, "freeze", json!({}), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&u, "walk", lid(id), ONE).await, "R_FROZEN"), "exits close only while frozen");
    assert!(has_code(&env.call(&env.guardian, "unpause", json!({}), ZERO).await, "R_NOT_AUTHORIZED"), "only the owner unpauses");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    env.call(&u, "walk", lid(id), ONE).await.into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC, "Walk works while paused");
    Ok(())
}

#[tokio::test]
async fn failed_refund_leg_recredits_and_a_retry_pays_exactly_once() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("RECR")).await?;
    let u = env.user("holder", 1_000 * USDC).await?;
    assert!(env.commit_native(&u, id, 40 * USDC, None).await.is_success());
    env.usdc.call("unregister").args_json(json!({ "account_id": u.id() })).transact().await?.into_result()?;
    let _ = env.call(&u, "walk", lid(id), ONE).await; // refund leg fails inside ft_transfer, callback re-credits
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) })).await;
    assert_eq!(
        (pos["due_native"].as_str(), pos["inflight"].as_str(), pos["conserved"].as_bool()),
        (Some("40000000"), Some("0"), Some(true))
    );
    assert_eq!(env.view("get_invariants", lid(id)).await["l1_ok"], true);
    env.register(&env.usdc, u.id()).await?;
    env.call(&env.creator, "claim_refund", json!({ "launch_id": id.to_string(), "holder": format!("near:{}", u.id()) }), ZERO)
        .await
        .into_result()?;
    assert_eq!(env.usdc_balance(u.id()).await, 1_000 * USDC);
    let again = env.call(&u, "claim_refund", json!({ "launch_id": id.to_string(), "holder": null }), ZERO).await;
    assert!(!again.json::<bool>()?);
    Ok(())
}

#[tokio::test]
async fn caps_global_launch_and_holder_limits_hold() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("CAPS");
    p.hard_cap = 500 * USDC; // max_total_held 1,000; max_holders min(500, ceil(2*500/20)) = 50
    let id = env.create_launch(&p).await?;
    env.call(&env.owner, "lower_global_cap", json!({ "value": (150 * USDC).to_string() }), ZERO).await.into_result()?;
    let (a, b) = (sol_holder(1), sol_holder(2));
    for h in [&a, &b] {
        env.fund_intents(&h.hex, 100 * USDC).await?;
    }
    assert!(env.commit_s3(&a, id, 100 * USDC, 0).await.is_success());
    let r = env.commit_s3(&b, id, 100 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_GLOBAL"), "{:?}", r.logs());
    assert_eq!(env.intents_balance(&b.hex).await, 100 * USDC, "rejected S3 commit refunds to the signer's Intents balance");
    env.call(&env.owner, "queue_global_cap", json!({ "value": (3_000 * USDC).to_string() }), ZERO).await.into_result()?;
    assert!(has_code(&env.call(&env.owner, "apply_global_cap", json!({}), ZERO).await, "R_NOT_YET"), "raising a cap is timelocked");
    Ok(())
}

#[tokio::test]
async fn launch_total_cap_stops_oversubscription_at_twice_the_hard_cap() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("LCAP");
    p.hard_cap = 500 * USDC; // max_total_held = 1,000
    let id = env.create_launch(&p).await?;
    for i in 0..10u8 {
        let h = sol_holder(100 + i);
        env.fund_intents(&h.hex, 100 * USDC).await?;
        assert!(env.commit_s3(&h, id, 100 * USDC, 0).await.is_success());
    }
    let late = sol_holder(120);
    env.fund_intents(&late.hex, 100 * USDC).await?;
    let r = env.commit_s3(&late, id, 100 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_LAUNCH"), "{:?}", r.logs());
    assert_eq!(env.state(id).await["total_active"], (1_000 * USDC).to_string());
    Ok(())
}

/// Slow (about 200 transactions): run with `cargo test -- --ignored`.
#[tokio::test]
#[ignore]
async fn holder_cap_is_enforced_before_the_launch_total() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let mut p = params("HCAP");
    p.commit_secs = 3_600; // the sandbox clock moves with every block; keep the window open for ~200 transactions
    let id = env.create_launch(&p).await?; // hard cap 1,000, min_buy 20 => max_holders 100, max_total_held 2,000
    for i in 0..100u8 {
        let h = sol_holder(i.wrapping_add(1));
        env.fund_intents(&h.hex, 20 * USDC).await?;
        assert!(env.commit_s3(&h, id, 20 * USDC, 0).await.is_success(), "holder {i}");
    }
    let extra = sol_holder(200);
    env.fund_intents(&extra.hex, 20 * USDC).await?;
    let r = env.commit_s3(&extra, id, 20 * USDC, 0).await;
    assert!(has_code(&r, "R_CAP_HOLDERS"), "{:?}", r.logs());
    Ok(())
}

#[tokio::test]
async fn a_pause_cannot_hold_the_verdict_hostage_but_it_does_hold_creator_payouts() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("HOLD")).await?;
    for i in 0..12u8 {
        let h = sol_holder(60 + i);
        env.fund_intents(&h.hex, 30 * USDC).await?;
        assert!(env.commit_s3(&h, id, 30 * USDC, 0).await.is_success());
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.guardian, "pause", json!({}), ZERO).await.into_result()?;
    let r = env.call(&env.creator, "settle", lid(id), ZERO).await;
    assert!(r.is_success() && r.json::<bool>()?, "settle is a pure function and still runs while paused");
    for (method, args) in
        [("settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 })), ("sweep_residue", lid(id))]
    {
        env.call(&env.creator, method, args, ZERO).await.into_result()?;
    }
    assert!(has_code(&env.call(&env.creator, "consolidate", lid(id), ZERO).await, "R_PAUSED"), "outbound proceeds wait while paused");
    env.call(&env.owner, "unpause", json!({}), ZERO).await.into_result()?;
    env.call(&env.creator, "consolidate", lid(id), ZERO).await.into_result()?;
    Ok(())
}
```

[VERIFIED] - 4 tests pass against the mock Verifier
```rust
// File: tests/tests/intents.rs
//! Solana-buyer paths against the mock Verifier: S3 (signed transfer with flat msg, primary), S4 (parse-and-forward fallback),
//! relay fee carve-out, Intents-custody refunds, consolidation, and walk_signed.
use kruxa_logic::TrialParams;
use kruxa_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ZERO: NearToken = NearToken::from_yoctonear(0);

fn params(symbol: &str) -> TrialParams {
    let mut p = TrialParams::example(symbol);
    p.commit_secs = 600;
    p.tail_secs = 60;
    p
}

fn lid(id: u64) -> serde_json::Value {
    json!({ "launch_id": id.to_string() })
}

#[tokio::test]
async fn s3_credits_net_of_relay_fee_and_rejects_by_refunding_the_signer() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SOLX")).await?;
    let h = sol_holder(7);
    env.fund_intents(&h.hex, 500 * USDC).await?;
    let ok = env.commit_s3(&h, id, 50 * USDC, 300_000).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
    assert_eq!((pos["open_intents"].as_str(), pos["contributed"].as_str()), (Some("49700000"), Some("49700000")));
    assert_eq!(env.intents_balance(&h.hex).await, 450 * USDC, "the signer paid exactly the signed amount");
    assert_eq!(env.view("get_ledger", lid(id)).await["relay_fee_total"], "300000");
    // relay fee above the cap, net below min_buy, wrong deliver key, and a hex signer delivering to NEAR are all refunded
    let other = sol_holder(8);
    for (amount, fee, deliver, code) in [
        (50 * USDC, 600_000u128, h.key(), "R_RELAY_FEE"),
        (20 * USDC, 400_000, h.key(), "R_MIN_CONTRIBUTION"),
        (50 * USDC, 0, other.key(), "R_DELIVER"),
        (50 * USDC, 0, "near:alice.near".to_string(), "R_DELIVER"),
    ] {
        let before = env.intents_balance(&h.hex).await;
        let r = env.s3_payload(&h.hex, id, amount, Some(msg(id, Some(&deliver), Some(fee)))).await;
        assert!(has_code(&r, code), "expected {code}: {:?}", r.logs());
        assert_eq!(env.intents_balance(&h.hex).await, before, "{code}: balance returns automatically");
    }
    // relay fees are paid out of core's Intents balance to the relay-fees account
    env.call(&env.creator, "pay_relay_fees", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.intents_balance(env.relay_fees.id().as_str()).await, 300_000);
    Ok(())
}

#[tokio::test]
async fn solana_walk_refunds_to_intents_and_walk_signed_checks_signature_nonce_and_deadline() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SWLK")).await?;
    let h = sol_holder(9);
    env.fund_intents(&h.hex, 100 * USDC).await?;
    assert!(env.commit_s3(&h, id, 60 * USDC, 0).await.is_success());
    let call = |nonce: u64, deadline: u64, sig: String| {
        let (a, core) = (env.creator.clone(), env.core.id().clone());
        let key = h.key();
        async move {
            a.call(&core, "walk_signed").args_json(json!({ "launch_id": id.to_string(), "holder": key, "nonce": nonce.to_string(), "deadline": deadline.to_string(), "signature": sig })).gas(GAS).transact().await.unwrap()
        }
    };
    let far = u64::MAX / 2;
    let preimage = |n: u64, d: u64| format!("kruxa:walk:v1|{}|{}|{}|{}|{}", env.core.id(), id, h.key(), n, d);
    assert!(has_code(&call(1, far, sol_holder(10).sign(&preimage(1, far))).await, "R_SIG"), "signature by another key");
    assert!(has_code(&call(1, 5, h.sign(&preimage(1, 5))).await, "R_DEADLINE"));
    assert!(has_code(&call(0, far, h.sign(&preimage(0, far))).await, "R_NONCE"));
    let ok = call(1, far, h.sign(&preimage(1, far))).await;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(env.intents_balance(&h.hex).await, 100 * USDC, "Walk refunds to the signer's own Intents account");
    assert!(has_code(&call(1, far, h.sign(&preimage(1, far))).await, "R_NONCE"), "replay is refused");
    Ok(())
}

#[tokio::test]
async fn s4_forwards_only_strictly_shaped_payloads() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("SFOR")).await?;
    let h = sol_holder(11);
    env.fund_intents(&h.hex, 200 * USDC).await?;
    let submit = |signed: serde_json::Value| {
        let (a, core) = (env.creator.clone(), env.core.id().clone());
        async move { a.call(&core, "contribute_via_intents").args_json(json!({ "signed": signed })).gas(GAS).transact().await.unwrap() }
    };
    let good = env.s4_signed(&h, id, 50 * USDC, 100_000);
    let mut wrong_signer = good.clone();
    wrong_signer["public_key"] = json!(format!("ed25519:{}", sol_holder(12).b58));
    let mut extra_msg: serde_json::Value = serde_json::from_str(good["payload"].as_str().unwrap())?;
    extra_msg["intents"][0]["msg"] = json!("sneaky");
    let mut with_msg = good.clone();
    with_msg["payload"] = json!(extra_msg.to_string());
    let mut other_standard = good.clone();
    other_standard["standard"] = json!("nep413");
    for (bad, why) in [
        (wrong_signer, "signer_id != hex(key)"),
        (with_msg, "unknown field msg"),
        (other_standard, "wrong standard"),
        (env.s4_signed(&h, id, 50 * USDC, 900_000), "fee above cap"),
    ] {
        let r = submit(bad).await;
        assert!(r.is_failure(), "{why} must be refused before anything is forwarded");
        assert_eq!(env.intents_balance(&h.hex).await, 200 * USDC, "{why}: nothing moved");
    }
    let r = submit(good).await;
    assert!(r.is_success(), "{:?}", r.failures());
    let pos = env.view("get_position", json!({ "launch_id": id.to_string(), "holder": h.key() })).await;
    assert_eq!(pos["open_intents"], "49900000");
    assert_eq!(env.intents_balance(&h.hex).await, 150 * USDC);
    Ok(())
}

#[tokio::test]
async fn pass_with_intents_buyers_consolidates_and_pays_the_stream() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let id = env.create_launch(&params("CONS")).await?;
    for i in 0..12u8 {
        let h = sol_holder(20 + i);
        env.fund_intents(&h.hex, 40 * USDC).await?;
        assert!(env.commit_s3(&h, id, 30 * USDC, 0).await.is_success());
    }
    env.advance_to(id, "Ready").await;
    env.call(&env.creator, "settle", lid(id), ZERO).await.into_result()?;
    env.call(&env.creator, "settle_positions_page", json!({ "launch_id": id.to_string(), "from_seq": 0, "limit": 25 }), ZERO)
        .await
        .into_result()?;
    env.call(&env.creator, "sweep_residue", lid(id), ZERO).await.into_result()?;
    assert!(
        has_code(&env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await, "R_NOTHING_FREE"),
        "fee cannot be paid before consolidation"
    );
    env.call(&env.creator, "consolidate", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.core.id()).await, 360 * USDC, "all settled Intents proceeds are now native");
    env.call(&env.creator, "pay_launch_fee", lid(id), ZERO).await.into_result()?;
    assert_eq!(env.usdc_balance(env.treasury.id()).await, 10 * USDC);
    let inv = env.view("get_invariants", lid(id)).await;
    assert_eq!((inv["l1_ok"].as_bool(), inv["l4_ok"].as_bool()), (Some(true), Some(true)));
    Ok(())
}
```

### Coverage map: rule code to the test that triggers it

| Code | Triggered by |
|---|---|
| R_SYMBOL, R_SOFT_CAP, R_DEPOSIT, R_ACTIVE_TRIAL | `create_trial_rejects_bad_params_deposit_duplicates_and_recovers_from_factory_failure`; the other validation codes (R_SUPPLY, R_BUCKETS, R_ALLOC, R_HARD_CAP, R_MIN_BUY, R_WALLET_CAP, R_FUNDERS, R_PASSABLE, R_WINDOW, R_STREAM) by `kruxa-logic::rules::tests::one_failing_case_per_code` |
| R_MIN_CONTRIBUTION, R_CAP_ACCOUNT, R_DELIVER, R_SIGNED_MSG, R_RELAY_FEE, R_SELF_BUY, R_WRONG_PHASE | `commits_that_break_a_rule_are_rejected_and_the_money_comes_back`, `s3_credits_net_of_relay_fee_and_rejects_by_refunding_the_signer` |
| R_CAP_GLOBAL, R_NOT_YET | `caps_global_launch_and_holder_limits_hold` |
| R_CAP_LAUNCH, R_CAP_HOLDERS | `launch_total_cap_stops_oversubscription_at_twice_the_hard_cap`, `holder_cap_is_enforced_before_the_launch_total` |
| R_NOT_AUTHORIZED | `fake_tokens_and_direct_callbacks_cannot_credit_anything`, `cancel_trial_makes_everyone_refundable_at_once`, `pause_blocks_new_risk_but_not_exits_and_freeze_blocks_exits` |
| R_PAUSED, R_FROZEN | `pause_blocks_new_risk_but_not_exits_and_freeze_blocks_exits`, `a_pause_cannot_hold_the_verdict_hostage_but_it_does_hold_creator_payouts` |
| R_TOO_EARLY, R_WALK_CLOSED, R_NO_POSITION | `pass_undersubscribed_full_money_path`, `walk_shrinks_the_book_refunds_and_closes_at_walk_end` |
| R_SIG, R_DEADLINE, R_NONCE | `solana_walk_refunds_to_intents_and_walk_signed_checks_signature_nonce_and_deadline` |
| R_NOTHING_FREE | `pass_with_intents_buyers_consolidates_and_pays_the_stream` |
| STREAM_CAP | `pass_undersubscribed_full_money_path` |
| callback re-credit | `failed_refund_leg_recredits_and_a_retry_pays_exactly_once` |
| R_UNEXPECTED_TOKEN, R_TOKEN_CREATE | `fake_tokens_and_direct_callbacks_cannot_credit_anything`, `create_trial_rejects_bad_params_deposit_duplicates_and_recovers_from_factory_failure` |
| R_CREATOR_TAKE (fee router, validated in Wave 1) | the same create test; every other fee code by `one_failing_case_per_code` |
| Codes that exist but no test triggers | R_TOO_LATE (cancel after `commit_end`), R_NOT_CLEAR (early `dissolve`, `sweep_residue`, `consolidate`), R_NOTHING (empty claim), R_NO_LAUNCH (unknown id), R_SOLVENCY (settle-time conservation guard, unreachable unless arithmetic is wrong), R_MATH (needs a u128 overflow the rule bounds exclude). All are one-line guards; listed so nobody counts them as exercised |

> **Sync 2026-11-10 (4.7).** The embedded suite is the 19-test Wave 1 suite. The repo now has 33 files under `tests/tests` (322 test attributes by grep, not a run result), including `real_intents.rs` (6 tests against the real hash-pinned `intents.near` wasm, which closes the "mock Verifier only" statements in 2.3 and W1-DC-8), the 100-attack gallery (81 refused with a rule code, 14 ran with no effect, 5 bounded, 0 failed, 10 not done; `docs/ATTACK-GALLERY.md`), and the negative-path tests for every reachable rule code of the final core surface.

## 4.8 Scripts and CI

### Code

[VERIFIED] - ran; produced the four wasm files
```bash
# File: scripts/build.sh
#!/usr/bin/env bash
# Builds every contract wasm with cargo-near (handles the wasm feature lowering that mainnet requires).
set -euo pipefail
cd "$(dirname "$0")/.."
for c in core mock-ft mock-intents mock-factory; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
ls -l target/near/*/*.wasm
```

[VERIFIED] - ran end to end 2026-11-07 (Section 17)
```bash
# File: scripts/test.sh
#!/usr/bin/env bash
# Pure unit and property tests first (milliseconds), then wasm builds, then the sandbox suite.
# Extra args go to the sandbox run, e.g. `scripts/test.sh --include-ignored` for the slow holder-cap test.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test -p kruxa-math -p kruxa-logic
./scripts/build.sh
cargo test -p kruxa-tests -- --test-threads=3 "$@"
```

[VERIFIED] - fmt and clippy parts ran clean; the 600,000-byte wasm gate is a budget set from the measured size (see below)
```bash
# File: scripts/lint.sh
#!/usr/bin/env bash
# fmt, clippy (contracts are checked for the wasm target because near-sdk 5.30 refuses native builds), wasm size gate.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fmt --all -- --check
cargo clippy -p kruxa-math -p kruxa-logic -p kruxa-sim --all-targets -- -D warnings
cargo clippy -p kruxa-core -p mock-ft -p mock-intents -p mock-factory --target wasm32-unknown-unknown -- -D warnings
MAX=600000
SIZE=$(wc -c < target/near/kruxa_core/kruxa_core.wasm)
if [ "$SIZE" -gt "$MAX" ]; then echo "kruxa_core.wasm is $SIZE bytes, budget $MAX"; exit 1; fi
echo "lint ok, kruxa_core.wasm $SIZE bytes (budget $MAX)"
```

[UNVERIFIED] - syntax-checked and dry-run printed; never executed; the `near` CLI argument grammar (near-cli-rs) is from memory and must be checked on first use
```bash
# File: scripts/testnet-deploy.sh
#!/usr/bin/env bash
# Prints the testnet deployment commands. Executes them only with --yes AND NEAR_ENV=testnet. Mainnet is refused outright:
# a mainnet deployment is a REQUIRES-DAMI-PER-ACTION-CONFIRMATION step and is never scripted.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${KRUXA_TESTNET_ROOT:?set KRUXA_TESTNET_ROOT, e.g. kruxa.testnet}"
OWNER="${KRUXA_OWNER:?set KRUXA_OWNER (testnet account that signs)}"
if [ "${NEAR_ENV:-}" = "mainnet" ] || [[ "$ROOT" != *.testnet ]]; then echo "refusing: testnet only"; exit 1; fi
CORE="core.$ROOT"; USDC="usdc.$ROOT"; INTENTS="intents.$ROOT"; FACTORY="factory.$ROOT"
INIT="{\"owner\":\"$OWNER\",\"guardian\":\"guardian.$ROOT\",\"treasury\":\"treasury.$ROOT\",\"relay_fees\":\"relay-fees.$ROOT\",\"usdc\":\"$USDC\",\"intents\":\"$INTENTS\",\"factory\":\"$FACTORY\",\"profile\":\"demo\"}"
CMDS=(
  "near account create-account fund-myself $CORE '40 NEAR' autogenerate-new-keypair save-to-keychain sign-as $OWNER network-config testnet sign-with-keychain send"
  "near contract deploy $CORE use-file target/near/kruxa_core/kruxa_core.wasm with-init-call new json-args '$INIT' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $USDC use-file target/near/mock_ft/mock_ft.wasm with-init-call new json-args '{\"owner_id\":\"$OWNER\",\"total_supply\":\"0\"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $INTENTS use-file target/near/mock_intents/mock_intents.wasm with-init-call new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
  "near contract deploy $FACTORY use-file target/near/mock_factory/mock_factory.wasm with-init-call new json-args '{}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send"
)
for c in "${CMDS[@]}"; do
  echo "$c"
  if [ "${1:-}" = "--yes" ] && [ "${NEAR_ENV:-}" = "testnet" ]; then bash -c "$c"; fi
done
[ "${1:-}" = "--yes" ] || echo "(dry run: pass --yes with NEAR_ENV=testnet to execute)"
```

[UNVERIFIED] - syntax-checked and dry-run printed; never executed; near-cli-rs argument grammar is from memory
```bash
# File: scripts/keeper.sh
#!/usr/bin/env bash
# Keeper (C15, scripts only in Wave 1): runs the permissionless methods for one launch in the only order that works.
# Prints the commands by default; executes only with --yes and NEAR_ENV=testnet. Mainnet is refused.
#   KRUXA_CORE=core.kruxa.testnet KRUXA_KEEPER=keeper.kruxa.testnet ./scripts/keeper.sh 1 [--yes]
set -euo pipefail
CORE="${KRUXA_CORE:?set KRUXA_CORE}"; SIGNER="${KRUXA_KEEPER:?set KRUXA_KEEPER}"; ID="${1:?launch id}"
if [ "${NEAR_ENV:-testnet}" = "mainnet" ] || [[ "$CORE" != *.testnet ]]; then echo "refusing: testnet only"; exit 1; fi
RUN=false; [ "${2:-}" = "--yes" ] && [ "${NEAR_ENV:-}" = "testnet" ] && RUN=true
call() { # method, json args
  local cmd="near contract call-function as-transaction $CORE $1 json-args '$2' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as $SIGNER network-config testnet sign-with-keychain send"
  echo "$cmd"; if $RUN; then bash -c "$cmd"; fi
}
unsettled() { near contract call-function as-read-only "$CORE" get_state json-args "{\"launch_id\":\"$ID\"}" network-config testnet now \
  | python3 -c 'import json,re,sys; print(json.loads(re.search(r"\{.*\}", sys.stdin.read(), re.S).group(0))["positions_unsettled"])'; }
call settle "{\"launch_id\":\"$ID\"}"
SEQ=0
while true; do
  call settle_positions_page "{\"launch_id\":\"$ID\",\"from_seq\":$SEQ,\"limit\":25}"
  SEQ=$((SEQ + 25))
  if ! $RUN || [ "$(unsettled)" = "0" ] || [ "$SEQ" -gt 600 ]; then break; fi
done
for m in sweep_residue consolidate pay_launch_fee pay_relay_fees; do call "$m" "{\"launch_id\":\"$ID\"}"; done
$RUN || echo "(dry run: pass --yes with NEAR_ENV=testnet to execute; later steps fail until earlier ones finish, which is expected)"
```

[UNVERIFIED] - not run on GitHub
```yaml
# File: .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@master
        with: { toolchain: "1.95.0", targets: wasm32-unknown-unknown, components: "rustfmt,clippy" }
      - uses: Swatinem/rust-cache@v2
      - run: cargo install cargo-near --version 0.23.0 --locked
      - run: ./scripts/build.sh
      - run: ./scripts/lint.sh
      - run: ./scripts/test.sh
  app:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

[VERIFIED] - run against this file; output diffed against the compiled workspace (Section 17)
```python
# File: scripts/extract_architecture.py
#!/usr/bin/env python3
"""Writes every file embedded in ARCHITECTURE.md to disk.

A code block is a file when its first line is `// File: <path>` or `# File: <path>`; that header line is not part of the
file and is stripped. Blocks whose path starts with "(" are diagrams or shell snippets and are skipped.

    python3 scripts/extract_architecture.py ARCHITECTURE.md ./kruxa-repo
"""
import pathlib
import re
import sys

HEADER = re.compile(r"^(?://|#) File: (\S.*?)\s*$")


def blocks(text):
    inside, buf = False, []
    for line in text.splitlines():
        if line.startswith("```"):
            if inside:
                yield buf
                buf = []
            inside = not inside
        elif inside:
            buf.append(line)


def main(doc, out):
    written = 0
    for b in blocks(pathlib.Path(doc).read_text()):
        m = HEADER.match(b[0]) if b else None
        if not m or m.group(1).startswith("("):
            continue
        dest = pathlib.Path(out) / m.group(1)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("\n".join(b[1:]) + "\n")
        if dest.suffix == ".sh":
            dest.chmod(0o755)
        written += 1
    print(f"wrote {written} files under {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
```

The wasm budget in S1-A was 350 KB; the measured `kruxa_core.wasm` is **456,999 bytes**, over it. The contract's own storage stake at 1e-5 NEAR per byte is therefore about 4.57 NEAR (locked, not spent). The main contributors are `serde_json::Value` views and `format!`-heavy error text. The gate is set to 600,000 bytes; shrinking the views to typed structs (Wave 1b) is the lever if the stake matters.

## 4.9 Next.js app (Wave 1 routes)

### Purpose
Four routes: landing `/`, create `/create`, launch page `/launch/[id]` (status, PASS margin, countdown, Commit, Walk, Settle, Claim), and `/demo` (offline boundary vectors, offline S1-B example 1, live recompute with a Tamper box). `lib/verdict.ts` mirrors the Rust logic and is pinned to it by test vectors. `lib/config.ts` refuses to start on mainnet without Dami's confirmation token. All wallet code is isolated in `lib/wallet.ts`.

### Code

[VERIFIED] - `npm install` resolved these exact versions; `next build` succeeded
```json
// File: app/package.json
{
  "name": "kruxa-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "WATCHPACK_POLLING=true next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@near-js/transactions": "2.5.1",
    "@near-wallet-selector/core": "10.1.4",
    "@near-wallet-selector/modal-ui": "10.1.4",
    "@near-wallet-selector/my-near-wallet": "10.1.4",
    "@noble/hashes": "2.2.0",
    "near-api-js": "7.4.0",
    "next": "16.4.5",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "@types/react": "19.3.0",
    "typescript": "5.9.3",
    "vitest": "5.1.0"
  }
}
```

[VERIFIED] - `tsc --noEmit` clean; the `jsx`, `allowJs` and `include` lines were rewritten by `next build` and are kept as written
```json
// File: app/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": [
      "dom",
      "dom.iterable",
      "es2022"
    ],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowJs": true
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

[VERIFIED] - `next build` succeeded
```js
// File: app/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

[VERIFIED] - `vitest run` passes
```ts
// File: app/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['lib/**/*.test.ts'] } });
```

[VERIFIED] - variable names are read by lib/config.ts
```bash
# File: app/.env.example
# Testnet defaults. Mainnet is refused unless NEXT_PUBLIC_MAINNET_CONFIRMED is set to the exact confirmation token below,
# which only Dami sets, per action. No other token or mint may exist on mainnet before the brand token.
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_NEAR_RPC=https://rpc.testnet.near.org
NEXT_PUBLIC_CORE_ACCOUNT=core.kruxa.testnet
NEXT_PUBLIC_USDC_ACCOUNT=usdc.kruxa.testnet
NEXT_PUBLIC_INTENTS_ACCOUNT=intents.kruxa.testnet
NEXT_PUBLIC_FACTORY_ACCOUNT=factory.kruxa.testnet
# NEXT_PUBLIC_MAINNET_CONFIRMED=DAMI-PER-ACTION-CONFIRMED
```

[VERIFIED] - typechecks; mainnet gate is code, not convention
```ts
// File: app/lib/config.ts
// Single place that reads configuration. Mainnet is refused without Dami's per-action confirmation token.
const env = (k: string, d = ''): string => (typeof process !== 'undefined' ? process.env[k] : undefined) ?? d;

export const NETWORK = env('NEXT_PUBLIC_NEAR_NETWORK', 'testnet');

if (NETWORK === 'mainnet' && env('NEXT_PUBLIC_MAINNET_CONFIRMED') !== 'DAMI-PER-ACTION-CONFIRMED') {
  throw new Error('R_MAINNET_GATE: mainnet needs Dami per-action confirmation; refusing to start');
}

export const CONFIG = {
  network: NETWORK,
  rpcUrl: env('NEXT_PUBLIC_NEAR_RPC', 'https://rpc.testnet.near.org'),
  core: env('NEXT_PUBLIC_CORE_ACCOUNT', 'core.kruxa.testnet'),
  usdc: env('NEXT_PUBLIC_USDC_ACCOUNT', 'usdc.kruxa.testnet'),
  intents: env('NEXT_PUBLIC_INTENTS_ACCOUNT', 'intents.kruxa.testnet'),
  factory: env('NEXT_PUBLIC_FACTORY_ACCOUNT', 'factory.kruxa.testnet'),
} as const;

export const USDC_DECIMALS = 6n;
export const fmtUsdc = (micro: string | bigint): string => {
  const n = BigInt(micro);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `$${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
};
```

[VERIFIED] - 3 vitest tests pass; pinned to the hashes printed by the Rust `kruxa-sim verdict`
```ts
// File: app/lib/verdict.ts
// TypeScript mirror of kruxa-logic (verdict, allocation, per-position settlement). Kept byte-identical by lib/verdict.test.ts,
// which pins the hashes printed by `kruxa-sim verdict`. The demo page uses this so a browser can re-derive the verdict with no trust in our UI.
import { sha256 } from '@noble/hashes/sha2.js';

export const BELOW_SOFT_CAP = 1;
export const BELOW_MIN_FUNDERS = 2;
export const CANCELLED = 4;

export interface VerdictInputs {
  launch_id: string;
  charter_hash: number[];
  total_active: string;
  active_funders: number;
  soft_cap: string;
  min_funders: number;
  cancelled: boolean;
}

export type Outcome = { pass: true } | { pass: false; reasons: number };

export function verdict(i: VerdictInputs): Outcome {
  let reasons = 0;
  if (i.cancelled) reasons |= CANCELLED;
  if (BigInt(i.total_active) < BigInt(i.soft_cap)) reasons |= BELOW_SOFT_CAP;
  if (i.active_funders < i.min_funders) reasons |= BELOW_MIN_FUNDERS;
  return reasons === 0 ? { pass: true } : { pass: false, reasons };
}

const le = (n: bigint, bytes: number): number[] => Array.from({ length: bytes }, (_, k) => Number((n >> BigInt(8 * k)) & 0xffn));

export function encodeInputs(i: VerdictInputs): Uint8Array {
  return Uint8Array.from([
    ...le(BigInt(i.launch_id), 8),
    ...i.charter_hash,
    ...le(BigInt(i.total_active), 16),
    ...le(BigInt(i.active_funders), 4),
    ...le(BigInt(i.soft_cap), 16),
    ...le(BigInt(i.min_funders), 4),
    i.cancelled ? 1 : 0,
  ]);
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const inputsHash = (i: VerdictInputs): string => toHex(sha256(encodeInputs(i)));

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export interface Rules {
  launchFeeBps: bigint;
  maxLaunchFeeBps: bigint;
  launchFeeMin: bigint;
  launchFeeMax: bigint;
}

export const LADDER: Rules = { launchFeeBps: 150n, maxLaunchFeeBps: 300n, launchFeeMin: 10_000_000n, launchFeeMax: 2_500_000_000n };

export function launchFee(accepted: bigint, r: Rules = LADDER): bigint {
  const rate = ceilDiv(accepted * r.launchFeeBps, 10_000n);
  const ceiling = (accepted * r.maxLaunchFeeBps) / 10_000n;
  const candidate = rate > r.launchFeeMin ? rate : r.launchFeeMin;
  return [r.launchFeeMax, ceiling, candidate].reduce((a, b) => (a < b ? a : b));
}

export interface Allocation {
  accepted: bigint;
  launchFee: bigint;
  lpQuote: bigint;
  stream: bigint;
  excessPool: bigint;
}

export function allocate(totalActive: bigint, hardCap: bigint, saleBps: bigint, lpBps: bigint, r: Rules = LADDER): Allocation {
  const accepted = totalActive < hardCap ? totalActive : hardCap;
  const fee = launchFee(accepted, r);
  const lpQuote = (accepted * lpBps) / saleBps;
  return { accepted, launchFee: fee, lpQuote, stream: accepted - fee - lpQuote, excessPool: totalActive - accepted };
}

export function settlePosition(commit: bigint, total: bigint, accepted: bigint, nSale: bigint, nBacker: bigint) {
  const spend = ceilDiv(commit * accepted, total);
  return { spend, refund: commit - spend, tokens: (commit * nSale) / total, bonus: (commit * nBacker) / total };
}
```

[VERIFIED] - passes
```ts
// File: app/lib/verdict.test.ts
import { describe, expect, it } from 'vitest';
import { allocate, inputsHash, settlePosition, verdict, type VerdictInputs } from './verdict';

const zero = Array<number>(32).fill(0);
const base: VerdictInputs = { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false };

describe('verdict mirrors kruxa-logic', () => {
  it('passes exactly at the boundary and fails one micro-USDC below', () => {
    expect(verdict(base)).toEqual({ pass: true });
    expect(verdict({ ...base, total_active: '349999999' })).toEqual({ pass: false, reasons: 1 });
  });

  it('pins the hashes printed by `kruxa-sim verdict` (Rust)', () => {
    expect(inputsHash(base)).toBe('c2bd1b3b11872b7f56eda70d71c367d068038a24688f5fe18a5ef2c86d600d29');
    expect(inputsHash({ ...base, total_active: '349999999' })).toBe('b43f5ec3bf27dd8c017f68db97a30adda6aab06224a6e74818cd90042f100dd6');
  });

  it('reproduces S1-B example 1 to the unit', () => {
    const a = allocate(12_500_000_000n, 5_000_000_000n, 6000n, 2500n);
    expect([a.launchFee, a.lpQuote, a.stream, a.excessPool]).toEqual([75_000_000n, 2_083_333_333n, 2_841_666_667n, 7_500_000_000n]);
    const p = settlePosition(100_000_000n, 12_500_000_000n, a.accepted, 600_000_000_000_000n, 50_000_000_000_000n);
    expect([p.spend, p.refund, p.tokens]).toEqual([40_000_000n, 60_000_000n, 4_800_000_000_000n]);
  });
});
```

[VERIFIED] - typechecks against near-api-js 7.4.0 (`JsonRpcProvider.callFunction`, same call shape as the signed-test kit); no live RPC call was made
```ts
// File: app/lib/near.ts
// Read-only access to the core contract. near-api-js 7.4.0: JsonRpcProvider.callFunction (same call shape as the signed-tests kit).
import { JsonRpcProvider } from 'near-api-js';
import { CONFIG } from './config';

const provider = new JsonRpcProvider({ url: CONFIG.rpcUrl });

export async function view<T = unknown>(method: string, args: Record<string, unknown> = {}, contractId: string = CONFIG.core): Promise<T> {
  return (await provider.callFunction<any>({ contractId, method, args })) as T;
}

export interface LaunchState {
  status: string;
  phase: 'Scheduled' | 'Open' | 'Closing' | 'Ready';
  token: string | null;
  total_active: string;
  active_funders: number;
  holder_count: number;
  positions_unsettled: number;
  charter_hash: string;
  book_hash: string;
}

export interface Charter {
  launch_id: string;
  creator: string;
  opens_at: string;
  commit_end: string;
  walk_end: string;
  params: Record<string, string | number>;
  derived: Record<string, string | number>;
}

export const getState = (id: string) => view<LaunchState | null>('get_state', { launch_id: id });
export const getCharter = (id: string) => view<Charter | null>('get_charter', { launch_id: id });
export const getSettlement = (id: string) => view<Record<string, unknown> | null>('get_settlement', { launch_id: id });
export const getVerdictInputs = (id: string, contractId?: string) => view<{ inputs: Record<string, unknown>; inputs_hash: string } | null>('get_verdict_inputs', { launch_id: id }, contractId);
export const getPosition = (id: string, holder: string) => view<Record<string, unknown> | null>('get_position', { launch_id: id, holder });
export const requiredDeposit = (params: Record<string, unknown>) => view<string>('required_deposit', { params });
```

[UNVERIFIED] - typechecks against wallet-selector 10.1.4; popup behaviour not exercised
```ts
// File: app/lib/wallet.ts
// Wallet adapter. The ONLY file that talks to a wallet, so a different wallet library is a one-file change.
// Types compile against @near-wallet-selector 10.1.4 (its Action is @near-js/transactions's Action; near-api-js 7.4.0 bundles an incompatible copy, so actions come from @near-js/transactions).
// [UNVERIFIED] runtime behaviour of the wallet popups must be exercised on testnet.
import { setupWalletSelector, type WalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { actionCreators } from '@near-js/transactions';
import { CONFIG } from './config';

const GAS = 300n * 10n ** 12n;
let selectorPromise: Promise<WalletSelector> | null = null;

export function selector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({ network: CONFIG.network as 'testnet' | 'mainnet', modules: [setupMyNearWallet()] });
  return selectorPromise;
}

export async function connect(): Promise<void> {
  const modal = setupModal(await selector(), { contractId: CONFIG.core });
  modal.show();
}

export async function accountId(): Promise<string | null> {
  const s = await selector();
  return s.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
}

async function call(receiverId: string, methodName: string, args: Record<string, unknown>, deposit: string) {
  const wallet = await (await selector()).wallet();
  return wallet.signAndSendTransaction({ receiverId, actions: [actionCreators.functionCall(methodName, args, GAS, BigInt(deposit))] });
}

export const createTrial = (params: Record<string, unknown>, depositYocto: string) => call(CONFIG.core, 'create_trial', { params, stream_recipient: null }, depositYocto);
export const walk = (launchId: string) => call(CONFIG.core, 'walk', { launch_id: launchId }, '1');
export const claimRefund = (launchId: string) => call(CONFIG.core, 'claim_refund', { launch_id: launchId, holder: null }, '0');
export const claimTokens = (launchId: string) => call(CONFIG.core, 'claim_tokens', { launch_id: launchId }, '1');
export const settle = (launchId: string) => call(CONFIG.core, 'settle', { launch_id: launchId }, '0');

/** Native path: USDC.ft_transfer_call(core, amount, msg). The message is the same JSON the contract parses. */
export const commit = (launchId: string, amountMicro: string) =>
  call(CONFIG.usdc, 'ft_transfer_call', { receiver_id: CONFIG.core, amount: amountMicro, msg: JSON.stringify({ v: 1, op: 'contribute', launch_id: launchId }) }, '1');
```

[UNVERIFIED] - `next build` succeeds; not opened in a browser
```tsx
// File: app/app/layout.tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'Kruxa', description: 'A token launch that is a refundable trial first. Verdict by rule, refunds by pull.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Kruxa</Link>
          <Link href="/create">Create a trial</Link>
          <Link href="/demo">Verify (no wallet)</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

[UNVERIFIED] - not viewed
```css
// File: app/app/globals.css
:root { --bg: #0b0d10; --fg: #e8eaed; --muted: #8b93a1; --line: #232830; --accent: #7cf0c9; --bad: #ff6b6b; --ok: #7cf0c9; }
@media (prefers-color-scheme: light) { :root { --bg: #fafaf8; --fg: #14171c; --muted: #5b6472; --line: #dfe2e6; --accent: #0a7d5a; --bad: #c0392b; --ok: #0a7d5a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 96px; }
nav { display: flex; gap: 16px; padding: 16px; border-bottom: 1px solid var(--line); }
nav a { color: var(--muted); text-decoration: none; } nav a:hover { color: var(--fg); }
h1 { font-size: 2rem; line-height: 1.15; margin: 0 0 8px; } h2 { font-size: 1.1rem; margin: 32px 0 8px; }
p, li { color: var(--muted); } code, pre { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background: color-mix(in srgb, var(--fg) 6%, transparent); padding: 12px; border-radius: 8px; overflow-x: auto; }
button, input, select { font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
button { cursor: pointer; border-color: var(--accent); color: var(--accent); } button:disabled { opacity: .4; cursor: not-allowed; }
label { display: block; margin: 12px 0 4px; color: var(--muted); font-size: 14px; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 16px 0; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; } .ok { color: var(--ok); } .bad { color: var(--bad); }
table { width: 100%; border-collapse: collapse; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
```

[UNVERIFIED] - `next build` succeeds; not opened in a browser
```tsx
// File: app/app/page.tsx
import Link from 'next/link';

export default function Landing() {
  return (
    <>
      <h1>A token launch that is a refundable trial first.</h1>
      <p>Buyers commit USDC. Until the trial ends every buyer can Walk: the principal is returned to the account it came from, and the platform takes no fee. A fixed rule then decides PASS or FAIL. Only on PASS do sale tokens exist for claiming and does the creator start drawing proceeds, capped at elapsed time times a fixed rate.</p>
      <div className="card">
        <b>Try it with no wallet and no funds</b>
        <p>Open the <Link href="/demo">verification page</Link>. It recomputes the verdict and the settlement arithmetic in your browser from the same rules the contract runs and prints MATCH or MISMATCH. The Tamper box flips one unit and must print MISMATCH.</p>
      </div>
      <h2>What runs where</h2>
      <ul>
        <li>NEAR contract: charter, hold ledger, Walk, verdict, refunds, claims. USDC only. Testnet and a labelled demo profile.</li>
        <li>NEAR Intents: Solana buyers pay through a signed transfer that notifies the contract (mt_on_transfer); refunds return to their Intents account.</li>
        <li>Capped ladder: $1,000 per launch, $3,000 global. Raising a cap is timelocked 7 days.</li>
      </ul>
      <h2>Honest limits</h2>
      <p>Single-party upgrade key while on testnet. The launch token comes from a factory whose code its owner can change; the README says so. No independent review yet. Nothing here is on mainnet.</p>
    </>
  );
}
```

[UNVERIFIED] - `next build` succeeds; not opened in a browser
```tsx
// File: app/app/create/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { fmtUsdc } from '@/lib/config';
import { requiredDeposit } from '@/lib/near';
import { connect, createTrial } from '@/lib/wallet';

const USDC = 1_000_000;
const defaults = { symbol: '', name: '', hardCap: 1000, softCap: 350, minBuy: 20, minFunders: 10, commitHours: 24, tailHours: 6, streamDays: 30 };

export default function Create() {
  const [f, setF] = useState(defaults);
  const [deposit, setDeposit] = useState<string>('');
  const [error, setError] = useState<string>('');
  const set = (k: keyof typeof defaults) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'symbol' || k === 'name' ? e.target.value : Number(e.target.value) });

  const params = {
    symbol: f.symbol.toUpperCase(), name: f.name, total_supply_whole: 1_000_000_000, sale_bps: 6000, lp_bps: 2500, creator_bps: 1000, backer_bps: 500,
    hard_cap: String(f.hardCap * USDC), soft_cap: String(f.softCap * USDC), min_buy: String(f.minBuy * USDC), wallet_bps: 200, min_funders: f.minFunders,
    open_delay_secs: 0, commit_secs: f.commitHours * 3600, tail_secs: f.tailHours * 3600, stream_days: f.streamDays,
  };

  useEffect(() => {
    if (!f.symbol || !f.name) return setDeposit('');
    requiredDeposit(params).then((d) => { setDeposit(d); setError(''); }).catch((e: Error) => { setDeposit(''); setError(e.message.split('\n')[0] ?? 'invalid'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(f)]);

  return (
    <>
      <h1>Create a trial</h1>
      <p>The contract validates every number. A rule violation is returned as a code, for example <code>R_SOFT_CAP</code>, before any wallet prompt.</p>
      <label>Ticker (2-12 of A-Z, 0-9)</label><input value={f.symbol} onChange={set('symbol')} />
      <label>Name</label><input value={f.name} onChange={set('name')} />
      <div className="row">
        {(['hardCap', 'softCap', 'minBuy', 'minFunders', 'commitHours', 'tailHours', 'streamDays'] as const).map((k) => (
          <div key={k}><label>{k}</label><input type="number" value={f[k]} onChange={set(k)} style={{ width: 120 }} /></div>
        ))}
      </div>
      <div className="card">
        {error ? <span className="bad">{error}</span> : deposit ? <>Creator deposit (refundable storage bond plus factory fee): <b>{(Number(BigInt(deposit) / 10n ** 21n) / 1000).toFixed(3)} NEAR</b> · hard cap {fmtUsdc(BigInt(params.hard_cap))}</> : 'Fill ticker and name to validate.'}
      </div>
      <div className="row">
        <button onClick={() => void connect()}>Connect wallet</button>
        <button disabled={!deposit} onClick={() => void createTrial(params, deposit)}>Create trial</button>
      </div>
    </>
  );
}
```

[UNVERIFIED] - `next build` succeeds; not opened in a browser
```tsx
// File: app/app/launch/[id]/page.tsx
'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fmtUsdc } from '@/lib/config';
import { getCharter, getState, type Charter, type LaunchState } from '@/lib/near';
import { claimRefund, claimTokens, commit, connect, settle, walk } from '@/lib/wallet';

const phaseHelp: Record<string, string> = {
  Scheduled: 'Not open yet.',
  Open: 'Commit and Walk are open.',
  Closing: 'Commits closed. Walk stays open until the end of the tail: the book can only shrink.',
  Ready: 'The book is frozen. Anyone can call settle.',
};

const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
};

export default function Trial() {
  const { id } = useParams<{ id: string }>();
  const [st, setSt] = useState<LaunchState | null>(null);
  const [ch, setCh] = useState<Charter | null>(null);
  const [amount, setAmount] = useState(30);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => { setSt(await getState(id)); setCh(await getCharter(id)); }, [id]);
  useEffect(() => { void refresh(); const a = setInterval(() => void refresh(), 5000); const b = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(a); clearInterval(b); }; }, [refresh]);

  if (!st || !ch) return <p>Loading launch {id}…</p>;
  const soft = BigInt(String(ch.params['soft_cap']));
  const total = BigInt(st.total_active);
  const marginUsd = total - soft;
  const minFunders = Number(ch.params['min_funders']);
  const target = st.phase === 'Open' ? ch.commit_end : st.phase === 'Closing' ? ch.walk_end : null;
  const msLeft = target ? Number(BigInt(target) / 1_000_000n) - now : 0;

  return (
    <>
      <h1>{String(ch.params['name'])} <small>({String(ch.params['symbol'])})</small></h1>
      <p>{st.status} · {st.phase}. {phaseHelp[st.phase]} {target ? `Next change in ${fmtDuration(msLeft)}.` : ''}</p>
      <div className="card">
        <table><tbody>
          <tr><td>Committed</td><td>{fmtUsdc(total)} of soft cap {fmtUsdc(soft)}</td></tr>
          <tr><td>PASS margin</td><td className={marginUsd >= 0n ? 'ok' : 'bad'}>{marginUsd >= 0n ? '+' : '-'}{fmtUsdc(marginUsd < 0n ? -marginUsd : marginUsd)} · {st.active_funders - minFunders >= 0 ? '+' : ''}{st.active_funders - minFunders} funders</td></tr>
          <tr><td>Book hash</td><td><code>{st.book_hash.slice(0, 16)}…</code></td></tr>
          <tr><td>Token</td><td>{st.token ?? 'created at open'}</td></tr>
        </tbody></table>
      </div>
      <div className="row"><button onClick={() => void connect()}>Connect wallet</button></div>
      <h2>Your actions</h2>
      <div className="row">
        <input type="number" min={20} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 100 }} />
        <button disabled={st.phase !== 'Open'} onClick={() => void commit(id, String(amount * 1_000_000))}>Commit USDC</button>
        <button disabled={st.phase !== 'Open' && st.phase !== 'Closing'} onClick={() => void walk(id)}>Walk (principal returned, no platform fee)</button>
        <button disabled={st.phase !== 'Ready' || st.status !== 'Open'} onClick={() => void settle(id)}>Settle</button>
        <button onClick={() => void claimRefund(id)}>Claim refund</button>
        <button disabled={st.status !== 'Passed'} onClick={() => void claimTokens(id)}>Claim tokens</button>
      </div>
      <p>Walk returns your principal to the NEAR or Intents account it came from; the platform takes no fee. Moving it from Intents on to a Solana wallet costs an Intents withdrawal fee (live quote shown before you sign). A relay fee, if you paid one, is not refunded. Check this launch on the <a href={`/demo?launch=${id}`}>verification page</a>.</p>
    </>
  );
}
```

[UNVERIFIED] - `next build` succeeds; not opened in a browser
```tsx
// File: app/app/demo/page.tsx
'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CONFIG } from '@/lib/config';
import { getSettlement, getVerdictInputs } from '@/lib/near';
import { allocate, inputsHash, settlePosition, verdict, type VerdictInputs } from '@/lib/verdict';

const zero = Array<number>(32).fill(0);
const golden: VerdictInputs[] = [
  { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false },
  { launch_id: '1', charter_hash: zero, total_active: '349999999', active_funders: 10, soft_cap: '350000000', min_funders: 10, cancelled: false },
  { launch_id: '1', charter_hash: zero, total_active: '350000000', active_funders: 9, soft_cap: '350000000', min_funders: 10, cancelled: false },
];
const label = (i: VerdictInputs) => { const o = verdict(i); return o.pass ? 'PASS' : `FAIL (reasons ${o.reasons})`; };

function Judge() {
  const q = useSearchParams();
  const [launch, setLaunch] = useState(q.get('launch') ?? '1');
  const [tamper, setTamper] = useState(false);
  const [out, setOut] = useState<string>('');
  const a = useMemo(() => allocate(12_500_000_000n, 5_000_000_000n, 6000n, 2500n), []);
  const p = useMemo(() => settlePosition(100_000_000n, 12_500_000_000n, a.accepted, 600_000_000_000_000n, 50_000_000_000_000n), [a]);

  async function recompute() {
    try {
      const [vi, st] = await Promise.all([getVerdictInputs(launch), getSettlement(launch)]);
      if (!vi || !st) return setOut('No such launch, or not settled yet.');
      const i = vi.inputs as unknown as VerdictInputs;
      const used = tamper ? { ...i, total_active: (BigInt(i.total_active) + 1n).toString() } : i;
      const h = inputsHash(used);
      const match = (verdict(used).pass === st['pass']) && h === st['inputs_hash'];
      setOut(`recomputed ${label(used)} hash ${h}\nstored     pass=${String(st['pass'])} hash ${String(st['inputs_hash'])}\n${match ? 'MATCH' : 'MISMATCH'}`);
    } catch (e) { setOut(`error: ${(e as Error).message}`); }
  }

  return (
    <>
      <h1>Verify without trusting us</h1>
      <p>Everything on this page is computed in your browser by a TypeScript port of the contract&apos;s pure functions. The port is pinned to the Rust output by tests.</p>
      <h2>1. Boundary vectors (offline)</h2>
      <table><tbody>{golden.map((g, k) => <tr key={k}><td>total {g.total_active}, funders {g.active_funders}</td><td>{label(g)}</td><td><code>{inputsHash(g).slice(0, 16)}…</code></td></tr>)}</tbody></table>
      <h2>2. Oversubscribed sale, S1-B example 1 (offline)</h2>
      <p>$12,500 committed against a $5,000 cap: accepted {String(a.accepted)}, fee {String(a.launchFee)}, LP {String(a.lpQuote)}, stream {String(a.stream)}, refund pool {String(a.excessPool)} (micro-USDC). A $100 buyer pays {String(p.spend)} and is refunded {String(p.refund)}.</p>
      <h2>3. A live launch on {CONFIG.network}</h2>
      <div className="row">
        <input value={launch} onChange={(e) => setLaunch(e.target.value)} style={{ width: 90 }} />
        <label style={{ margin: 0 }}><input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} style={{ marginRight: 6 }} />Tamper (+1 unit; must print MISMATCH)</label>
        <button onClick={() => void recompute()}>Recompute</button>
      </div>
      <pre>{out || 'Press Recompute.'}</pre>
    </>
  );
}

export default function DemoPage() {
  return <Suspense fallback={<p>Loading…</p>}><Judge /></Suspense>;
}
```

### Key Decisions
The demo page computes in the browser from the same rules; it needs no wallet and no funds, which is the "do X, see Y" path an AI judge can run. UI behaviour is the least-verified part of Wave 1 and is flagged as such; screenshots belong to the demo phase.


---

> **Sync 2026-11-10 (4.9).** The embedded Wave 1 app listed four routes including `/demo`. The built app has no `/demo` and no `/proof` (ruled: Kruxa is a real launchpad, not a judge showcase); the tamper toggle lives at `/launch/[id]/verify`. Routes today: `/` (Discover; `/launches` redirects to it), `/create`, `/launch/[id]`, `/launch/[id]/verify`, `/token/[id]`, `/portfolio`, `/creator`, `/charter`, `/docs/[slug]`, `/insights`, `/ops-log`, `/search`, `/settings`, `/status`, `/u/[account]`, `/legal/*`, plus `llms.txt` and `AGENTS.md`. `app/lib/config.ts` reads more variables than the 4.9 `.env.example` shows: `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_NEAR_RPC`, `NEXT_PUBLIC_CORE_ACCOUNT`, `NEXT_PUBLIC_MARKET_ACCOUNT`, `NEXT_PUBLIC_INSTANT_ACCOUNT`, `NEXT_PUBLIC_USDC_ACCOUNT`, `NEXT_PUBLIC_USDC_TOKEN_ID`, `NEXT_PUBLIC_INTENTS_ACCOUNT`, `NEXT_PUBLIC_FACTORY_ACCOUNT`, `NEXT_PUBLIC_KRUXA_API`, `NEXT_PUBLIC_RELAYER_URL`, `NEXT_PUBLIC_DEMO_CORE_ACCOUNT`, `NEXT_PUBLIC_DEMO_LAUNCHES`, `NEXT_PUBLIC_INSTANT_MODE`, `NEXT_PUBLIC_MAINNET_CONFIRMED` (the file is the source).

# Section 5: Later waves at interface level

> **Status of 5.1 to 5.5, 2026-11-10.** Everything in 5.1 to 5.5 except 5.4 (Verdict Rail) is now built; the sketches below are NOT the shipped ABI. Differences: (5.1) the shipped market is `docs/interfaces/MARKET-ABI.md` 1.1.2 (Market-lite M-A): the holder slice and the referral slice are redirected to LP until the Hold Vault and referral lots exist, `quote_buy` takes an optional `now_ns`, `solvency_report(token_id)` takes a token, terms ride on the USDC leg with `creator` and `mode`, and `open_market` returns `u8`, not `Promise`; Hold Vault, referral lots, ratchets and payees (M-B) are NOT built. (5.2) `commit_genesis` takes `g_pub: String` (hex) and `build_root_page` takes `Vec<(String, U64)>`, not byte arrays; `release_lp_seed` does not exist (R-46); `reopen_genesis` was added. (5.3) the Squads reserve and Jito distributor ran on devnet only. (5.5) the F0 policy gate is now contract code: `register_f0_message` plus `sign_genesis` (see 5.15); the sketch's "signs only if the message equals compile()" is enforced as "signs only a message whose sha256 equals the registered hash", and that the registered hash equals compile() is checked by verify C17, not by the contract.

Everything here is **design, not code**: types, method signatures, storage layout, data flow. The Rust blocks are valid declarations (traits and structs) but were **not compiled** (`UNVERIFIED-COMPILE`); their header path starts with `(interface, wave N)` so the extractor skips them. Nothing in this section is described as built. Each wave is tagged.

## 5.1 Wave 3: market contract (constant-product pool, fee router, Hold Vault)

CO-3 note: scope M-A of this section is pulled forward pre-freeze as Market-lite (5.8); the Hold Vault, referral lots and ratchets stay in Wave 3 proper (vision W6b).

### Purpose
After PASS the launch token trades against USDC in a pool owned by `market.kruxa.near` (RULING #13, S1-C). The pool is the fee router: creator, platform, holders, referral and LP slices are cut at swap time and paid by pull. Reserves are internal counters, custody is the market's USDC and token balances. The Hold Vault (RULING #14) is a module inside the same wasm: stake the launch token to earn the holder slice, instant unstake, 7-day claim gate.

### Handoff from core (new in Wave 3, replaces `release_lp_seed` for the full product)

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); S1-C 3.2 as amended by RECONCILED 2.1 and 6.C.
```rust
// File: (interface, wave 3) contracts/core/src/market_link.rs
pub trait OpenMarket {
    /// ANY, after settle + positions settled + sweep_residue + consolidate. Never called inside `settle`.
    /// Debit-first: lp_seed_due is moved to `lp_seed_inflight`; two ft_transfer_call legs (USDC LP seed, launch-token LP bucket)
    /// carry msgs `SeedQuote` and `OpenPoolToken{launch_id, market_terms}`; the callback re-credits on failure.
    fn open_market(&mut self, launch_id: near_sdk::json_types::U64) -> near_sdk::Promise;
}
pub struct MarketLink { pub opened: bool, pub market_terms_hash: Option<[u8; 32]>, pub opened_at: Option<u64> }
pub struct MarketTerms {
    pub fees: FeeTerms,               // LIVE values at open
    pub fee_vest_bps: u16, pub fee_vest_days: u16,
    pub payees: Vec<Payee>,           // <= 10, sums to 10_000, each with optional recovery account
    pub alloc_beneficiary: near_sdk::AccountId,
    pub covenant_module: Option<near_sdk::AccountId>,   // must be None in v1 (R_COVENANT)
    pub rules: Rules,                 // ceilings snapshot
    pub charter_hash: [u8; 32], pub orig_terms_hash: [u8; 32],
}
pub struct FeeTerms { pub total_fee_bps: u16, pub creator_bps: u16, pub platform_bps: u16, pub holders_bps: u16, pub lp_bps: u16, pub referral_bps: u16, pub opening_fee_start_bps: u16, pub opening_decay_minutes: u16 }
```

### Market state and methods

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); S1-C 2.5, 3.3, 3.4, 3.6 rebased to 6-decimal USDC per RECONCILED 6.C.
```rust
// File: (interface, wave 3) contracts/market/src/lib.rs
pub const FEE_DENOM_PPM: u128 = 1_000_000;
pub const MIN_TRADE_QUOTE: u128 = 1_000_000;        // $1, RECONCILED 3.3 (was 0.001 wNEAR); keeps ceil/floor dust small at 6 decimals
pub const MIN_CLAIM_QUOTE: u128 = 1_000_000;
pub const RESERVE_BOUND_Q: u128 = 1_000_000_000_000_000_000;   // 1e18 micro-USDC = 1e12 USDC; net*T <= 1e36 << U256
pub const HOLD_GATE_NS: u64 = 7 * 86_400 * 1_000_000_000;
pub const IDX_SCALE: u128 = 1_000_000_000_000_000_000_000_000;  // 1e24

pub struct Pool { pub launch_id: u64, pub token: AccountId, pub quote: AccountId /* usdc */, pub total_supply: u128, pub pass_at: u64,
                  pub opened_ns: u64, pub state: PoolState /* AwaitSeed | Open */, pub q: u128, pub t: u128,
                  pub terms: MarketTerms, pub pending: Option<(MarketTerms, u64)>, pub ledger: FeeLedger }
pub struct FeeLedger { pub fee_total: u128, pub acc_creator: u128, pub acc_platform: u128, pub acc_holders: u128, pub acc_referral: u128, pub acc_lp: u128,
                       pub paid_creator: u128, pub paid_platform: u128, pub red_holders: u128, pub red_referral: u128,
                       pub holder_index: u128 /* scaled by IDX_SCALE */, pub holder_carry: u128, pub ref_escrow: u128, pub ref_owed: u128,
                       pub epoch_cursor: u32, pub folded_unlocked: u128 }
pub struct VaultPosition { pub amount: u128, pub since_ns: u64, pub idx_snap: u128, pub pending: u128 }

pub trait Market {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>; // msgs: OpenPoolToken, SeedQuote, Buy{min_out,referrer}, Sell{min_out}, Stake
    fn unstake(&mut self, launch_id: U64, amount: U128) -> Promise;
    fn claim_holder_rewards(&mut self, launch_id: U64) -> Promise;                 // R_HOLD_GATE before 7 days of weighted age
    fn claim(&mut self, launch_id: U64) -> Promise;                                // creator epochs: immediate part + linear vest from epoch close
    fn withdraw_creator(&mut self, launch_id: U64) -> Promise;                     // per payee split, up to 10
    fn withdraw_platform(&mut self) -> Promise;
    fn settle_referral(&mut self, launch_id: U64, buyer: AccountId) -> Promise;
    fn lower_fee(&mut self, launch_id: U64, bps: u16);                             // down-only, 24 h activation delay (R_RATCHET)
    fn lengthen_fee_vest(&mut self, launch_id: U64, days: u16);
    fn quote_buy(&self, launch_id: U64, amount_in: U128) -> serde_json::Value;     // views: get_pool, quote_sell, creator_status, ledger_report, solvency_report
}
```

### Invariants and data flow
Per swap, asserted inline (S1-C 3.4): five fee slices plus dust sum to `fee_total`; `creator_slice * 10_000 <= q_leg * max_creator_take_bps + 10_000`; `k_after >= k_before`; custody delta equals the amount moved. Fee is always denominated in USDC (fee on input for buys, on the gross output leg for sells). The opening-fee surcharge (decaying from at most 10% to the base rate within 120 minutes) goes 100% to the LP slice. If staked supply is below `MIN_ELIGIBLE_BPS` of supply, the holder slice is redirected to LP.

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); sequence from RECONCILED 2.1.
```
# File: (diagram) wave 3 handoff sequence
settle (PASS, promise-free) -> settle_positions_page* -> sweep_residue -> consolidate -> pay_launch_fee
   -> open_market -> [core ft_transfer_call USDC lp_seed -> market: SeedQuote] + [core ft_transfer_call token n_lp -> market: OpenPoolToken]
   -> pool state AwaitSeed -> Open when both legs landed
buyer: USDC.ft_transfer_call(market, Buy{min_out}) -> fees cut -> reserves updated -> token ft_transfer to buyer
```

## 5.2 Wave 2: Solana genesis (F1), relayer and compiler

### Purpose
Only on PASS does the token exist on Solana (RULING in the winner brief). A one-shot ceremony creates a mint whose mint and freeze authorities are null, using a per-launch key G that is generated inside the host at the moment of `commit_genesis`, used for two transactions, and destroyed. NEAR commits the INTENT (`GenesisSpec`, hashed); a public deterministic compiler maps intent to transaction bytes given only a blockhash and a compute price, so a judge recomputes the bytes and compares (S1-D 2.4). The platform pays genesis rent and attestation rent from the launch fee (about 0.0263 SOL per genesis for budgeting, ~0.00266 SOL per attestation, reclaimable), never the buyers.

### Core additions (storage layout and methods)

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); RECONCILED 3.3 and 4 (rows `commit_genesis` .. `pause_genesis`), S1-D 2.
```rust
// File: (interface, wave 2) contracts/core/src/genesis.rs
pub struct GenesisPlan {                      // inside the Charter: static intent
    pub plan_version: u8, pub mode: GenesisMode /* F1 | F0 */, pub decimals: u8 /* 6 */,
    pub metadata_uri_sha256: [u8; 32], pub metadata_hash: [u8; 32],
    pub mint_authority_none: bool, pub freeze_authority_none: bool, pub extensions_allowed: bool, // R_GENESIS_AUTH: true, true, false
    pub lp_mirror_to_solana: bool,            // Genesis Round: true
    pub reserve_bps: u16,                     // 0 until the reserve split is decided (Section 3.2 item 3)
    pub reserve_custody: CustodyRef,          // { squads_multisig_hash, vault_index, disclosure: SinglePartyDemo | Independent2of3 }
    pub clawback_days: u16,                   // 90
}
pub struct GenesisState {                     // inside LaunchState, written at or after PASS
    pub status: GenesisStatus /* None | Committed | Confirmed | Aborted */, pub g_pub: Option<[u8; 32]>, pub mint_seed: String,
    pub mint_address: Option<[u8; 32]>, pub genesis_spec_hash: Option<[u8; 32]>, pub merkle_root: Option<[u8; 32]>, pub leaf_count: u32,
    pub max_total_claim: u64, pub sol_mint_supply: u64, pub tx_sigs: Vec<String>, pub slot: u64, pub ceremony_hash: Option<[u8; 32]>,
    pub attest_log: Vec<[u8; 32]>,
}
pub trait GenesisApi {
    /// RELAYER (genesis-relayer.kruxa.near, a function-call key limited to these three methods). Requires status Passed, all positions settled.
    /// The contract derives every field of GenesisSpec itself; the relayer's only free input is g_pub.
    fn commit_genesis(&mut self, launch_id: U64, g_pub: [u8; 32]);
    fn build_root_page(&mut self, launch_id: U64, leaves: Vec<([u8; 32], u64)>);  // ascending claimant pubkey; contract verifies each leaf against a Position and the order
    fn confirm_genesis(&mut self, launch_id: U64, mint: [u8; 32], sigs: Vec<String>, slot: u64, ceremony_hash: [u8; 32]);
    fn abort_genesis(&mut self, launch_id: U64, reason: String);                    // RELAYER or GUARD
    fn pause_genesis(&mut self);                                                    // GUARD
    fn solana_allocations_page(&self, launch_id: U64, from_seq: u32, limit: u32) -> serde_json::Value; // valid only after settle_positions_page
    fn attest_log_append(&mut self, launch_id: U64, attestation_hash: [u8; 32]);
}
```
Supply model (lock-mirror, RECONCILED 3.3): the NEAR FT is minted in full to core at `create_trial` (as in Wave 1). The Solana mint supply equals the sum of leaf amounts plus reserve plus LP mirror; the same amount stays permanently locked in core's balance. Invariant L7': `near_circulating + sol_mint_supply == total`.

### Genesis transactions (S1-D 2.5)

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); instruction list from S1-D 2.5, Jito encodings still UNVERIFIED until its devnet test T-G3.
```
# File: (diagram) genesis ceremony
tx1 create:  ComputeBudget limit(+price) | System CreateAccountWithSeed(G -> M, owner Tokenkeg, space 82)  [or Transfer+AllocateWithSeed+AssignWithSeed if M was pre-funded]
             | Token InitializeMint2(M, 6, mint_authority=G, freeze=None) | Metaplex CreateMetadataAccountV3(is_mutable=false)
             | ATA CreateIdempotent for RESERVE owner, DISTRIBUTOR, LP mirror owner, CLAWBACK receiver
tx2 seal:    ComputeBudget | Jito new_distributor(root, max_total_claim, max_num_nodes, start, end, clawback_ts) | Jito set_admin(NULL_ADMIN)
             | Token MintTo(M -> each bucket ATA) | Token SetAuthority(M, MintTokens, None)   <- last token-affecting instruction
M = createWithSeed(base=G_pub, seed=launch id, owner=Tokenkeg): no private key exists for M.
Allowlisted programs only: System, ComputeBudget, Tokenkeg, ATA, Metaplex Token Metadata, Jito distributor.
```
The relayer's trust boundary and its failure runbook are S1-D 5; the key is held memory-only for the demo and in AWS KMS for the capped beta (RULING #4). `verify.sh` C1-C30 (Python, bare container) plus C31-C34 shelling out to `kruxa-sim` for the NEAR-side recompute (RECONCILED row 35). The Python compiler is the reference; the TypeScript relayer must pass the same vectors.

## 5.3 Wave 2: Squads reserve and Jito distributor

Squads reserve vault: for the demo Dami holds all three keys on separate hardware wallets, disclosed in the Charter as `SinglePartyDemo`; threshold >= 2 and a 48 h time lock are kept even then (RULING R5). Before the capped beta the set becomes 2-of-3 with two named independents (`Independent2of3`); `verify` check C12 requires the on-chain member set to equal the Charter-published set. Jito distributor: the deployed immutable program (upgrade authority None), `set_admin(NULL_ADMIN)` in tx2, 90-day clawback to a Squads ATA whose policy returns unclaimed tokens to the community pool, never to the platform wallet. A Solana buyer pays a refundable claim-rent deposit (about 0.004 SOL) carved from the commit amount through the same mechanism as the relay fee (RECONCILED 6.D 4.5); it is never a platform cost. Merkle leaf layout `hashv([0], hashv([claimant, amount_unlocked u64 LE, amount_locked u64 LE]))` is **UNVERIFIED** until test T-D1 reads the deployed IDL.

Genesis Round (track G, DECISIONS 2026-11-07 YES, capped and labelled): the brand token on mainnet before Nov 14 under hard caps, trial / verdict / Walk / refunds / settle / Solana genesis only, trading on an EXTERNAL standard pool. LP seed USDC is released by `release_lp_seed(launch_id, to)` (OWNER, timelocked) [SYNC 2026-11-11: this method was never built; `open_market` replaced it] to a Dami-controlled multisig and leaves through an Intents withdrawal (OV15 contract-initiated payout is unproven). **Every mainnet step of this track is REQUIRES DAMI PER-ACTION CONFIRMATION**, and the first mainnet token must be the brand token.

## 5.4 Wave 4: Verdict Rail (SAS attestation)

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); S1-D 8.
```
# File: (diagram) verdict rail
SAS program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG   credential authority = platform Squads (2-of-3), authorized signer = ATTEST key (KMS)
schema launch_verdict v1: layout [12,12,0,12,13,3,0,3,0,10,10,1,0,13,12]
  fields: launch_id, near_contract, verdict(U8: 1 PASS), rules_version, genesis_spec_hash, near_block_height, mode, supply, decimals,
          authorities_null, no_extensions, reserve_bps, reserve_custody, merkle_root, verify_hint
attestation PDA = ("attestation", credential, schema, nonce = mint M); rent ~0.00266 SOL, reclaimable on close; expiry 0
reader: derive PDA from the mint alone, getAccountInfo, owner == SAS program, decode by layout, check signer in credential.authorized_signers
```
Disclosure (verbatim from S1-D 8.5): the attestation is signed by a platform-held standing key, not by the NEAR contract; it can create, mint, move or freeze nothing; it says "rules-verified on stated criteria", never "safe" or "audited". F1 is worded "no later action on the token; attestations are a separate disclosed key" (RULING #10). Every attestation hash is appended to `attest_log` on NEAR (`attest_log_append`), and `verify` flags attestations missing from that log.

## 5.5 Wave 4: F0 (Chain Signatures mint), only if the dust test passes

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); call shapes copied from the signed-test kit (`warroom/signed-tests/src/lib/mpc.ts`, `contract/src/lib.rs`), which is PREPARED, NOT RUN: secondary-sourced until step T1p executes.
```
# File: (diagram) f0 sign request
v1.signer.sign({ "request": { "payload_v2": { "Eddsa": "<hex of message bytes>" }, "path": "<derivation path>", "domain_id": 1 } })
     attached: 1 yoctoNEAR, gas 300 Tgas; domain 1 = Ed25519
child key = root + (sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<predecessor>,<path>") mod L) * G   (offline derivation, checked against the derived_public_key view in step T0)
policy gate (kit contract sign-gate-test): sha256(message) must equal a stored hash, else E_POLICY_MISMATCH; the callback stores the signature
```
F0 changes the claim from "no later Solana action" to "the NEAR contract signs only a message that equals compile(spec, blockhash, price)" (S1-D 6.5). It runs only after Dami's per-action go for the two signed tests (Intents test <= $1; F0 dust <= ~2 NEAR + 0.01 SOL, throwaway keys Claude generates, Dami funds them). No mint is created on mainnet by those tests (the genesis-shaped mint test T4 runs on devnet).

## 5.6 Wave 1b: gaps inside the core, with the exact design

> **Status 2026-11-10.** Built: `check_solvency` and `reconcile_intents` with the held counters (`solvency.rs`, 30 s rate limit, informational, see 5.15), in-claim token registration (`claim_tokens`, `token_claims.rs`), `burn_mode` with `Hold` as the default and `Burn` refused because the factory token has no `ft_burn`, creator allocation claim, `sweep_tokens`. Not built: typed views (the core still uses `serde_json::Value` views; the wasm is 675,007 bytes against the 700,000 byte budget, see 5.15).

| Item | Design | Why not in Wave 1 |
|---|---|---|
| `check_solvency` async anchor | `promise_and(usdc.ft_balance_of(core), intents.mt_balance_of(core, usdc_token_id))` then a callback comparing `usdc_balance >= native_liability` and `intents_balance >= intents_liability`, where `native_liability = sum over launches of (open_native + due_native + inflight_native + spent_native + consolidated - fee_paid - fee_inflight - stream_drawn - stream_inflight)` and `intents_liability = sum of (open_intents + due_intents + inflight_intents + spent_intents - consolidated - consolidating) + (relay_fee_total - relay_fee_paid)`; emits `solvency_report{ok}`. Needs two global counters (`held_native`, `held_intents`) so the sum is O(1) | every mutation site must maintain the counters; scheduled right after the Wave 1 gate |
| In-claim token registration | `claim_tokens` first calls `storage_balance_of`; registers (attaching the holder's deposit) only when absent, refunds the rest to the holder | extra callback; Wave 1 requires the claimant to register first |
| Typed views | replace `serde_json::Value` with typed structs to shrink the wasm and give the ABI (`--no-abi` today) | size, not correctness |
| `burn_mode` for dead tokens | `Burn | Sink(AccountId) | Hold` after probe V-6 | needs the testnet `ft_burn` check |
| `claim_refund_batch` | at most 25 holders per call, one callback per leg | cut first (RECONCILED) |

## 5.7 Wave 3: indexer, agent layer and keeper service (C13, C14, C15)

> **Status 2026-11-10.** Built: `services/indexer` folds the core, market and launcher events (EVENTS.md lists them) and replays the contract's rolling `book_hash`; the API reports `fold_ok` from that replay (the sketch below names it `fold_check`). Sources are neardata with an RPC block-scan fallback (`services/indexer/README.md`). `/llms.txt` and `AGENTS.md` are served by the app; there is no `/agents` route and no MCP server. The keeper is `scripts/keeper.sh` (one recorded run per launch in `evidence/testnet-core3/keeper-*.log`); a keeper service is not built.

[UNVERIFIED] - interface sketch, not compiled (UNVERIFIED-COMPILE); PRD 2.2 and ROUTE-ARCHITECTURE.
```rust
// File: (interface, wave 3) services/indexer/src/model.rs
/// Read model built from NEP-297 `EVENT_JSON` logs of core (standard "kruxa", version 1.0.0). Nothing here is authoritative:
/// the book hash fold is the check, a mismatch marks the read model stale.
pub struct LaunchRow { pub launch_id: u64, pub status: String, pub phase: String, pub total_active: u128, pub funders: u32, pub soft_cap: u128,
                       pub min_funders: u32, pub book_hash_stored: [u8; 32], pub book_hash_folded: [u8; 32], pub last_block: u64 }
pub trait Indexer {
    fn ingest_block(&mut self, block_height: u64, logs: Vec<(String /* receipt id */, String /* log line */)>);
    fn launches(&self, filter: Option<&str>) -> Vec<LaunchRow>;                  // /launches (Verdict Board)
    fn portfolio(&self, holder_key: &str) -> Vec<serde_json::Value>;             // /portfolio: positions, funds in motion, claims
    fn fold_check(&self, launch_id: u64) -> bool;                                // folded book hash equals the contract's stored one
}
```
The agent layer (`/api`, `/llms.txt`, `/agents`, MCP) is read-only JSON over the same views and the indexer; it holds no keys. The keeper service replaces `scripts/keeper.sh`: it calls only permissionless methods (`settle`, `settle_positions_page`, `sweep_residue`, `consolidate`, `pay_launch_fee`, `pay_relay_fees`), holds no role, and runs `check_solvency` once Wave 1b adds it. Hosting must outlive judging (through at least Nov 18).


## 5.8 CO-3: Market-lite, mainnet path and caps (interface level)

[UNVERIFIED] interface sketch, not compiled (UNVERIFIED-COMPILE). Pulls the 5.1 market forward under CHANGE-ORDER-3. Everything in 5.1 stays the interface; this section fixes scope, caps and the order of deployment.

Scope M-A (pre-freeze): pool per launch opened only by `open_market`; `Buy{min_out}` and `Sell{min_out}` with `min_out` mandatory; five-slice fee cut from the Charter snapshot; `FeeLedger`; creator slice claim to the payout recipient under the Charter fee-vest; `withdraw_platform`; LP slice accrues to the pool; pause; reserve caps; NEP-297 events. Scope M-B (later): Hold Vault (the holder slice is redirected to LP until it exists, per 5.1), referral lots (the referral slice returns to LP), `lower_*` ratchets, opening-fee surcharge above base, payees beyond one.

```
// File: (interface, co-3) contracts/market/src/caps.rs
pub struct MarketCaps { pub max_pool_reserve_q: u128, pub max_global_reserve_q: u128 }  // micro-USDC; DN-17 adopted as interim: $5,000 per pool = 5_000_000_000, $15,000 global = 15_000_000_000 (separate from the raise caps $1,000 / $3,000)
// A Buy that would take a pool's quote reserve or the global sum above the cap returns the funds and logs R_MARKET_CAP.
```

Deployment order: `core.kruxa.near` is deployed Nov 11 with the handoff already inside (5.13 D-3) and the market account in its config; `market.kruxa.near` is deployed Nov 12 behind the M-gate; `open_market` is called after settle. Because fee terms are snapshotted in the Charter (ADR-014), a launch opened before the market exists is safe. The NEAR pool LP is permanent inside the contract (D-20), so it needs no human timelock. The 48 h Squads timelock applies only to the Solana-side vault. **DN-14 RULED (R-46):** for round one `open_market` receives 100% of the LP seed (the whole USDC LP seed and the launch-token LP bucket go to Kruxa's NEAR pool); no part of the round-one seed is routed to Solana, so the 48 h timelock does not gate it. Pool and LP-seed amounts, and any later Solana share, remain OPEN (PRD O-14).

Events (NEP-297, standard `kruxa`, version 1.0.0, added by CO-3): `pool_opened`, `swap` (side, amount_in, amount_out, fee_total, five slices, reserves after), `creator_claimed`, `platform_withdrawn`, `market_paused`. The indexer (5.11) reads only these.

## 5.9 CO-3: fee router constants and payout recipient rules (interface level)

[UNVERIFIED] interface sketch, not compiled.
```
// File: (interface, co-3) crates/kruxa-logic/src/rules.rs  (the ONE place the split lives)
pub const FEE_SPLIT_DEFAULT: FeeSplit = FeeSplit { creator_bps: 5000, platform_bps: 1500, holders_bps: 1500, lp_bps: 1000, referral_bps: 1000 }; // DN-15 RULED 2026-11-08 (R-46): 50/15/15/10/10, PRD 4b.3. Equal to FeeTerms::standard() in 4.3.
// Bounds unchanged: creator <= 6000, platform >= 1500, holders 1000..=3000, lp >= 500, holders+lp >= 2000, referral <= 2000, sum == 10_000, fee*creator <= 1_000_000.
// Charter snapshots the values at create_trial; a later change of the default never touches an existing launch.
// Derived at a 1.00% fee: creator 0.50%, platform 0.15%; creator-controlled extraction bound 75%; Rules.platform_bps (fixed) = 1500 so R_PLATFORM_FIXED accepts the default.
```
Payout recipient: the Charter field `stream_recipient` (Section 4.4, already present, defaulting to the creator) is named the payout recipient in docs and views (`get_charter` gains an alias key `payout_recipient`, a view-only change). It is used by `draw` (existing), by `market.claim` (recipient is read from the Charter via the `open_market` handoff and stored in the pool) and by allocation claims. There is no mutation method in the submission build. The post-freeze flow (propose, 48 h, accept, cancel, lock) is a Wave 6b design: `propose_payout_change`, `accept_payout_change`, `cancel_payout_change`, `lock_payout_recipient`, one pending proposal per launch, effective for future draws only.

## 5.10 CO-3 and CO-5: Solana venue (Meteora primary; Raydium CPMM and Orca fallbacks) and the devnet spike (interface level)

[UNVERIFIED] interface sketch. Lives in `services/venue/` (TypeScript), called by the relayer through a CLI, so the relayer's files are not edited.
```
// File: (interface, co-3) services/venue/src/index.ts
export interface VenueSpikeResult { check: string; pass: boolean; evidence: string /* devnet signature or IDL excerpt */ }
export interface PoolProposal { kind: 'damm-v2'; baseMint: string; quoteMint: string; seedBase: bigint; seedQuote: bigint; lockLiquidity: true; ownerVault: string }
export function buildPoolProposal(p: PoolProposal): { instructions: string /* base64 tx for a Squads proposal */ };
```
Spike S-M (devnet only, time-boxed 0.6 agent-day, finished by Nov 10 midday, result in `spikes/meteora/RESULT.md`):
| Check | Pass | Fail consequence |
|---|---|---|
| DM-1 DAMM v2 pool for an external classic SPL mint with null authorities and no extensions, paired with devnet USDC | pool created, a swap executes | Solana pool dropped for round one |
| DM-2 permanent lock of the seed liquidity | lock instruction succeeds and the position reads as locked | no "locked" claim; use Raydium CPMM with burned LP (DN-22) |
| DM-3 locked position fees claimable by the Squads vault, AND by a position owned by a PDA (CO-5 addendum A) | claim succeeds for both owners | venue still usable; fee path documented as manual; Kruxa pays the creator slice itself from claimed fees |
| DM-4 protocol fee share on DAMM v2 read from config | number recorded | economics note only |
| DBC-1 external mint accepted | an instruction takes a pre-existing mint and a devnet simulation succeeds | DBC off |
| DBC-2 who may trigger migration (Jupiter-verified quote token, organic-score gate) | migration callable without Meteora or Jupiter approval | DBC off |
| DBC-3 fee-claimer rotation | rotation to the Squads vault succeeds on devnet | DBC off |
| DBC-4 protocol take 20% first | 20% confirmed and fixed (not partner-configurable) | recompute economics; DBC only if the net slice still funds the router (it cannot pay holders) |
DBC stays off unless all four DBC rows pass. DexScreener and GeckoTerminal indexing and Jupiter routing cannot be tested on devnet and stay [UNVERIFIED] until mainnet. Judging note: Solana work is not judged (Q-002); this is product work.

**Fallback tree (DN-22, adopted for planning; source `research_notes/Kruxa launchpad market layer fees/meteora_fallback.md`, CHANGE-ORDER-3 Addendum A).**
| Rank | Venue | Lock and fees | Cost and notes |
|---|---|---|---|
| Primary | Meteora DAMM v2 | permanent LP lock; locked liquidity still earns claimable fees | about 0.022 SOL per pool (secondhand); 21 audit reports; live on devnet and mainnet [VERIFIED program liveness] |
| First fallback | Raydium CPMM | Burn and Earn locker, claimable Fee Key NFT | about 0.19 SOL per pool [UNVERIFIED, secondhand]; audited; live on devnet |
| Second fallback | Orca Whirlpools | full-range lock only | no way found for our program to call the lock; only if both above fail |
| Rejected | own pool program | n/a | unaudited code on a real-money path; audit costs more than the $3,000 cap; indexers will not list an unknown program |
Switch triggers: (1) mint rejected, or no pool after about one day of debugging; (2) lock or fee claim fails; (3) pool not routable or listed within about 24 h of a tiny mainnet pool; (4) exploit, pause or breaking upgrade. Consequences Kruxa must design for: **DAMM v2 has no built-in platform/creator fee split** (partner-fee removed in 0.2.0), so Kruxa does the split itself, either as two locked positions with different owners or as one claimer plus a Kruxa payout leg (recommended: one Squads-vault claimer and a Kruxa payout, because it keeps one position); **anti-sniper is the decaying base-fee scheduler only** (the rate limiter is deprecated); **upgrade authorities of Meteora, Raydium and Orca are unverified** (disclosed in LIMITATIONS); **a PDA or Squads-vault-owned position claiming fees is untested** until DM-3 runs. Round one seeds the NEAR pool only (DN-14), so this tree governs the later Solana pool; the builder is deferred if DN-28 is ruled.

## 5.11 CO-3: indexer, candles and API (interface level)

> **Status 2026-11-10.** The endpoint outline below is superseded by `docs/interfaces/api.openapi.yaml` 1.3.0: `/api/health`, `/api/stats`, `/api/launches`, `/api/launch/{id}`, `/api/launch/{id}/custody`, `/api/launch/{id}/genesis`, `/api/token/{id}` with `/candles`, `/trades`, `/holders`, `/depth`, `/api/creator/{account}`, `/api/portfolio/{account}`, `/api/verify/{id}`, `/api/ops-log`, `/api/ops/status`, `/api/ops/upgrades`, `/api/ops/halts`, `/api/ops/force-resolves`, `/api/ops/solvency`, `/api/ops/owed`, `/api/stream`, and CSV exports. `GET /api/check` was CUT with the Launch Check (CO-6 E-2) and does not exist.

[UNVERIFIED] interface sketch. Extends 5.7 (`services/indexer`, `services/api`).
```
// File: (interface, co-3) services/api/openapi-outline
GET /api/launches?stage=live|passed|trading|failed&q=       -> LaunchRow[]
GET /api/launch/{id}                                        -> launch, charter, verdict inputs, margin
GET /api/token/{id}/candles?interval=1m|5m|1h|1d&from=&to= -> [{t,o,h,l,c,v}] (TradingView datafeed compatible)
GET /api/token/{id}/trades?limit=                           -> trades from `swap` events
GET /api/check?token=&chain=                                -> {verdict: allow|warn|block, reasons[]}
GET /api/export/launches.csv, /api/export/trades.csv        -> the open launch dataset (thesis by-product)
```
Ingest: `EventSource` with `neardata` (mainnet HTTP 200 after redirect on 2026-11-08 [VERIFIED]) and an RPC block scan fallback. Store: SQLite on one node. Nothing here is authoritative; the app degrades to direct RPC reads and baked snapshots if the service is down (durability tier 2 [RULED DN-16], kept up through Nov 25, minimum Nov 18; the verify path never depends on the indexer).

## 5.12 CO-3: new module interfaces (track modules and wallet layer)

[UNVERIFIED] interface sketches. Each owns its own directory (PLAN Part CO-3), touches no Wave 1 file, and reads core and market only through views and events.
| Module | Path | Interface | Notes |
|---|---|---|---|
| Launch Check and guard | `services/check/`, `guard/` | `check(token) -> {allow,warn,block,reasons}`; `guard.wrap(signer, policy)` refuses `block`, asks a human on `warn` | NEAR function-call keys cannot attach the 1 yoctoNEAR of `ft_transfer_call`, so the guard is a client-side policy gate |
| Backer agent and MCP | `agents/backer/`, `mcp/` | tools: list_launches, get_launch, get_check, run_verify (read-only MCP); `receipts.json`; detailed in 5.14 | commit and walk only on testnet, through the agent vault (5.14), never with a full-access key |
| Swarm simulator | `tools/swarm-sim/`, `swarm/` | `make swarm`, `RULES.md`; detailed in 5.14 | offline mode needs no network; testnet mode uses sub-accounts |
| Wallet layer | `app/lib/wallet/` | `WalletAdapter { chain: 'near'|'solana'; connect(); signAndSendTransaction(); signMessage() }` with chain-labelled sessions | near-connect for NEAR, wallet-standard for Solana, action gating, no connect on read |
| Survivor Pass (stretch) | `contracts/pass/` | NEP-171 non-transferable; `mint(launch_id, holder)` cross-checks core `get_position` and the PASS verdict | tier C |
| Thesis pack (conditional, tier B by CO-4) | `thesis/` | `make thesis`, `make thesis-live`; detailed in 5.14 | conditional on Dami's GCP project and JWT; dropped at Nov 10 12:00 UTC |
| Keeper business (stretch) | `keeper-biz/` | `policy.yaml`, ledger page | tier C |

## 5.13 CO-3: Wave 1 delta register (where existing code is touched or untouched)

Sections 4.1 to 4.9 (the embedded, compiled Wave 1 code) are NOT edited by CHANGE-ORDER-3; the document round trip in Section 17 still holds. The build applies the following additive patches when it works the planned Wave 2 core files, and the full Wave 1 suite (25 native, 19 sandbox, 3 app tests) is re-run as a regression gate (GR-1). [SYNC 2026-11-10: those were the Phase 0 counts; the repo now has 33 sandbox test files (322 test attributes by grep) and 381 app test cases (audit count, 2026-11-09)].
| Delta | What | Where | Why |
|---|---|---|---|
| D-1 | `Config.creator_gate` (owner-only until `open_beta`), rule code `R_CREATOR_GATE` in `create_trial`, one-way `open_beta` in `admin.rs` | `lifecycle.rs`, `admin.rs`, `kruxa-logic::rules` (new code only) | Without it any account could create a mainnet token before $KRUXA; the ruling was process-enforced only |
| D-2 | `payout_recipient` alias key in views | `views.rs` (view-only) | naming; no behaviour change |
| D-3 | `open_market` handoff and `lp_seed_inflight` accounting | new `market_link.rs`; one counter in the ledger identities | the planned 5.1 handoff, needed in the Nov 11 core wasm |
Untouched: verdict, allocation, settlement, Walk, refunds, claims, stream-lite, intake, S3 and S4 code, the pure crates' arithmetic, all test doubles.

---

**CO-5 addendum, delta D-4 (constants only).** DN-15 (50/15/15/10/10) cannot be accepted by the embedded rules as written, because `Rules::ladder()` fixes the platform share at 2_000 (`R_PLATFORM_FIXED`) and `FeeTerms::standard()` is 30/20/20/25/5. D-4 changes exactly two constant blocks inside 4.3 (`Rules::ladder().platform_bps` 2_000 to 1_500; `FeeTerms::standard()` to 5_000 / 1_500 / 1_500 / 1_000 / 1_000). No rule logic, bound, error code or test body changes. Re-check by hand [VERIFIED by reading, not compiled]: `one_failing_case_per_code` still triggers each fee code (platform 1_400 hits the floor, 2_100 hits the fixed check, holders 999, lp 3_001, referral 2_001, sum case, creator 6_001, creator take 200 x 5_100); the default preset passes every check (sum 10_000, creator take 100 x 5_000 = 500_000 <= 1_000_000). The recorded Section 17 run (wasm 456,999 bytes, sha256 `96020d95...`) predates D-4, so the wasm hash changes when D-4 is built; the build re-runs the full Wave 1 suite (25 native, 19 sandbox, 3 app tests) as GR-1 and records the new hash.

## 5.14 CO-4 and CO-5: track modules (interface level, folded by CHANGE-ORDER-5)

[UNVERIFIED] interface sketches, not compiled. Source of truth for behaviour and acceptance: CHANGE-ORDER-4 sections 3 to 11. None of these modules touches Wave 1 code or the core wasm (freeze Nov 10 EOD); the only core-adjacent change is a `verify.sh --scope open` flag (no wasm change).

| Module | Path | Language | What it owns | Acceptance command |
|---|---|---|---|---|
| agentkit (X1) | `agentkit/` | TypeScript, Node 24 | `policy.ts` (rule codes `P_BUDGET, P_PER_COMMIT, P_CHECK_NOT_ALLOW, P_VERIFY_NONZERO, P_STALE_CHECK, P_UNKNOWN_LAUNCH, P_MAX_OPEN`), `llm.ts` (modes `live`, `replay`, `scripted`; model `Qwen/Qwen3.8-27B` via NEAR AI Cloud, `x-no-aliasing: true`), `receipt.ts` (hash-chained, ed25519-signed receipts), `verify_receipts.ts`, `tee-attest.sh` | `npm test -w agentkit`; `make receipts-verify` prints `RECEIPTS OK n=<N> level=L1` |
| agent vault (X2) | `contracts/agent-vault/` | near-sdk-rs | state `owner, attestor, core, usdc, budget, spent, in_flight, per_commit_max, paused, allowed, receipt_pubkey`; agent methods `commit`, `walk` (the contract attaches the 1 yoctoNEAR a function-call key cannot); attestor `allow_launch`, `revoke_launch`; owner `pause`, `unpause`, `set_limits`, `owner_withdraw`, `rotate_agent_key`; codes `V_NOT_AGENT, V_PAUSED, V_LAUNCH_NOT_ALLOWED, V_ALLOW_EXPIRED, V_PER_COMMIT, V_BUDGET, V_NOT_OWNER, V_NOT_ATTESTOR, V_BAD_CORE`; events NEP-297 `kruxa-vault` 1.0.0. No method sends funds to any account but the owner; none changes core or usdc after `new` | `cargo test -p kruxa-tests --test vault` (one test per code plus `commit_then_walk_refunds_to_vault`). Testnet only; unreviewed |
| Launch Check and guard | `services/check/`, `guard/` | TypeScript | `GET /api/check?launch_id=&network=` returns `{decision, reasons[], verify_exit, charter_hash, checked_at}` from signals S1 to S10; guard refuses `block`, asks a human on `warn`; the Check service key is the vault attestor | `make guard-demo` prints `BLOCKED launch=<id> reasons=[...]` |
| Attack gallery and injection harness | `attacks/` | TypeScript | 13 scripted attacks A1 to A13 with rule code and tx hash [SYNC 2026-11-10: built as a 100-attack gallery with ids A, G, C, M and I in `evidence/attack-gallery/`; 81 refused with a rule code, 14 ran with no effect, 5 bounded, 0 failed, 10 not done; sandbox hashes only; `docs/ATTACK-GALLERY.md`]; 12 injection payloads, N=20 live runs, replayable; page `/security` | `make attack-gallery` prints `GALLERY 13/13 blocked or bounded`; `make inject-report` |
| Swarm simulator | `tools/swarm-sim/`, `swarm/` | Rust (reads `kruxa-math`, `kruxa-logic`; no duplicate arithmetic), TypeScript for recording and testnet | 20 agents (7 scripted, 4 model-driven, 9 adversaries), 24 rounds, invariants L1, L3, L4, I2, I5 plus caps asserted every round; `RULES.md` written first; page `/swarm` | `make swarm` prints 24 `INV OK` lines and `SWARM GREEN rounds=24 invariants=24/24` |
| Market simulation and mechanics | `tools/market-sim`, `app/components/market/MechanicsPanel` | Rust, TypeScript | supply and unlock, opening-fee curve, epoch table, `BOUND OK creator_controlled <= 80% of fee` | `make sim` prints three tables, `BOUND OK`, `SIM sha256` |
| Intents funds strip | `app/components/FundsStrip`, `scripts/intents-status.sh` | TypeScript | renders all seven 1Click statuses from fixtures and the real Test 1 statuses; page `/proof` | `make market-demo` prints `SLICES OK` |
| Tour and consumer example | `scripts/tour.sh`, `examples/verdict-consumer/` | shell, near-sdk-rs | seven-scene offline tour; 40-line contract reading `get_settlement` | `make tour` ends `TOUR GREEN` |
| Thesis pack (conditional) | `thesis/` | Python (uv), SQL | `queries/*.sql` (always filtered by `block_date`), `pull_bq.py`, `pull_explorer.py`, committed CSV snapshots, `build.py`, `dashboard.html`, `THESIS.md` with an evidence-against section | `make thesis` prints a sha256 per chart and `THESIS BUILD OK` |

Separation of duties (the spine): the model proposes; a deterministic policy engine decides in code; the independent Launch Check plus `verify.sh --scope open` is the only party that can allow a launch on the vault; the vault enforces budget and recipient on chain; the human owner holds funds and limits. A hijacked or prompt-injected model can at worst propose; it cannot pay anyone. Claim levels for model evidence: L0 decision recorded; L1 response signature verified against a recorded attestation signer; L2 TDX quote verified with a DCAP verifier plus nonce and signer binding (the README states the level actually reached, never higher). Every model-driven step has an offline replay path (`--mode replay`, labelled RECORDED, never LIVE). New routes are in ROUTE-ARCHITECTURE.

Credentials these modules need (names only, values never in the repo): `NEARAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `BQ_PROJECT`, `ONECLICK_JWT` (see `.env.example`).

## 5.15 Final core surface, 2026-11-10

**Date:** 2026-11-10 | **Status:** Current (supersedes the Wave 1b and Wave 2 sketches in 5.1, 5.2, 5.5 and 5.6 wherever they differ; numbered 5.15 because 5.14 is the CO-4 and CO-5 track-modules section). The method-by-method reference is `docs/interfaces/CORE-ABI.md`; events are in `docs/interfaces/EVENTS.md`.

### Purpose
The core that ships is the Wave 1 trial lifecycle plus the surface Dami ruled "all built" in the sixteenth block of DECISIONS-PACK1 (2026-11-09) and the 700 KB wasm budget of the seventeenth block (2026-11-10). This section records what that surface is, what it does and does not guarantee, and which statements elsewhere in this document it corrects.

### Deployed state (testnet only, play money)
| Item | Value | Proof |
|---|---|---|
| Core account | `core3.kxi-root-1108.testnet` (profile `demo`, short clock) and `core4.kxi-root-1108.testnet` (fresh deploy for SW-2) | `evidence/testnet-core3/deploy.json`, `evidence/swarm-testnet/deploy.json` |
| Core wasm | sha256 `c55bffdbdec7909464c65511219ec77be7d8f765bc037a46350efe713cb8b13b`, 655,376 bytes, reproducible container build from commit `5c2874d` (includes the dissolve-after-walk fix), deployed on core7 (tx `y6hSbC7rdmYo3tYjpWoqDaUuJwmfXx2d22ukEYoCSC5`); `verify.sh` CODE line MATCH. core3 to core6 run the previous build `665caab5...` (655,387 bytes; round 4 tx `Gu5Msp6rduKg6XZ8RFNbMeT6s2aKM2Tcvmp7GNTgWvza`). A local `cargo near` build of the same source is about 675,000 bytes (step B1 of `make judge`) | `artifacts/SHA256SUMS`, `evidence/testnet-core7/`, `evidence/testnet-core3/verify-10-f0.txt` (old hash) |
| Size budget | 700,000 bytes (`scripts/lint.sh`, Dami, 2026-11-10); supersedes D-13 (570 KB) | DECISIONS-PACK1 seventeenth block |
| Earlier reproducible candidate | `d362ffa2...`, 655,251 bytes, built before the R_GAS change; superseded by `665caab5...` | `artifacts/SHA256SUMS.reproducible`, `rehearsal/LOG.md` A-4, R2-5 and R3-6 |
| Market | `market3.kxi-root-1108.testnet`, market ABI 1.1.2 | `evidence/testnet-core3/deploy.json` |
| Mainnet | nothing deployed | none |

### Components (new since Wave 1)
| Component | Location | Responsibility | Depends on |
|---|---|---|---|
| Genesis F0 gate | `genesis.rs` (`register_f0_message`, `sign_genesis`, `reopen_genesis`) | the relayer registers the sha256 of each genesis transaction message; the contract asks the MPC signer to sign only a message with that hash, once, on the path `kruxa:genesis:<id>` | MPC signer `v1.signer-prod.testnet`, relayer |
| Solvency anchor | `solvency.rs` (`check_solvency`, `reconcile_intents`, `solvency_report`) | held counters maintained at `save_state`; async balance read against USDC and Intents; `intents_alert` | USDC, `intents.near` |
| Token custody | `token_claims.rs` (`claim_creator_alloc`, `sweep_tokens`, `set_burn_mode`, in-claim registration) | creator allocation (cliff then linear), unclaimed-supply sweep to `burn_mode` | launch token (NEP-141 and NEP-145) |
| Governance | `govern.rs` (`queue_upgrade`, `cancel_upgrade`, `upgrade_core`, `migrate`, `halt_launch`, `resume_launch`, `force_resolve_op`, `withdraw_owed`) | public timelocked upgrade, per-launch halt, two-step stuck-leg resolution, owed NEAR | owner, guardian |
| Refund conveniences | `refunds.rs` (`claim_refund_batch`, `set_refund_route`) | keeper batch of up to 25, holder route to an Intents account | USDC, `intents.near` |
| Stream | `stream.rs` (`lengthen_stream`) | creator can only slow the stream | none |
| Orphan credit | `s4.rs` (`claim_orphan_credit`) | credits an Intents deposit that arrived with no credit | `intents.near` |

### Data flow: F0 genesis through the gate
1. Settle returns PASS; the relayer calls `commit_genesis` and `build_root_page` (Merkle root complete).
2. The relayer compiles the two Solana transactions from the committed spec, a blockhash and a price, and calls `register_f0_message(launch_id, i, sha256(message))` for i = 0 and 1. Each registration is an event anyone can recompute.
3. The relayer calls `sign_genesis(launch_id, i, message_hex)`. The contract checks `sha256(message)` equals the registered hash, marks the slot spent, and forwards the request to the MPC signer with the fixed path and domain 1 (Ed25519).
4. The relayer submits both transactions to Solana, then calls `confirm_genesis`. A failure before confirm: `abort_genesis`, then the OWNER calls `reopen_genesis` for a fresh attempt (the guardian cannot reopen).
5. `verify.sh` check C17 compares the on-chain transaction bytes with `compile(spec, blockhash, price)`. The contract gate cannot prove that equality; C17 can.

### Key decisions
| Decision | Chosen | Rejected | Rationale |
|---|---|---|---|
| F0 policy gate | in the contract (register then sign) | relayer-only check; reword the claim | Dami ruled "all built"; the gate stops the relayer signing anything it did not register in public |
| Solvency | informational report; can pause only NEW Intents commits | block all flows on a shortfall | a timing artefact must never trap exits (R-02) |
| Counters | updated at the single write choke point `save_state` | per-mutation-site arithmetic | one place to get right; `get_invariants` L6 compares counters with a recomputation |
| `burn_mode` | `Hold` default, `Sink` allowed (not a Kruxa-controlled account), `Burn` refused | `Burn` by default | the factory token has no `ft_burn` (`evidence/factory-probe.txt`) |
| Upgrade | 7-day public queue, guardian can cancel | immediate owner deploy | public notice; but the full-access key still bypasses it (see ARCHITECTURE 10) |
| `halt_launch` | stops new commits and creator-side payouts of one launch; exits stay open | a halt that blocks refunds | a halt may only turn a launch toward FAIL, never trap money |
| `force_resolve_op` | owner, two steps, 48 h apart, only what is in flight, token legs excluded | any owner payout | it cannot move money to a new destination or touch a verdict |
| `create_trial` gas | refuse under 250 Tgas (`R_GAS`); attach 300 | document 150 Tgas | at 150 the creation callback starved and a launch stuck in `Creating` (rehearsal/ROUND2.md finding 1) |
| `create_token` gas | 110 Tgas | 80 | the real factory fails at 80 and needs 91 to 95 (`evidence/testnet-core3/real-factory-probe.json`) |
| Wasm budget | 700,000 bytes | shrink to 570 KB | shrinking saved about 400 bytes; the build is already `opt-level z` with LTO |
| Solana claim rent | the relay fee covers it (`get_token_custody.solana_claim_rent = relay_fee_covers`) | buyer-funded 0.004 SOL deposit | not implemented; decided and disclosed |

### State layout and `migrate`
`Contract` gained `x: Extra`; `Config` gained `burn_mode` and `burn_mode_locked`; `LaunchState` gained `halted`; the solvency counters use the raw keys `kruxa:held` and `kruxa:last_check`. State from core2 is not readable by this wasm, so core3 is a fresh `new` deploy. `migrate` is the identity (`#[init(ignore_state)]`, reads the state back); a layout change needs its own `migrate`. The two redeploys over core3 kept the layout. A migration from core2 was not attempted [UNVERIFIED].

### Limits that remain (honest)
- The owner holds one full-access key on the testnet core (verify KEYS line), so the upgrade queue is a public commitment, not a barrier. On the `demo` profile (core3) the queue delay is 60 s and the force-resolve delay is 60 s, not 7 days and 48 hours.
- The solvency report is a reading, not a proof of solvency, and its two reads can race a refund or a consolidation.
- The F0 gate binds the signature to a registered hash; only verify C17 ties that hash to the compiled transaction.
- The core is not independently audited. Mainnet is not deployed.
- The deployed core3 wasm is a local build whose hash differs from the reproducible candidate; the candidate was built before the `R_GAS` guard and would need a rebuild and a redeploy to become the deployed binary.

### Register of statements corrected by the 2026-11-10 sync
1. 1.2, 2.1, 4.7, 5.13: sandbox test counts (19, 25, 34) are the Phase 0 and Phase 1 figures; now 33 files, 322 test attributes by grep.
2. 2.1: market, venue, indexer, API, relayer, Squads are BUILT, not planned; `services/check` and `agents/backer` do not exist; `tools/sas` is not built.
3. 2.3 and W1-DC-8: the real hash-pinned `intents.near` wasm runs in `tests/tests/real_intents.rs` (6 tests).
4. 3.3 W1-DC-4: `get_invariants` returns l1, l3, l4, l6, i2, i3, i4, i5 and l7 (the I2 to I5 fields are built).
5. Section 3 row 9: `claim_tokens` registers the holder in the claim; default stream is 30 days in Studio.
6. 4.4: the public-method list is the Wave 1 list; added methods are in CORE-ABI.md.
7. 4.6: exit 65 on `validate`; C1 to C34 coverage; skipped checks named; CODE line needs `build-artifacts.sh --local` after a redeploy.
8. 4.9, 17: no `/demo`, no `/proof`; routes and env variables listed in the 4.9 sync note.
9. 5.1: shipped market differs from the sketch (holder and referral to LP, optional `now_ns`, `solvency_report(token_id)`, `open_market -> u8`).
10. 5.2: `commit_genesis` and `build_root_page` take hex strings; `release_lp_seed` does not exist.
11. 5.5: the F0 gate is contract code (register then sign); C17 ties the hash to the compiled bytes.
12. 5.6: solvency anchor, in-claim registration, `burn_mode` are built; typed views are not.
13. 5.7 and 5.11: `fold_ok` is computed by replaying the book hash; neardata plus an RPC fallback; no `/agents`, no MCP, no `/api/check`; `llms.txt` and `AGENTS.md` exist; endpoint list in OpenAPI 1.3.0.
14. 5.14 and 8: the attack gallery is 100 attacks (81 refused, 14 no effect, 5 bounded, 0 failed), not 13.
15. 10 item 2: the upgrade queue exists but the full-access key bypasses it.
16. 11.3: `claim_tokens` payable (0.00125 NEAR + 1 yocto, 150 to 200 Tgas); `create_trial` 300 Tgas with a 250 floor; `create_token` 110 Tgas.
17. 11.4: the app reads more environment variables than the short list.
18. Wasm size: 456,999 and 462,222 bytes (4.8, 17) and the 570 KB acceptance (D-13) are history; the deployed core is 655,387 bytes (reproducible build; 675,007 as a local build) against a 700,000 byte budget.
19. 17c: Phase 0 hashes are history; the final hash is in the Deployed state table above.

# Section 6: Domain Knowledge File spec

**File type:** non-agent project, so `DOMAIN-GUIDE.md` (build generates it from this section). **Rules** it must carry: money is micro-USDC (6 decimals) everywhere; times are u64 ns; charged amounts round up, paid amounts round down; dust goes to the LP bucket, never to the creator or the platform; the verdict reads only four numbers and a flag; a rejection returns money, it never panics; exits stay open under PAUSED.

| Term | Definition | Code identifier | Source |
|---|---|---|---|
| Trial | the refundable period in which a launch is held back by a rule | `create_trial`, `Status::Open` | WINNER-BRIEF |
| Charter | immutable record of all terms, rules snapshot and windows; its borsh hash is `charter_hash` | `Charter`, `charter_hash` | S1-A 4 |
| Commit | USDC credited to a position during the Open phase | `try_commit`, event `contributed` | S1-B 5 |
| Walk | exit of the whole position before `walk_end`, principal returned in full, no fee | `walk`, `walk_signed`, event `walked` | S1-B 6 |
| Soft cap / hard cap | minimum total to PASS / total accepted at the clearing price | `soft_cap`, `hard_cap` | S1-B 2 |
| Oversubscription | `total_active > hard_cap`: everyone is scaled pro-rata and the excess is refunded with no fee | `Allocation.excess_pool` | S1-B 2.3 |
| Clearing price | `accepted / n_sale`, identical for every non-walked buyer | `allocate`, `settle_position` | S1-B 2.1 |
| Verdict | pure function PASS / FAIL(reasons bitset) | `verdict()`, `VerdictInputs` | S1-B 4 |
| inputs_hash | sha256 of the canonical little-endian encoding of the verdict inputs | `inputs_hash()` | verdict.rs |
| book_hash | rolling sha256 over every contributed and walked event; replayed by a judge | `book_next()` | S1-B 4.4 |
| Walk tail | the span between `commit_end` and `walk_end` in which the book can only shrink | `Phase::Closing` | S1-B 4.6 |
| Position | one holder's money and entitlements in one launch | `Position` | RECONCILED 3.1 |
| Custody | where a unit of principal physically sits: native USDC or inside `intents.near` | `Custody::{Native, Intents}` | RECONCILED 3.1 |
| Four buckets | launch fee, LP seed, stream, excess-refund pool; sum equals total committed | `Buckets` | RECONCILED 2.2 row 14 |
| Stream (lite) | creator proceeds unlocking linearly from PASS; withdraw-all reverts `STREAM_CAP` | `draw`, `linear_unlocked` | S1-C 4 |
| Relay fee | flat quoted USDC fee carved out of the signed amount that pays the submitter's gas; not principal, not refundable | `relay_fee` | RULING R2 |
| S3 / S4 | Intents attribution: buyer-signed transfer whose flat `msg` triggers `mt_on_transfer` (primary) / anyone forwards a signed memo transfer (fallback) | `mt_on_transfer`, `contribute_via_intents` | W0 |
| Deliver | where the tokens go: `near:<account>` or `sol:<key>` | `HolderId` | S1-B 5.1 |
| Bond | creator's refundable NEAR deposit that pays position storage | `bond_required` | RECONCILED 3.2 row 26 |
| Ladder caps | $1,000 per launch, $3,000 global, raising is timelocked 7 days | `Rules.max_hard_cap`, `Config.global_cap` | RULING 2026-11-07 |
| Pause / Freeze | stop new risk (exits open) / stop everything, auto-expires after 7 days | `PauseLevel` | S1-A 10.2 |

Source mapping: each row cites the spec section above; `build` copies definitions from `research/` and the specs, never invents them.

# Section 7: Submission Directory Plan

Created in the package phase, not in build.

[VERIFIED] - structure from the hackathon-forge Phase 2 template and near.md section 11 (package guidance).
```
# File: (tree) submission directory plan
submission/
├── screenshots/            captured in the demo phase
│   ├── landing.png         app/ `/`
│   ├── launch-walk.png     app/ `/launch/[id]` with the PASS margin and Walk button
│   └── demo-match.png      app/ `/demo` showing MATCH, then MISMATCH with Tamper
├── video/links.md          X post URL and the demo video link (Dami posts; a judged deliverable)
├── proof.md                testnet account ids, launch ids, tx hashes of one PASS run and one FAIL run, inputs_hash values (written by scripts/verify.sh chain)
├── links.md                public repo URL, live app URL, ARCHITECTURE.md / DECISIONS.md / LIMITATIONS.md / SECURITY.md / SUBMISSION_STATUS.md
└── sponsor-tracks.md       track -> evidence mapping (Section 8)
```
| File | Generated by | Phase |
|---|---|---|
| screenshots | browser capture of the three routes | demo |
| video/links.md | Dami after he posts | demo, package |
| proof.md | `evidence/` output plus explorer links | verify, package |
| links.md, sponsor-tracks.md | package skill from verified links | package |
Submission mechanics (near.md): one submission, cannot be edited; public repo and the X post first, submit last with margin. All of those are REQUIRES DAMI PER-ACTION CONFIRMATION.

# Section 8: Multi-Track Architecture (CO-3)

The form takes one or more track ids and one preferred track. The authoritative 13-track table (fit, module, judge step, honest limit, effort, dependency, freeze rule) is PRD 1.6. Architecture view: which component serves which track and where a judge verifies it.

| Track | Tier | Architectural component | What a judge verifies |
|---|---|---|---|
| memecoins | A | trial, Walk, verdict gating (`lifecycle.rs`, `payout.rs`); market fee router and opening-fee decay (5.8) | `make sim` 60-day table; trial page event log |
| security | A | `verify.sh` tamper, stream cap, pause that cannot trap exits (`s4.rs`, `parse_msg`), Launch Check and guard (5.12), agent vault (CUT) and the 100-attack gallery (5.14 [SYNC 2026-11-10: 13-attack was the design figure; 100 attacks ran]) | `./verify.sh 1 --tamper-all` exit 2; `make attack-gallery` [SYNC 2026-11-10: 100 attacks run: 81 refused, 14 no effect, 5 bounded, 0 failed; the earlier 13/13 figure is retired] was: 13/13 blocked or bounded; `make guard-demo` BLOCKED |
| open | A | the whole platform: NEAR verdict as sole judge of second-chain existence | full README run |
| defi | B | Market-lite pool and fee router (5.8), Intents intake (`intake.rs`, `ext.rs`) | `make market-demo` SLICES OK; dry quote 201 |
| swarms | B | `tools/swarm-sim/` simulator (20 agents: scripted, model-driven, adversarial) against `kruxa-logic`, optional testnet sub-accounts (5.14) | `make swarm` SWARM GREEN 24/24 |
| agents | B | MCP/API layer (5.7, 5.11), `agents/backer/`, agentkit and agent vault (5.14) | `make receipts-verify` RECEIPTS OK level=L1; `make agent-demo` receipts with real testnet tx hashes |
| thesis | B, conditional (CO-4) | indexer export plus `thesis/` (5.14) | `make thesis` THESIS BUILD OK; dropped at Nov 10 12:00 UTC if the freshness check or JWT fails |
| business, nfts | C | `keeper-biz/`; `contracts/pass/` | only if green at freeze; default not listed |
| privacy, realworld, games, social | dropped | none | none |

Rule F-TRACK: a track is listed only if its step is green at the freeze commit. Chain Signatures is load-bearing only if F0 ships (R-F0F1) and is claimed only as far as T0 to T5 proved.

# Section 9: Safety Architecture

| Layer | What it covers | Implemented in | Failure it prevents | How it is tested |
|---|---|---|---|---|
| 1 Input validation | typed numeric validation of every launch parameter with fixed check order; strict JSON for the commit message (`deny_unknown_fields`, <= 512 bytes); strict S4 payload struct; `deliver` and signer binding; relay-fee bounds; symbol reserved list | `kruxa-logic::rules::validate_params`, `intake.rs::parse_msg/resolve_holder`, `s4.rs` | hostile presets, injection through msg fields, parser differentials with the Verifier, wrong-token credit | `one_failing_case_per_code`, `commits_that_break_a_rule...`, `s4_forwards_only_strictly_shaped_payloads` |
| 2 Rate and size limits | $20 minimum, per-wallet cap, `max_holders`, per-launch total held (2x hard cap), global $3,000, page size 25, view limit 50, timelocked cap raises | `check_commit`, `admin.rs` | one actor dominating a launch, storage bloat, unbounded loops, instant cap inflation | `caps_global_launch_and_holder_limits_hold`, `launch_total_cap...`, `holder_cap...` |
| 3 Circuit breakers | guardian `pause` (new risk stops, exits open), `freeze` (everything stops, auto-expires in 7 days), owner-only `unpause`, cancel by creator before `commit_end` | `admin.rs`, `require_live`, `require_exit_open` | an exploit in progress; a pause that traps depositors; a pause that holds the verdict hostage | `pause_blocks_new_risk...`, `a_pause_cannot_hold_the_verdict_hostage...` |
| 4 Graceful degradation | a rejected commit returns the money; failed outbound legs re-credit in the callback; the verdict makes no promise so an outage cannot block it; S3 falls back to S4; creation recovery via `finalize_creation`; pull-based refunds anyone can push | `intake.rs`, `payout.rs::on_payout`, `lifecycle.rs` | stranded funds, double pay, a stuck launch | `failed_refund_leg_recredits...`, `fake_tokens_and_direct_callbacks...`, `create_trial_rejects...recovers_from_factory_failure` |
Two or more independent layers protect each money path (for example a refund is protected by debit-first accounting, by the callback re-credit, and by the L1 identity view).

# Section 10: Security spec (for build's SECURITY.md)

build scaffolds `SECURITY.md` from this skeleton and fills the File column with the final paths.

## Threat matrix

| Threat | Enforcement | File |
|---|---|---|
| Fake token credited as USDC | `ft_on_transfer` returns the amount unless `predecessor == cfg.usdc`; `mt_on_transfer` requires `predecessor == intents.near`, one token equal to the USDC token id, `previous_owner_ids[0] == sender_id` | `contracts/core/src/intake.rs` |
| Direct call to a callback | `#[private]` on `on_token_created`, `on_token_verified`, `on_payout`, `on_contribute_intents` | `lifecycle.rs`, `payout.rs`, `s4.rs` |
| Reentrancy / double pay | checks, then effects, then promise; debit before outbound; callback re-credits only its own op; second `claim_refund` finds `due == 0` and returns false | `payout.rs` |
| Forged attribution of a Solana buyer | S3: the Verifier authenticates the signer and our `resolve_holder` requires `deliver == sol:<same key>`; S4: strict payload struct, `signer_id == hex(public_key)`, memo key equals signer | `intake.rs`, `s4.rs` |
| Walk replay or forgery | monotone per-key nonce, deadline, `env::ed25519_verify` over a fixed preimage that names the contract, launch, holder, nonce and deadline | `intake.rs::walk_signed` |
| Creator self-funds a PASS | creator and stream recipient cannot commit (R_SELF_BUY); cost floor: launch fee plus locked LP; **sybil wallets are NOT defended** | `intake.rs::check_commit` |
| Verdict manipulation by the caller | `settle` reads only stored state; no caller-dependent input, no promise | `lifecycle.rs::settle` |
| Last-second flip | commits close at `commit_end`; the walk tail lets stayers react; margin shown in the app | `kruxa-logic::phase_at`, `app/app/launch/[id]/page.tsx` |
| Oversized or malicious commit message | 512-byte limit, `deny_unknown_fields`, typed parse before any state change | `intake.rs::parse_msg` |
| Hostile re-parameterisation after commits | Charter is written once and hashed; rules are a snapshot | `lifecycle.rs::create_trial` |
| Rounding drain | charged amounts round up, paid amounts round down, residue to LP; proptest of conservation | `kruxa-math`, `kruxa-logic::settle` |
| Pause trapping exits | exits require only "not FROZEN"; FROZEN auto-expires in 7 days; unpause is owner-only | `lib.rs::pause_level`, `admin.rs` |
| Instant cap inflation | raising a cap is queued 7 days and public; lowering is instant | `admin.rs` |
| Brand symbol squatting | `KRUXA` and 8 others are reserved to the owner | `kruxa-logic::rules::check_text` |
| Mainnet by accident | `lib/config.ts` throws on mainnet without the confirmation token; `testnet-deploy.sh` refuses non-testnet | `app/lib/config.ts`, `scripts/testnet-deploy.sh` |

## Not defended against

1. **Sybil wallets.** Nothing here proves that committed money comes from distinct people; `min_funders` counts accounts. No sybil-resistance claim is made.
2. **Upgrade authority.** Wave 1 has no upgrade path and the deployer holds a full-access key on testnet (phase P0, disclosed). The multisig + 7-day timelock plan (S1-A 10.4) is Wave 2+; until then a key holder can replace the code. [SYNC 2026-11-10: a 7-day public upgrade queue now exists in core (`queue_upgrade`, `cancel_upgrade` by owner or guardian, `upgrade_core`), but the owner still holds a full-access key on testnet (`verify` KEYS line: 1 full-access key), and a full-access key can redeploy at once without the queue. The queue is a public commitment, not a technical barrier, until that key is deleted or replaced by a multisig. On the `demo` profile (core3) the queue delay is 60 s, not 7 days]
3. **The Intents Verifier and its DAO.** Money held in `intents.near` is exposed to its force-withdraw and lock powers (S1-B X23); time in Intents is minimised by `consolidate`, not eliminated.
4. **The launch-token factory.** `token.primitives` instances adopt code from a global contract whose owner holds one full-access key. The platform cannot detect a code swap on-chain; detection is off-chain (hash comparison in `verify`, Wave 2). Own-FT-by-hash is the mitigation and is not approved.
5. **No independent review.** No audit has covered this code. The Genesis Round, if run, runs with that gap disclosed.
6. **Compile and VM compatibility on mainnet.** The wasm loaded in the protocol-88 sandbox; mainnet also reports protocol 88 [VERIFIED 2026-11-08], but acceptance on the real network is untested until the testnet deploy.
7. **Wave 1 omissions that are exposures, not features:** the async solvency anchor, burn of a failed launch's token, creator-allocation vesting, and in-claim token registration (Section 5.6).
8. **Frontend runtime.** The app was built, not exercised in a browser or against a live wallet.
9. **Block-timestamp skew** shifts a boundary by seconds; windows are 24 hours or more on the ladder profile, 90 s / 30 s on the labelled demo profile.
10. **Front-end and RPC trust** for anyone who does not run `verify` themselves.


---

# Section 11: Configuration Reference

## 11.1 Contract initialisation (`new`)

[VERIFIED] - `contracts/core/src/lib.rs`; used by the sandbox harness with the `demo` profile.

| Argument | Meaning | Testnet value | Mainnet value |
|---|---|---|---|
| `owner` | cap raises, unpause, brand-symbol launches | the deployer account | multisig (Wave 2+); REQUIRES DAMI PER-ACTION CONFIRMATION |
| `guardian` | `pause`, `freeze`, lower caps; cannot unpause | `guardian.<root>.testnet` | `guardian.kruxa.near` (function-call key) |
| `treasury` | receives the launch fee | `treasury.<root>.testnet` | `treasury.kruxa.near` |
| `relay_fees` | receives relay fees | `relay-fees.<root>.testnet` | `relay-fees.kruxa.near` |
| `usdc` | quote asset contract | mock FT account | native USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `intents` | Verifier | mock Intents account | `intents.near` |
| `factory` | launch-token factory | mock factory or `token.primitives.testnet` (probe first) | `token.primitives.near` |
| `profile` | `ladder` (24 h minimum window) or `demo` (90 s commit, 30 s tail, same wasm, separate account) | `demo` | `ladder`; `demo` only on `demo.kruxa.near` |

## 11.2 Rule constants (the `Rules::ladder()` snapshot stored in every Charter)

[VERIFIED] - `crates/kruxa-logic/src/rules.rs`.

| Field | Value | Meaning |
|---|---|---|
| decimals | 6 | USDC and launch token |
| min/max supply (whole) | 10,000,000 .. 1,000,000,000,000 | fits u64 on Solana |
| sale / LP bps | 5,000..8,000 / 1,500..4,000 | buckets sum to 10,000 |
| creator / backer / combined bps | <= 2,000 / <= 1,000 / <= 2,500 | |
| hard cap | $500 .. $1,000 | ladder (RULING 2026-11-07); production 250,000 USDC after review |
| soft cap | >= max($350, 20% of hard cap), <= hard cap | |
| min buy | >= max($20, ceil(hard cap / 500)), <= soft cap | checked on the net amount after the relay fee |
| wallet cap | max(ceil(hard cap x wallet_bps), 5 x min buy); wallet_bps 50..500 | |
| funders | 10..500, and funders x min buy <= soft cap | R_PASSABLE |
| commit window / tail / open delay | 24 h..30 d / 1 h..48 h / <= 7 d (`demo`: 90 s min commit, 30 s min tail) | |
| max holders | min(500, ceil(2 x hard cap / min buy)) | |
| oversubscription ceiling | 20,000 bps (2x) | NEW, Section 3 row 7 |
| relay fee | <= $0.50 and <= 500 bps of the signed amount | open item, Section 3.2 |
| launch fee | 150 bps, min $10, max $2,500, ceiling 300 bps | |
| stream days | >= 30 (hard cap <= $25,000) else >= 90; <= 365 | |
| backer vest | 30 days linear | RULING 2026-11-07 |
| global cap | $3,000 (`GLOBAL_CAP_USDC`) | timelocked raise |
| factory deposit | 0.06 NEAR estimate (`FACTORY_DEPOSIT_YOCTO`) | replace with the probe value |

## 11.3 Cargo features and gas

| Item | Value |
|---|---|
| feature `s4-fallback` | default ON in testnet builds; decided after the live S3 test for mainnet (RECONCILED 2.3) |
| feature `relayer-intake` | does not exist (trusted relayer S1 is NOT built) |
| `GAS_OUT` / `GAS_CB` | 20 / 25 Tgas static gas on outbound legs and callbacks (estimates; the sandbox suite passes with them; measure with the gas bench in Wave 1b) |
| S4 forward / consolidate | 150 / 100 Tgas |
| attach on calls | `walk`: exactly 1 yocto; `create_trial`: `required_deposit` view and at least 250 Tgas (refused with `R_GAS` below it; attach 300) [SYNC 2026-11-10: `claim_tokens`, `claim_creator_alloc` and `sweep_tokens` are payable: 1 yocto when the receiver is registered on the launch token, 0.00125 NEAR + 1 yocto when not (the rest is refunded), about 150 to 200 Tgas (the app attaches 200); `create_token` to the factory is sent with 110 Tgas (80 fails on the real factory, which needs 91 to 95); `GAS_OUT` 20 and `GAS_CB` 25 Tgas are unchanged] |

## 11.4 App environment (`app/.env.example`)

> [SYNC 2026-11-10: `app/lib/config.ts` also reads the variables listed in the 4.9 sync note above; `app/.env.example` and its test (`env-example.test.ts`) are the source, not the short list below.]

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` | `mainnet` is refused unless the next variable is set |
| `NEXT_PUBLIC_MAINNET_CONFIRMED` | unset | exactly `DAMI-PER-ACTION-CONFIRMED`; only Dami sets it |
| `NEXT_PUBLIC_NEAR_RPC` | `https://rpc.testnet.near.org` | `rpc.mainnet.near.org` worked on 2026-11-06 but is a legacy endpoint (kit README) |
| `NEXT_PUBLIC_CORE_ACCOUNT`, `_USDC_ACCOUNT`, `_INTENTS_ACCOUNT`, `_FACTORY_ACCOUNT` | `*.kruxa.testnet` | |

## Credentials Needed

| Variable | Used By | Where to Obtain | Required Before |
|---|---|---|---|
| `KRUXA_OWNER` (a testnet account the near CLI can sign for) | `scripts/testnet-deploy.sh` | create a free testnet account with the near CLI (the exact near-cli-rs subcommand grammar is UNVERIFIED, check `near account create-account --help`); the key stays in the OS keychain | deploy |
| `KRUXA_TESTNET_ROOT` (e.g. `kruxa.testnet`) | `scripts/testnet-deploy.sh` | a free testnet name | deploy |
| `NEXT_PUBLIC_*` (non-secret) | app | Section 11.4 | build, demo |
| `NEAR_ENV=testnet` | deploy script guard | shell | deploy |
| Wallet with testnet NEAR | app, manual demo | MyNearWallet on testnet | demo |
| `SOL_RPC` / `SOL_DEVNET_RPC` | Wave 2 relayer, signed-test kit | public RPC (rate-limited) or a provider key | Wave 2 build |
| `ONECLICK_JWT` (possible) | Solana entry quote via 1Click | the kit's ambiguity 3: a live (non-dry) quote may require auth; confirm | Wave 2 live test |
| AWS KMS key (genesis key G, ATTEST, OPS) | Wave 2 relayer | Dami's AWS account; memory-only for the demo (RULING #4) | Wave 2 beta |
| Squads members (3 separate hardware wallets; public keys only in the manifest) | reserve vault | Dami; order now if not owned, the vault is created at the Nov 10 gate (GR-7) | Nov 10 |
| `NEARAI_API_KEY` (NEAR AI Cloud, credits bought by Dami) | agentkit live mode (agents, swarms) | cloud.near.ai; key into a local env file, never pasted in chat | Nov 9 12:00 UTC target |
| `GOOGLE_APPLICATION_CREDENTIALS` and `BQ_PROJECT` (GCP service-account key file path and project id) | thesis BigQuery pull | Dami's GCP project; never pasted in chat | Nov 9 18:00 UTC target |
| Throwaway signing keys | the two approved signed tests | generated by Claude into the session scratchpad (never the repo); Test 1 is funded from the funds Dami already sent (no more money, R-50); Dami runs every money-moving command with the `!` prefix, Claude verifies read-only (R-49/R-51) | only after Dami's per-action go |
| Mainnet signing authority | any mainnet step | Dami only | REQUIRES DAMI PER-ACTION CONFIRMATION |

# Section 12: Testing Strategy

[VERIFIED] - counts are from the run recorded in Section 17.

| Layer | What | Count | Command |
|---|---|---|---|
| Unit + property (pure) | rounding, overflow, validation (one failing case per code, inclusive boundaries), verdict boundary, S1-B examples 1 and 2, conservation over random books, ledger identities | 9 in kruxa-math, 16 in kruxa-logic | `cargo test -p kruxa-math -p kruxa-logic` |
| Sandbox end to end | lifecycle (6), adversarial (9, one slow), Intents paths (4) | 19 | `scripts/test.sh` (add `--include-ignored` for the slow holder-cap test) |
| App | TypeScript mirror pinned to the Rust hashes | 3 | `cd app && npm test` |
| Static | `cargo fmt --check`, clippy `-D warnings` (host for pure crates, wasm32 for contracts), `tsc --noEmit`, `next build` | all clean | `scripts/lint.sh`, `npm run typecheck` |
| Judge path | `scripts/verify.sh golden`; `chain ... --tamper` must print MISMATCH | golden ran; chain needs a deployment | `scripts/verify.sh` |

Critical tests: `pass_oversubscribed_four_buckets_refunds_and_claims` (spend 71,428,572 and refund 28,571,428 for a $100 buyer at $1,400 against a $1,000 cap; L1 and L4 true; tokens `floor(100e6 x 600e12 / 1400e6)`), `failed_refund_leg_recredits_and_a_retry_pays_exactly_once`, `a_pause_cannot_hold_the_verdict_hostage_but_it_does_hold_creator_payouts`, `s4_forwards_only_strictly_shaped_payloads`.

Not covered, stated: the FROZEN 7-day auto-expiry; gas measurement (`[ESTIMATE]` constants); a live Intents or factory call; browser behaviour; `kruxa-sim verify` against a live RPC; the codes listed in Section 4.7 as untested.

# Section 13: Component Build Order

## 13.1 Prerequisites (Wave 0, free, before any build step)

| # | Step | Why | Status |
|---|---|---|---|
| 1 | `rustup toolchain install 1.95.0 --profile minimal -t wasm32-unknown-unknown` | near-sdk 5.30.1 needs 1.95; the machine default is 1.91.1 | done in this run |
| 2 | `cargo +1.95.0 install cargo-near --version 0.23.0 --locked` | wasm build and lowering | done in this run |
| 3 | `npm install` in `app/` | app and tests | done in this run |
| 4 | run S3 against the REAL `intents.near` wasm in the sandbox (fetch the wasm with `view_code`, deploy it with `near-workspaces` `import_contract`) | W0 is source-read only | not done; the harness `Env` already isolates the Verifier so this is a one-file swap |
| 5 | deploy `kruxa_core.wasm` to a funded testnet account | proves real-network acceptance of the wasm (protocol 88) and the init path | not done; needs a testnet account (free) |
| 6 | testnet probe of `token.primitives.testnet`: `create_token` deposit, refund of an over-attached deposit, presence of `ft_burn` (V-6) | replaces the 0.06 NEAR estimate | not done |

## 13.2 Order, constraints and parallel groups

CO-3: the workstreams WS-A, WS-M, WS-S, WS-I, WS-U1 to U3, WS-T and WS-D, their owned paths and the merge schedule are in PLAN.md (Part CO-3). The order below is the Wave 1 order and is unchanged.

| Step | Component | Must follow | Reason |
|---|---|---|---|
| 1 | workspace config | prerequisites 1-2 | pins |
| 2 | kruxa-math | 1 | everything calls it |
| 3 | kruxa-logic | 2 | rules, verdict, allocation |
| 4 (parallel group A) | core `model/events/ext/token/lib`; mocks (`mock-ft`, `mock-intents`, `mock-factory`); `kruxa-sim` + `verify.sh`; app `lib/verdict.ts` + `lib/config.ts` | 3 | A1 needs logic; A2 needs only near-sdk; A3 needs only logic; A4 needs only the vectors A3 prints. Four people (or four agents) can work at once without sharing a file |
| 5 | core `lifecycle`, `intake`, `payout` | A1 | `intake` and `payout` use the ledger shape and `lifecycle::settle_position_inner` |
| 6 (parallel group B) | core `views`, `admin`, `s4`; `scripts/build.sh`; app `lib/near.ts`, `lib/wallet.ts` | 5 | independent of each other |
| 7 | sandbox harness and tests | 5, 6, A2 | need the wasm files |
| 8 (parallel group C) | app pages (`layout`, `page`, `create`, `launch/[id]`, `demo`); `lint.sh`, `test.sh`, CI | 6, 7 | pages need the view names; scripts need the crate names |
| 9 | testnet deployment, evidence run, `verify.sh chain` | 7, prerequisites 5-6 | |

P1 features deliverable from P1 components alone: the full trial (create, commit, Walk, settle PASS and FAIL, refund, claim) needs only steps 1-3, A1, A2, 5, 7. The app, S4, the stream and the CLI are P2. If time forces a cut, cut in this order: app pages beyond `/demo`, `s4.rs`, `pay_relay_fees`, `draw`, `claim_tokens` bonus vest (RECONCILED cut order keeps Walk, verdict, settle, refund).

Deviation from the RECONCILED Wave 1 checklist (D0 to D3, Nov 7-9), stated: that checklist puts the S3 entry on D3. Here the entry and the whole money path exist already because they were written first and tested together; D3 is therefore free for steps 4-6 above and the gate in RECONCILED 9 (stream-lite + settle + refund green by Nov 8 EOD) is met by the recorded run.

# Section 14: Deployment Sequence

Testnet and devnet only. A mainnet step is never scripted. Every row marked `REQUIRES DAMI PER-ACTION CONFIRMATION` waits for his explicit go at execution time.

## 14.1 Testnet sequence (free)

| # | Service | Startup command | Health check | depends-on | Env vars |
|---|---|---|---|---|---|
| 1 | build artifacts | `./scripts/build.sh` | `ls -l target/near/*/*.wasm` shows four files | toolchain | none |
| 2 | mock USDC (`usdc.$ROOT`) | `./scripts/testnet-deploy.sh --yes` (prints then runs) | `near view usdc.$ROOT ft_total_supply` | 1 | `NEAR_ENV=testnet`, `KRUXA_TESTNET_ROOT`, `KRUXA_OWNER` |
| 3 | mock Intents, mock factory | same script | `near view intents.$ROOT mt_balance_of '{"account_id":"x.testnet","token_id":"nep141:usdc.$ROOT"}'` | 1 | same |
| 4 | core (`core.$ROOT`) | same script (deploy with init call, `profile: demo`) | `near view core.$ROOT get_config` | 2, 3 | same |
| 5 | register core and users on mock USDC | `near call usdc.$ROOT storage_deposit '{"account_id":"core.$ROOT"}' --deposit 0.002` | `near view usdc.$ROOT storage_balance_of '{"account_id":"core.$ROOT"}'` | 4 | `KRUXA_OWNER` |
| 6 | app | `cd app && cp .env.example .env.local && npm run build && npm start` | `curl -sf localhost:3000/demo` | 4 | `NEXT_PUBLIC_*` of Section 11.4 |
| 7 | evidence run (one PASS and one FAIL launch with the `demo` clock) | follow the sandbox tests by hand with `near call` or the app | `./scripts/verify.sh chain https://rpc.testnet.near.org core.$ROOT 1` prints MATCH; with `--tamper` prints MISMATCH | 4, 5 | none |

The real token factory replaces the mock only after the Wave 0 probe: set `factory` at `new` to `token.primitives.testnet`.

## 14.2 Solana devnet (Wave 2)
Genesis-shaped mint test T4 runs on devnet only (airdrop is free); no Solana mainnet state is created. `SOL_DEVNET_RPC` rate-limits; the kit documents the fallback faucet.

## 14.3 Mainnet steps (none is scheduled by this document)

| # | Step | Gate |
|---|---|---|
| M1 | live S3 micro-test: one raw_ed25519 transfer of 1 unit with `msg="ping"` to a logger, plus a refund variant | approved in principle (<= $1); REQUIRES DAMI PER-ACTION CONFIRMATION at execution; funded from the funds Dami already sent (no new money, R-50); Dami runs every money-moving command with the `!` prefix (R-49) |
| M2 | F0 dust test (Chain Signatures Ed25519 mainnet signing, ~2 NEAR + 0.01 SOL) | approved in principle; REQUIRES DAMI PER-ACTION CONFIRMATION; no mint on mainnet |
| M3 | deploy `kruxa_core.wasm` to `core.kruxa.near` | REQUIRES DAMI PER-ACTION CONFIRMATION; only after the Nov 10 EOD G3 GO (target Nov 11 morning UTC); the FIRST mainnet token must be the brand token ($KRUXA); no other token or mint before it |
| M4 | register core on native USDC (0.00125 NEAR) | REQUIRES DAMI PER-ACTION CONFIRMATION |
| M5 | Squads reserve creation, Solana genesis for the brand token | REQUIRES DAMI PER-ACTION CONFIRMATION |
| M6 | make the repo public (Nov 13) | REQUIRES DAMI PER-ACTION CONFIRMATION |
| M7 | the X demo post | REQUIRES DAMI PER-ACTION CONFIRMATION (posting happens on his account) |
| M8 | the one-shot submission form (Nov 14) | REQUIRES DAMI PER-ACTION CONFIRMATION |
| M9 | `create_trial` for $KRUXA on mainnet (open by Nov 11 12:00 UTC, latest 18:00) | REQUIRES DAMI PER-ACTION CONFIRMATION; first mainnet token |
| M10 | deploy `market.kruxa.near` and call `open_market` for $KRUXA after settle | REQUIRES DAMI PER-ACTION CONFIRMATION; only after the M-gate (Nov 11 EOD) is green |
| M11 | Squads vault with the two named independents; later the LP-seed release | REQUIRES DAMI PER-ACTION CONFIRMATION; members sign; 48 h timelock kept |
| M12 | owner opens the creator gate (capped beta) | REQUIRES DAMI PER-ACTION CONFIRMATION; only after $KRUXA genesis succeeded and BLK-1 closed |
| M13 | hosting deploy, domain, public indexer | REQUIRES DAMI PER-ACTION CONFIRMATION (spend and outward-facing) |
| M14 | Meteora pool creation on mainnet from the Squads vault | REQUIRES DAMI PER-ACTION CONFIRMATION; after the timelock, probably after Nov 14 |

# Section 15: Addresses and External References

| Name | Value | Status |
|---|---|---|
| `intents.near` deployed code hash | `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk` (mainnet block 223329119) | VERIFIED by W0 (RPC `view_account`) |
| Native USDC (NEAR) token id on Intents | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | S1-B / W0 |
| Token factory | `token.primitives.near`; instance wasm hash `761mdZ7HrfKSeRzAsPAokyiZzhVA8iKHiDxGp3LFWUjQ`; global contract `ft.globals.primitives.near` (one full-access key) | S1-A 8.4, live-probed 2026-11-06 |
| Testnet factory | `token.primitives.testnet` (code hash `GKvn7KmW...`) | S1-A 8.4; Wave 0 probe |
| Chain Signatures | `v1.signer`, domain 1 = Ed25519 | signed-test kit (not run) |
| 1Click API | `https://1click.chaindefuser.com/v0/quote` (dry quotes returned 201 on 2026-11-06) | S1-B 5.3 |
| Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | S1-D 8.1 |
| Jito distributor | `mERKcf...` (immutable, upgrade authority None) | S1-D 4.1; full id to be read from the IDL in test T-D1 |
| Planned Kruxa accounts | `core.kruxa.near`, `market.kruxa.near`, `treasury.kruxa.near`, `guardian.kruxa.near`, `genesis-relayer.kruxa.near`, `keeper.kruxa.near`, `relay-fees.kruxa.near`, `demo.kruxa.near` | NOT created; `kruxa.near` confirmed free in DECISIONS-PACK1; creation is a mainnet step (14.3) |
| Wallet / explorer for testnet | MyNearWallet (testnet), `https://testnet.nearblocks.io` | UNVERIFIED |
| Docs | docs.near.org, docs.near-intents.org, github.com/near/intents (PR #148 notify-on-transfer, #150 return-value respect, #167 state_init) | W0 |

# Section 16: Integration Map

| From | To | Protocol | Credential (env var name) | Health Check (exact command/URL) | Priority |
|---|---|---|---|---|---|
| app | NEAR RPC | JSON-RPC over HTTPS | none (`NEXT_PUBLIC_NEAR_RPC`) | `curl -s -X POST $NEXT_PUBLIC_NEAR_RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}'` | P0 |
| app / wallet | kruxa-core (`create_trial`, `walk`, `claim_*`, `settle`) | NEAR function call via wallet-selector | wallet (no env var) | `near view $NEXT_PUBLIC_CORE_ACCOUNT get_config` | P0 |
| buyer | USDC `ft_transfer_call` -> core `ft_on_transfer` | NEP-141 | wallet | `near view $NEXT_PUBLIC_USDC_ACCOUNT ft_balance_of '{"account_id":"<core>"}'` | P0 |
| `intents.near` | core `mt_on_transfer` (S3) | NEP-245 receiver callback | none (signed payload) | mainnet read-only: `simulate_intents` view with a locally signed payload (W0); testnet: mock | P0 |
| anyone | core `contribute_via_intents` -> `intents.near` `execute_intents` (S4) | NEAR function call + Intents payload | none | `near view core.$ROOT get_state '{"launch_id":"1"}'` after submission | P1 |
| core | USDC `ft_transfer` | NEP-141 | none | same as row 3 | P0 |
| core | `intents.near` `mt_transfer`, `ft_withdraw` | NEP-245 + Intents withdraw | none | `near view intents.near mt_balance_of '{"account_id":"<core>","token_id":"nep141:1720...33a1"}'` (mainnet, read-only) | P0 |
| core | token factory `create_token`, then launch token `ft_balance_of`, `ft_transfer` | NEAR function call | none | testnet probe in Section 13.1 step 6 | P0 |
| kruxa-sim / verify.sh | NEAR RPC views | JSON-RPC | none | `./scripts/verify.sh chain <rpc> <core> 1` | P0 |
| Solana buyer | 1Click `/v0/quote`, `/v0/status`, `/v0/deposit/submit` | HTTPS | possibly `ONECLICK_JWT` (open) | `curl -s -o /dev/null -w '%{http_code}' -X POST https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -H 'User-Agent: curl/8.7.1' -d '<dry quote JSON of S1-B 5.3>'` expects 201 | P1 |
| relayer (Wave 2) | Solana RPC (devnet) | JSON-RPC | `SOL_DEVNET_RPC` | `curl -s $SOL_DEVNET_RPC -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'` | P1 |
| relayer (Wave 2) | Jito distributor, Metaplex, Squads | Solana programs | KMS-held keys | devnet transaction simulation (Section 5.2) | P1 |
| ATTEST (Wave 4) | SAS | Solana program | KMS-held key | `getAccountInfo` of the credential PDA | P2 |
| core (F0, Wave 4) | `v1.signer` | NEAR function call, 1 yocto, 300 Tgas | none | `near view v1.signer public_key '{"domain_id":1}'` (read-only, mainnet) | P2 |
| indexer (CO-3) | neardata | HTTPS GET | none | `curl -sL https://mainnet.neardata.xyz/v0/last_block/final -o /dev/null -w '%{http_code}'` expects 200 (200 on 2026-11-08) | P1 |
| venue service (CO-3) | Meteora programs on devnet | Solana programs | throwaway devnet keys | spike S-M, `spikes/meteora/RESULT.md` | P1 |
| app (CO-3) | wallets | near-connect manifest; wallet-standard | none | pinned package check | P1 |
| agent (CO-3, stretch) | x402 or PingPay facilitator | HTTPS 402 | key unverified | not scheduled | P3 |
| CI | GitHub Actions | HTTPS | none until push (Dami's confirmation) | not run | P2 |

# Section 17: Verification ledger

Everything below was run on 2026-11-07 on this machine unless it says otherwise. Raw logs are in the session scratchpad, which is not part of the repo.

| Check | Result |
|---|---|
| `rustc +1.95.0 --version` | `rustc 1.95.0 (59807616e 2026-04-14)` |
| `cargo test -p kruxa-math -p kruxa-logic` | 9 + 16 pass, 0 fail |
| `cargo near build non-reproducible-wasm --no-abi` (core) | success; `kruxa_core.wasm` 456,999 bytes, sha256 `96020d9b82461cecf31f7502fcf52cb0bbff42d3a6fd116ee4d3b54cf4ef6229` |
| `cargo fmt --all -- --check`; `cargo clippy ... -D warnings` (pure crates on host, contracts on wasm32) | clean |
| `cargo test -p kruxa-tests -- --include-ignored` (near-workspaces 0.24.0 sandbox) | 19 pass, 0 fail |
| `cd app && npm test && npx tsc --noEmit && npx next build` | 3 vitest pass; tsc clean; 5 routes built (`/`, `/create`, `/demo`, `/launch/[id]`, `/_not-found`) |
| `scripts/verify.sh golden` | printed `PASS` at the boundary, `FAIL(reasons=1)` one micro-USDC below, and S1-B example 1 (fee 75,000,000; LP 2,083,333,333; stream 2,841,666,667; refund pool 7,500,000,000; $100 buyer spend 40,000,000, refund 60,000,000) |
| document round trip | `scripts/extract_architecture.py ARCHITECTURE.md <dir>` wrote 60 files; `diff -r` against the compiled workspace: identical (0 differing files) |
| Bugs found by running (kept as evidence the suite bites) | (1) mock factory expected `args.args.total_supply`; the first sandbox run showed the real call shape is `{"args": {...}}` as one parameter named `args` (mock fixed). (2) Design flaw found while writing: an indefinite guardian PAUSE could block `settle` and strand every refund; fixed so only FROZEN (auto-expiring) can, and covered by a new test. (3) a new round-trip test showed `dec::u128::deserialize` borrowed a `&str`, which fails for owned input (`serde_json::from_value`), so `kruxa-sim verify` would have failed on a live RPC response; fixed to `String`. (4) the first draft had no fee-router validation although the kickoff lists those codes; added (`check_fees`). (5) clippy: macro-generated U256 lints, a long test vector, `map_or`; all fixed |
| Not run | any real `intents.near` call, any `token.primitives.*` call, any browser session, any wallet popup, any mainnet or testnet transaction, GitHub CI |

## 17b. CO-3 verification ledger (2026-11-08, read-only)

| Check | Result |
|---|---|
| `curl -X POST https://rpc.mainnet.near.org` method `status` | version 2.14.0, rustc 1.95.0, protocol_version 88, chain mainnet |
| `curl -sL https://mainnet.neardata.xyz/v0/last_block/final` | HTTP 200 after a redirect to `/v0/block/223569501` (a block JSON); the testnet host also redirected (302) and was not followed |
| Not run | any Meteora call, any market code, any indexer, near-connect, Lightweight Charts: all CO-3 sections 5.8 to 5.13 are interface level and [UNVERIFIED-COMPILE] |


## 17d. Final-build ledger (2026-11-10, testnet and devnet only)

Every row cites a committed file; nothing here is a mainnet result.

| Check | Result | Evidence |
|---|---|---|
| Core wasm on core7 | sha256 `c55bffdb...`, 655,376 bytes, reproducible build, equal to `artifacts/SHA256SUMS`; `view_code` read from testnet RPC (`evidence/testnet-core7/deploy-core7.log`). Round 4 on core3 was the previous build `665caab5...` | `artifacts/SHA256SUMS`, `evidence/testnet-core7/verify-core7-launch1-FAIL-dissolved.txt`, `evidence/testnet-core3/verify-10-f0.txt` (old hash) |
| F0 rehearsals through the contract gate | 6 of 6: launches 2, 5, 6 on `7d7b0da2...`, launch 8 on `e338f84d...`, launch 9 on the local build `e85198ed...`, launch 10 on the deployed reproducible `665caab5...`; `verify.sh` exit 0 each | `evidence/genesis/core3-f0-devnet-launch*.json`, `rehearsal/ROUND2.md`, `ROUND3.md`, `ROUND4.md` |
| F1 | launch 4 on core3 passes, C16 now passes (genesis key swept to 890,880 lamports) | `evidence/testnet-core3/verify-4-f1.txt` |
| verify tamper and dead RPC | `--tamper-all` exit 2 with MISMATCH lines; dead RPC exit 4 | `verify-8-tamper-all.txt`, `verify-2-dead-rpc.txt` |
| gate-g2 | GREEN 9 of 9 on core3 at round 4 (PASS launch 10, FAIL launch 3; G2-01 reads existing gate-g1 logs, not a re-run) | `evidence/testnet-core3/gate-g2-round4.txt` |
| gate-g3 | NO-GO as last recorded on 2026-11-10, before rounds 3 and 4; not re-run; blockers GR-3, 7, 8, 9, 11, 13, 14, 17 (Dami-side or unrecorded) | `evidence/testnet-core3/gate-g3.txt` |
| Real factory | `create_token` at 80 Tgas fails, 110 Tgas succeeds; a repeated `storage_deposit` is refunded (N-04 closed for the real factory) | `evidence/testnet-core3/real-factory-probe.json`, `docs/KNOWN-FINDINGS.md` |
| Attack gallery | 100 attacks, 81 refused, 14 no effect, 5 bounded, 0 failed, 10 not done; sandbox hashes | `evidence/attack-gallery/`, `docs/ATTACK-GALLERY.md` |
| Judge runs | full `make judge`: 20 of 20 steps GREEN in 2,512 s on git `64ea392`; fast subset: 19 of 19 in 553 s on git `b4b4c8a`. Neither is under 300 s | `evidence/judge-run.txt`, `evidence/judge-fast-run.txt` |
