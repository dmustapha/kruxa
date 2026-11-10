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
