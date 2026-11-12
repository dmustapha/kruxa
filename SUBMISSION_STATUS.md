# Submission status

Last updated: 2026-11-11 (docs-sync after round 4, the full judge record, the indexer ingest and SW-2). Every row cites a file in the repo or says it has none. "Proven" means a committed run record exists; "built" means the code exists. Honest limits are in `LIMITATIONS.md`; unproven items are in `PROOF-DEBTS.md`.

## 1. Snapshot

| Fact | Value | Source |
|---|---|---|
| Testnet core | `core7.kxi-root-1108.testnet` (market5 linked), `demo` profile, wasm sha256 `c55bffdbdec7909464c65511219ec77be7d8f765bc037a46350efe713cb8b13b`, 655,376 bytes, reproducible container build from commit `5c2874d`; `verify.sh` CODE line MATCH, C-04 and C-05 PASS. `core3` to `core6` run the previous `665caab5...` | `artifacts/SHA256SUMS`, `evidence/testnet-core7/`, `evidence/verify/claims-C05-core7.txt` |
| Wasm budget | 700,000 bytes (Dami, 2026-11-10) | `scripts/lint.sh`, DECISIONS-PACK1 seventeenth block |
| Local build | step B1 of `make judge` prints `e85198ed...`, 675,007 bytes: same source, different toolchain, not what testnet runs | `evidence/judge-run.txt`, `rehearsal/LOG.md` R3-6 |
| Mainnet | nothing deployed | none |
| Attack gallery | 100 attacks: 81 refused with a rule code, 14 no effect, 5 bounded, 0 failed, 10 not done (sandbox hashes, own red team) | `docs/ATTACK-GALLERY.md` |
| Full judge run | `make judge`: 20 of 20 steps GREEN, 2,512 s, git `64ea392`; five tracks GREEN (Memecoins With Mechanics, AI Security & Defense, AI Swarms, Investment Thesis, Open Innovation) | `evidence/judge-run.txt` |
| Fast judge run | 19 of 19 steps GREEN, 553 s, git `b4b4c8a` | `evidence/judge-fast-run.txt` |
| Gate G3 | NO-GO as last recorded on 2026-11-10, before rounds 3 and 4; not re-run (GR-3, 7, 8, 9, 11, 13, 14, 17) | `evidence/testnet-core3/gate-g3.txt` |
| Gate G2 | GREEN 9 of 9 on core3 at round 4 (PASS launch 10 on the deployed wasm, FAIL launch 3; G2-01 read the existing gate-g1 logs, not a re-run) | `evidence/testnet-core3/gate-g2-round4.txt` |
| Indexer on testnet | live ingest of core3, market3 and the launcher: 136 checks, 0 mismatches (95 + 41) | `evidence/indexer-testnet/` |
| Swarm on testnet (SW-2) | seed 1 GREEN 56 of 56 on core4 (run 2; run 1 was RED 55 of 56 from a runner funding bug, kept); seed 2 GREEN 51 of 51 and seed 3 GREEN 49 of 49 on the fresh core6 (rounds of 20 s; earlier seed 2 attempts on core5 were RED from RPC latency and a network fetch failure, seed 3 on core5 aborted by a network drop, all kept) | `evidence/swarm-testnet/run-seed1-core4-run2-GREEN.json`, `run-seed2-core6-run1-GREEN.json`, `run-seed3-core6-run1-GREEN.json` |

## 2. Deliverables

### Built and proven (a committed record exists)

| Deliverable | Proof | Caveat |
|---|---|---|
| Pure crates, `kruxa-sim`, `verify.sh` golden, tamper (exit 2), dead RPC (exit 4) | `evidence/judge-fast-run.txt` (U1, V1, T1 to T5), `evidence/verify-tamper.txt`, `evidence/verify-dead-rpc.txt` | |
| Core lifecycle on NEAR testnet: PASS, FAIL, F0 launch, F1 launch, market trading, keeper | `evidence/testnet-core3/launches.json`, `keeper-*.log`, `verify-2-pass.txt`, `verify-3-fail.txt`, `market-flows.json` | play money; mock USDC, mock Intents, mock factory |
| Solana genesis F0 through the contract gate | 7 rehearsals; launch 6 on core7 ran on the submitted `c55bffdb...` (mint, Merkle root matches the core, claim ok, `verify.sh` exit 0, tamper-all exit 2, gate-g2 GREEN 9 of 9); launches 2, 5, 6, 8, 9, 10 on core3 ran on older hashes, launch 10 on the previous `665caab5...` | `evidence/genesis/core7-f0-devnet-launch6.json`, `evidence/testnet-core7/gate-g2-core7.txt`, `evidence/genesis/core3-f0-devnet-launch*.json`, `rehearsal/ROUND4.md` |
| F1 fallback ceremony | launch 4, C16 now passes after the key sweep | `evidence/testnet-core3/verify-4-f1.txt` |
| S3 against the real `intents.near` wasm | 6 sandbox tests on the hash-pinned wasm | `tests/tests/real_intents.rs`, `fixtures/intents_near.wasm` |
| Real factory facts (cost kept, no `ft_burn`, `create_token` gas, repeated `storage_deposit` refunded) | `evidence/factory-probe.txt`, `evidence/testnet-core3/real-factory-probe.json` | testnet factory only |
| Attack gallery (100 attacks) | `evidence/attack-gallery/`, `docs/ATTACK-GALLERY.md` | sandbox; not an audit |
| Swarm simulator, `make sim`, market demo, tour | `evidence/swarm.txt`, `evidence/sim.txt`, `evidence/market.txt`, judge-fast M2, M3, W1, O1 | simulation, not a forecast |
| Squads reserve (devnet rehearsal) | `evidence/genesis/squads-devnet-*.txt` | single-party demo vault |

