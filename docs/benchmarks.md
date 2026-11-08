# Benchmarks and Phase 2 measurements (workstream A, 2026-11-08)

Every number below was produced by a command in this repo on 2026-11-08; labels: SANDBOX (near-workspaces sandbox, protocol 88), TESTNET (real NEAR testnet), ESTIMATE (arithmetic, not measured).

## B-FACTORY (W1-DC-12, DT-X5): what `token.primitives.testnet` charges, refunds and offers
Command: `./scripts/testnet-factory-probe.sh` (TESTNET, play money, throwaway account `probe.kxa1-owner-1203.testnet`); raw output in `evidence/factory-probe.txt`.

| attached deposit | NEAR kept by the factory path | refund of the excess | gas (NEAR) |
|---|---|---|---|
| 3 | 3.000000 | no | 0.0077 |
| 0.06 | 0.060000 | no | 0.0077 |
| 0.02 | 0.020000 | no | 0.0077 |
| 0.005 | 0.005000 | no | 0.0077 |

Findings (TESTNET):
- Factory code hash `GKvn7KmWjnqu5pv5yKwgdAz835BX4nkdqEEcLDdwY7Vb`; exports `create_token`, no `get_required_deposit`.
- The factory does not charge a fee of its own and does not refund: the attached deposit becomes the balance of the new token account (view_account of `prb121320.token.primitives.testnet`: balance exactly 3 NEAR, `storage_usage` 387 bytes, `code_hash` `11111111111111111111111111111111` = no local code, a global contract; 0 access keys). Even 0.005 NEAR was accepted.
- The 2.36 NEAR figure (`tkn.primitives.near`) did NOT appear on testnet. The mainnet factory (`token.primitives.near`) is a different account whose cost this probe does not measure (creating a token there is forbidden before $KRUXA).
- `ft_burn` and `burn` are absent on the created token; `ft_metadata` and `ft_total_supply` are present. Consequence: `burn_mode = Hold` (dead-token supply stays at core, disclosed).
- Decision (DT-X5): keep `FACTORY_DEPOSIT_YOCTO = 0.06 NEAR` and the `required_deposit` formula. The deposit is spent for the creator (it stays on the token account), never returned by the factory; the creator bond above it is returned by `reclaim_bond`. Edge to disclose: if the token is created but the supply check then fails (`CreationFailed`), `reclaim_bond` returns `bond + factory_deposit` although the factory kept the deposit on the token account; core would pay the 0.06 NEAR out of its own balance in that case [ESTIMATE of the exposure: 0.06 NEAR per such launch].

## DT-X4: protocol versions
`status` of both RPCs on 2026-11-08: testnet protocol 88, mainnet protocol 88 (the sandbox is 88).

## W1-DC-8 / DT-S3S4: S3 against the REAL `intents.near` wasm (SANDBOX)
`./scripts/fetch-intents-wasm.sh` reads `view_code` from a mainnet RPC (read-only), 1,297,551 bytes, code hash `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk` equal to the pinned value. `cargo test -p kruxa-tests --test real_intents` runs 6 tests with real raw_ed25519 signatures: S3 accept (credit net of relay fee, signer charged exactly once), rejects refund the signer (R_RELAY_FEE, R_MIN_CONTRIBUTION, R_DELIVER x2), a fake token is refused and refunded, a direct `mt_on_transfer` call is refused, a replayed nonce fails inside the Verifier, a paused Verifier blocks commits and moves nothing. Outcome: S3 ships as the primary Solana path; live behaviour on mainnet stays unverified until Test 1.

## B-WASM (W1-DC-13, DT-X2)
| build | size (bytes) | sha256 |
|---|---|---|
| wave 1 baseline (G1 closeout) | 462,222 | see LIMITATIONS |
| local `scripts/build.sh`, rustc 1.95.0, with D-1, D-2, D-3 and genesis | 552,326 | changes with every commit |
| reproducible container build, `sourcescan/cargo-near:0.23.0-rust-1.99.1` (linux/amd64), commit 522b1ce | 537,674 | `17db9771c2aa8a6df535d919269b3333fff853c3845d32f307a20578e4de9897` |

