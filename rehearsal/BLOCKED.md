# Blocked or not done (core3 testnet run, 2026-11-10)

| Item | State | Why |
|---|---|---|
| `scripts/verify.sh instant <id>` | not run | The subcommand does not exist (REMAINING C2, 0.3 AD, unbuilt). Nothing to run. |
| `scripts/swarm-testnet.sh` (SW-2) | not run | It is a stub that exits 2 ("NOT IMPLEMENTED"); the runner it describes is an unbuilt piece and a cut candidate. |
| Reproducible build of the wasm | not done | `build-artifacts.sh` without `--local` needs docker and a clean committed tree. `artifacts/SHA256SUMS` is the NON-reproducible local build (`artifacts/BUILD-KIND`). The verify `CODE:` line wording says "reproducible build sha256" even for this kind; it matches. |
| GR-14 FREEZE row (`gate-freeze.sh freeze`) | not written | The freeze is Dami's Nov 10 20:00 decision. gate-g3 GR-14 stays UNKNOWN until that row exists. |
| GR-3, GR-7, GR-8, GR-9, GR-11, GR-13, GR-17 | not mine | Intents path ruling, Squads hardware rehearsal, disclosure pages, legal minimum, Dami confirmations, Meteora devnet signatures, brand-token rulings. |
| verify C23 (event enumeration), C10, C22, C25 | still SKIP | Plain RPC cannot list a contract's `genesis_committed` / `genesis_confirmed` events (needs an archival indexer); no hosted metadata JSON; no creator allocation in these records; no Verdict Rail attestation. |
| Core with the REAL factory | not testable here | `create_token` is sent with 80 Tgas (`contracts/core/src/token.rs`); the factory needs 91 to 95 Tgas (evidence/instant-testnet findings, runbook section 3). A core `create_trial` against `token.primitives.testnet` should end `CreationFailed`. Core change = Dami's freeze decision. |
| Refund claims of FAIL launch B | not exercised | The keeper settled B (verdict FAIL, 5 positions settled). Per-holder refund pulls and `dissolve` were not run. |
| Funding | the 2 NEAR root reserve was crossed once | See rehearsal/LOG.md row "reserve". Restored to 2.19 NEAR before the last transactions. A further launch would need about 2.2 NEAR more (one 1.8 NEAR mock-FT token account plus gas). |

## Round 2 (2026-11-10, final wasm e338f84d)

| Item | State | Why |
|---|---|---|
| Core create_trial against the REAL factory end to end | NOT run | The factory account is fixed at `new` (no setter in contracts/core/src/admin.rs), core3 was initialised with the mock factory, and a second core account (`core4`) would lock about 7 NEAR of storage; play money did not allow it. Proven instead: the real factory accepts create_token at 110 Tgas (tx 5oLd9c4UwpuHcKNA4oY9qJzscFioEUpKVnh6vU34Xe1k) and rejects 80 (tx 6WymoWoxhQf38NSQCSf9uUnrbDyM53p1Qdhtzo4pgypT); the mock factory enforces 95 and the core passed it on launch 8. Not covered: the core's own callback chain against the real token (`verify_token` on a real factory token). |
| Reproducible wasm on core3 | not matching | Reproducible core is d362ffa2... (655,251 B); core3 runs the local build e338f84d... (674,863 B). artifacts/SHA256SUMS stays the local build so verify's CODE line matches the chain; the reproducible hash is in artifacts/SHA256SUMS.reproducible and a CANDIDATE row. Freeze + redeploy of the reproducible bytes is Dami's call, and the sandbox suite has not been run against the reproducible bytes. |
| Reproducible market and launcher | not buildable | contracts/market and contracts/instant have no `[package.metadata.near.reproducible_build]`. Adding it changes those crates (decision). |
| Caller gas for create_trial | finding | 150 Tgas (documented in docs/runbooks/testnet-core2.md and used by seed.mjs until now) starves the creation callback since create_token takes 110. Launch stays Creating until `finalize_creation` after 10 minutes. 300 Tgas works. Any frontend or doc that says 150 is stale; this needs a decision on the minimum to publish (suggest 300, or a require! on prepaid gas in create_trial so it fails loudly instead of leaving a Creating launch and a locked creator). |
| Launch 7 | open record | KXCG (creator-b) was brought to Open/Ready by finalize_creation but has 0 funders and a past commit window; it is a dead launch. creator-b has an active trial until it is settled (FAIL) and cleaned up. Not needed for any gate. |
| gate-g1 / sandbox suites | not re-run | G2-01 reads the Nov 8 target/gate-g1 logs; the shared machine rule forbids the sandbox suites. |