### Built, not yet proven live or not re-run on the final build

| Deliverable | What is missing |
|---|---|
| Core sandbox suites on the deployed wasm | the full sandbox suite ran on the container bytes `c55bffdb` (324 passed, 0 failed, 0 ignored, pin checked); the earlier pass on `665caab5` had 322 ok and 1 clock-race flake | `evidence/core-wasm-bytes/` |
| Instant launcher (`contracts/instant`) | ran on testnet against the real factory (`evidence/instant-testnet/run2`); not on mainnet; the launcher has no reproducible build |
| Core to real-factory `create_trial` | not run: the factory account is fixed at `new` and a fresh core needs about 7 NEAR; only direct factory probes were run (`rehearsal/ROUND2.md` step 2) |
| API, app, relayer test suites | no committed run record for them (the judge run does not run them); the indexer's live testnet ingest is recorded (see section 1) |
| App against a real wallet | PD-1, PD-2, PD-3, PD-5 need Dami and a real wallet |
| Meteora DAMM v2 | devnet spike partial (`spikes/meteora/RESULTS.md`); PDA-owned position and delegate claim not run |
| Test 1 (OV4, OV15) | RECORDED but thin: only the OV15 NEAR tx hash was kept; no OV4 tx hashes; OV3 unproven |
| Thesis pack | `evidence/thesis.txt` exists; the dashboard review (PD-15) is Dami's |
| Reproducible build | core: done and deployed (core3, core4). Market and launcher: local builds only |
| `Dockerfile.judge` | exists, untested; no clean-container run recorded. The full `make judge` run is recorded (2,512 s) |

### Missing

| Deliverable | Note |
|---|---|
| Fresh-agent run (`rehearsal/fresh-agent-*.md`) | not run |
| Verdict Rail (SAS attestation) | cut: stretch |
| Hold Vault, referral lots, ratchets, payees (market M-B) | after Nov 14 by ruling |
| Mainnet deployment, `$KRUXA` Genesis Round, capped beta | every step needs Dami's per-action confirmation |
| Live `verify.sh` on a mainnet launch | follows the Genesis Round |
| README lint run at HEAD (`make lint-readme`) | no output recorded; the README was edited after the judge record, so `make judge` must run again before `make claimed-tracks` |
| Demo video, X post, repo public, submission form | `submission/` is empty |
| NFTs, business, agents tracks | not built (agents cut by CO-6 E-2) |
| `DESIGN_SYSTEM.md` and `brand.json` (PLAN 6.7) | not built; superseded: the UI followed `APP-SPEC.md` |
| `scripts/rehearse.sh` drills R3 to R10 (PLAN Depth 8) | superseded: the script defines R1 and R2 only; the real rehearsal rows are written by hand in `rehearsal/LOG.md` |

## 3. Open items that only Dami can do

1. Three hardware wallets and two named independent Squads signers (BLK-1; needed before third-party creators open, not for the Genesis Round).
2. The X account and the X post.
3. README headline wording (OPTIONS in PRD 1.1), and the AMEND line for the DEMO OBLIGATION (CHANGE-ORDER-6 section 7). Until then the judged demo is NEAR testnet and Solana devnet plus the no-funds path (`make judge`), and mainnet appears only after Dami's per-action confirmation.
4. Hosting accounts and the domain (tier 2 through Nov 25).
5. Legal counsel review of the legal pages.
6. GR-17 numbers: brand-token supply and allocation, USDC payout address, pool and LP-seed amounts.
7. The go or no-go decision at the gate.
8. Every mainnet action (deploy, Genesis Round, beta, any money move), each by per-action confirmation.
9. Real-wallet tests: PD-1, PD-2 (Phantom byte-exactness), PD-3, PD-5; the full-access key decision (E-5).
10. Approval of the demo video.
11. Making the repo public, publishing the X post, and the one-shot submission (deadline Nov 14 23:59 UTC; plan: submit by 18:00 UTC).
12. The thesis dashboard review (PD-15) and the Arcos link (DN-25), if wanted.

## 4. Known limitations and blockers

See `LIMITATIONS.md` section 1 for the 19 honest limits that exist now (owner key and upgrade queue, `halt_launch`, force-resolve, solvency report, `burn_mode`, F0 gate, no audit, no mainnet, local build hash, verify skips, Test 1 receipts, and more). Open rulings: README headline, reserve split details, brand-token supply, GR-17 amounts, USDC payout address, Squads independents.
