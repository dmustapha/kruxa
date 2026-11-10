# Submission status

Last updated: 2026-11-10 (docs-sync after the final core build and testnet round 2). Every row cites a file in the repo or says it has none. "Proven" means a committed run record exists; "built" means the code exists. Honest limits are in `LIMITATIONS.md`; unproven items are in `PROOF-DEBTS.md`.

## 1. Snapshot

| Fact | Value | Source |
|---|---|---|
| Testnet core | `core3.kxi-root-1108.testnet`, `demo` profile, wasm sha256 `e85198ed37c2aa1d6cd5f18571f5e023eed391108ca8f22edc8599ac390e65ac`, 675,007 bytes, local non-reproducible build | `view_code` read from testnet RPC 2026-11-10; `artifacts/SHA256SUMS` |
| Wasm budget | 700,000 bytes (Dami, 2026-11-10) | `scripts/lint.sh`, DECISIONS-PACK1 seventeenth block |
| Reproducible candidate | `d362ffa2...`, 655,251 bytes, NOT deployed, built before `R_GAS` | `artifacts/SHA256SUMS.reproducible`, `rehearsal/LOG.md` |
| Mainnet | nothing deployed | none |
| Attack gallery | 100 attacks: 81 refused with a rule code, 14 no effect, 5 bounded, 0 failed, 10 not done (sandbox hashes, own red team) | `docs/ATTACK-GALLERY.md` |
| Fast judge run | 19 of 19 steps GREEN, 553 s, git `b4b4c8a`; no full-run record | `evidence/judge-fast-run.txt` |
| Gate G3 | NO-GO as last recorded (GR-3, 7, 8, 9, 11, 13, 14, 17) | `evidence/testnet-core3/gate-g3.txt` |
| Gate G2 | GREEN 9 of 9 on core3 (G2-01 read the Nov 8 gate-g1 logs, not a re-run) | `evidence/testnet-core3/gate-g2-round2.txt` |

## 2. Deliverables

### Built and proven (a committed record exists)

| Deliverable | Proof | Caveat |
|---|---|---|
| Pure crates, `kruxa-sim`, `verify.sh` golden, tamper (exit 2), dead RPC (exit 4) | `evidence/judge-fast-run.txt` (U1, V1, T1 to T5), `evidence/verify-tamper.txt`, `evidence/verify-dead-rpc.txt` | |
| Core lifecycle on NEAR testnet: PASS, FAIL, F0 launch, F1 launch, market trading, keeper | `evidence/testnet-core3/launches.json`, `keeper-*.log`, `verify-2-pass.txt`, `verify-3-fail.txt`, `market-flows.json` | play money; mock USDC, mock Intents, mock factory |
| Solana genesis F0 through the contract gate | 3 of 3 (launches 2, 5, 6) plus a 4th (launch 8), `verify.sh` exit 0, tamper-all exit 2 | `evidence/genesis/core3-f0-devnet-launch*.json`, `rehearsal/ROUND2.md`; the 4th ran on `e338f84d...`, not on the deployed `e85198ed...` |
| F1 fallback ceremony | launch 4, C16 now passes after the key sweep | `evidence/testnet-core3/verify-4-f1.txt` |
| S3 against the real `intents.near` wasm | 6 sandbox tests on the hash-pinned wasm | `tests/tests/real_intents.rs`, `fixtures/intents_near.wasm` |
| Real factory facts (cost kept, no `ft_burn`, `create_token` gas, repeated `storage_deposit` refunded) | `evidence/factory-probe.txt`, `evidence/testnet-core3/real-factory-probe.json` | testnet factory only |
| Attack gallery (100 attacks) | `evidence/attack-gallery/`, `docs/ATTACK-GALLERY.md` | sandbox; not an audit |
| Swarm simulator, `make sim`, market demo, tour | `evidence/swarm.txt`, `evidence/sim.txt`, `evidence/market.txt`, judge-fast M2, M3, W1, O1 | simulation, not a forecast |
| Squads reserve (devnet rehearsal) | `evidence/genesis/squads-devnet-*.txt` | single-party demo vault |

### Built, not yet proven live or not re-run on the final build

| Deliverable | What is missing |
|---|---|
| Core sandbox suites on the final wasm | the last committed gate-g1 logs are from Nov 8; re-run `./scripts/gate-g1.sh` at the freeze |
| Instant launcher (`contracts/instant`) | ran on testnet against the real factory (`evidence/instant-testnet/run2`); not on mainnet; the launcher has no reproducible build |
| Core to real-factory `create_trial` | not run: the factory account is fixed at `new` and a fresh core needs about 7 NEAR; only direct factory probes were run (`rehearsal/ROUND2.md` step 2) |
| Indexer, API, app, relayer test suites | no committed run record for them (the fast judge subset does not run them); live testnet ingest by the indexer is not recorded [UNVERIFIED] |
| App against a real wallet | PD-1, PD-2, PD-3, PD-5 need Dami and a real wallet |
| Meteora DAMM v2 | devnet spike partial (`spikes/meteora/RESULTS.md`); PDA-owned position and delegate claim not run |
| Test 1 (OV4, OV15) | RECORDED but thin: only the OV15 NEAR tx hash was kept; no OV4 tx hashes; OV3 unproven |
| Thesis pack | `evidence/thesis.txt` exists; the dashboard review (PD-15) is Dami's |
| Reproducible build | candidate exists and is not deployed; `artifacts/SHA256SUMS` hashes the local build |
| `Dockerfile.judge` and `make judge` | exist; no clean-container run recorded; full run about 2,454 s |

### Missing

| Deliverable | Note |
|---|---|
| Full `make judge` record (`--record`) | must run before submission |
| Fresh-agent run (`rehearsal/fresh-agent-*.md`) | not run |
| Verdict Rail (SAS attestation) | cut: stretch |
| Hold Vault, referral lots, ratchets, payees (market M-B) | after Nov 14 by ruling |
| Mainnet deployment, `$KRUXA` Genesis Round, capped beta | every step needs Dami's per-action confirmation |
| Live `verify.sh` on a mainnet launch | follows the Genesis Round |
| README regenerated against the final judge run | regenerated and linted later; not edited in this sync |
| Demo video, X post, repo public, submission form | `submission/` is empty |
| NFTs, business, agents tracks | not built (agents cut by CO-6 E-2) |

## 3. Open items that only Dami can do

1. Three hardware wallets and two named independent Squads signers (BLK-1; needed before third-party creators open, not for the Genesis Round).
2. The X account and the X post.
3. README headline wording (OPTIONS in PRD 1.1), and the AMEND line for the DEMO OBLIGATION (CHANGE-ORDER-6 section 7).
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

See `LIMITATIONS.md` section 1 for the 17 honest limits that exist now (owner key and upgrade queue, `halt_launch`, force-resolve, solvency report, `burn_mode`, F0 gate, no audit, no mainnet, local build hash, verify skips, Test 1 receipts, and more). Open rulings: README headline, reserve split details, brand-token supply, GR-17 amounts, USDC payout address, Squads independents.