- Budget 350 KB (358,400): missed by about 194 KB; gate stays at 600,000 B (headroom about 47 KB). Locked storage stake at 1e-5 NEAR per byte: 5.5 NEAR for 552 KB [ESTIMATE from the formula; the testnet core holds 7.99 NEAR after deploy].
- Growth against the G1 closeout is +90 KB, from the new Borsh and JSON code of the genesis state machine, the handoff, the creator gate and `GenesisSpec` (twiggy attribution on a named build: serde_json about 169 KB of 695 KB unoptimised, alloc 60 KB, kruxa_logic 32 KB, views 26 KB, genesis 15 KB + 11 KB, market_link 11 KB).
- One attempt, as DT-X2 allows: `wasm-opt -Oz` on the output saves 0.5 percent (552,286 to 549,583); `opt-level = "s"` is 21 percent larger than `"z"`. Typed views (the named lever) are NOT done: the wasm freezes on Nov 10 and a views rewrite changes every JSON shape the indexer and app read. DECISION-NEEDED if Dami wants the budget met.
- Reproducible build (W1-DC-13): works only after three fixes recorded in `contracts/core/Cargo.toml`: the image tag `0.23.0-rust-1.95.0` does not exist (the newest tag is `0.23.0-rust-1.99.1`, linux/amd64 only, so it runs under emulation on Apple silicon, 5 min 37 s), `image_digest` must be set, and `package.repository` must be non-empty. cargo-near also needs the temporary clone to be visible to Docker (set `TMPDIR` under `/Users`; `/var/folders` and `/private/tmp` are not shared). The NEP-330 build info embeds the repository URL and commit, and the repository URL is currently a PLACEHOLDER (no remote exists, push is DC-G): the registered hash is therefore valid only after the real repository URL is set and the freeze commit is final. The reproducible build uses rustc 1.99.1 while the tests ran on 1.95 locally; the gas run recorded below straddled both builds (the container build replaced `target/near/kruxa_core/kruxa_core.wasm` at 12:44:47, after the sandbox suite had started), so the numbers are valid for either; the final G1 run (see the report) used the local build only.

## B-INTAKE, B-PAYOUT (gas, SANDBOX, `BENCH=1 ./scripts/gate-g1.sh`, Tgas burnt over all receipts of one call, 85-test suite)
| call | samples | max | median | static allowance |
|---|---|---|---|---|
| ft_on_transfer (USDC `ft_transfer_call` included) | 345 | 7.4 | 7.3 | 20 (GAS_OUT) |
| execute_intents (S3 `mt_on_transfer` included, mock and real Verifier) | 250 | 12.4 | 7.6 | n/a (relayer attaches) |
| walk | 14 | 12.9 | 8.2 | |
| claim_refund | 25 | 10.7 | 8.1 | 20 + 25 |
| settle_positions_page (25 positions) | 25 | 9.9 | 6.9 | |
| claim_tokens | 2 | 8.1 | 8.1 | |
| consolidate | 3 | 11.4 | 11.4 | 100 |
| draw | 11 | 7.5 | 2.2 | 20 + 25 |
| pay_launch_fee | 9 | 7.4 | 7.4 | 20 + 25 |
| settle | 34 | 3.0 | 3.0 | |
| open_market (two legs and callbacks, market included) | 10 | 22.2 | 12.3 | 2 x 90 + 2 x 25 |
| commit_genesis (about 14 holders) | 12 | 4.1 | 2.2 | scales with holders [ESTIMATE: 0.1 Tgas per holder, under 10 Tgas at the 50-holder ladder cap] |
| build_root_page (6 leaves) | 7 | 3.3 | 2.3 | |
| confirm_genesis | 6 | 2.7 | 2.1 | |

No measurement is near 70 percent of a static allowance, so `GAS_OUT` and `GAS_CB` stay as they are. Methods the sandbox did not exercise with a large payload (a 25-leaf page, `commit_genesis` at the holder cap) are ESTIMATES.

## B-STORAGE
`cargo test -p kruxa-tests --test bench -- --nocapture` (SANDBOX, `storage_usage` delta of the core account): a NEAR position 366 bytes, a Solana position 399 bytes, a second commit by the same holder 0 bytes. The earlier 330-byte figure was an estimate; the bond formula (`bond_required`) should be re-checked against 399 bytes (DECISION-NEEDED for A: it is a bond for position storage, so it must cover the larger Solana position).

## Testnet deploy of the Wave 1 stack (Task 2.1, TESTNET)
Accounts under `kxa1-owner-1203.testnet`: `core`, `usdc`, `intents`, `factory` (mocks), `guardian`, `treasury`, `relay-fees`; core initialised with profile `demo`. `view_code` sha256 equals the built wasm for all four contracts (core `d624d9ec3f15e0dab696ff73b8379258e0468b55bee62785bcf9a9b872befded`, the 463 KB pre-genesis build). Keys live only in `~/.kruxa-secrets/core-testnet/home/.near-credentials` (mode 600). Core has one full-access key (the deployer's), disclosed; no key deletion was done. This deployed core predates D-1 to D-3 and the genesis methods; redeploy the final wasm after the freeze.
