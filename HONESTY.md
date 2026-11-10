# Honesty Ledger

Every disclosure Kruxa makes, with the document or test that proves it.

1. No independent audit has covered this code. Proof: `SECURITY.md` "Not defended against" item 5; `docs/INVARIANTS.md`.
2. The Squads reserve vault in the demo is single-party. Proof: `LIMITATIONS.md` (single-party vault); `docs/INVARIANTS.md`.
3. The launch-token factory token is publisher-updatable. Proof: `SECURITY.md` item 4; `LIMITATIONS.md`.
4. The Intents Verifier holds force-withdraw and lock powers over money held in `intents.near`. Proof: `SECURITY.md` item 3.
5. The relay fee is not refunded. Proof: `docs/INVARIANTS.md`.
6. A NEAR-side token exists from the start of a trial. Proof: `docs/INVARIANTS.md`.
7. In phase 0 the upgrade key is held by Dami. Proof: `SECURITY.md` item 2; `docs/INVARIANTS.md`.
8. The sandbox runs protocol 88 and mainnet is recorded as 88 on 2026-11-08; real-network acceptance is untested until the testnet deploy. Proof: `SECURITY.md` item 6; `ARCHITECTURE.md` Section 17.
9. The kruxa_core wasm (675,007 bytes) is over the original 350 KB target; the budget is 700,000 bytes (Dami, 2026-11-10). Proof: `scripts/lint.sh` prints the size against its gate; `docs/benchmarks.md` B-WASM; `LIMITATIONS.md`.
10. Sybil wallets are not defended against. Proof: `SECURITY.md` item 1.
11. The owner full-access key bypasses the 7-day upgrade queue; the queue delay is 60 s on the demo profile. Proof: `SECURITY.md` item 2; `evidence/testnet-core3/verify-8-f0.txt` (KEYS line).
12. `halt_launch` and the 48 h `force_resolve_op` are owner powers; neither can block an exit or change a verdict. Proof: `docs/interfaces/CORE-ABI.md`; `LIMITATIONS.md` limits 2 and 3.
13. The solvency report is informational and can only pause new Intents commits. Proof: `contracts/core/src/solvency.rs`; `LIMITATIONS.md` limit 4.
14. `burn_mode` is `Hold` by default: nothing is burned. Proof: `evidence/factory-probe.txt`; `LIMITATIONS.md` limit 5.
15. The F0 gate cannot prove the registered hash equals the compiled transaction; verify C17 does. Proof: `LIMITATIONS.md` limit 6.
16. The testnet core is a local non-reproducible build; the reproducible candidate has a different hash. Proof: `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.reproducible`.
17. Test 1 receipts are thin: only the OV15 tx hash was recorded. Proof: `evidence/test1-ov4.json`, `evidence/test1-ov15.json`.
18. Mainnet is not deployed. Proof: `SUBMISSION_STATUS.md`.
