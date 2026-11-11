# Core change: dissolve after a walk (LIMITATIONS item 21)

Authorized by the owner on 2026-11-11. Branch `worktree-agent-a1e7c69cf23dcff3b`. No freeze row, `artifacts/SHA256SUMS` or deployed account was touched.

## The change

`contracts/core/src/lifecycle.rs`, `try_delete_position`: the guard `!pos.settled ||` is removed. A walker (`walk` during Open) has `open == 0`, so `settle_position_inner` has nothing to settle and never marked it settled; its record, and `positions_live`, stayed forever, so `dissolve` and `reclaim_bond` refused with `R_NOT_CLEAR`. The record is now deleted when its refund callback lands.

Why this keeps every money-safety invariant:
- Deletion still requires `owed + inflight + open == 0` (every unit refunded or spent) and, on a PASS launch, the token claim rules. A position with a refund in flight, or a refund leg that failed (money back in `due`), is kept, so a callback can always find it to re-credit.
- A funder with `open > 0` is never deleted. After settlement every funder has `settled == true` or `open > 0`, so removing the `settled` test only newly admits positions with `open == 0` that were never settled, which are exactly the walkers.
- `positions_unsettled` counts only funders with open money at the verdict (`active_funders`), so a walker was never in it; deleting does not touch it.
- Caps are unaffected: the wallet cap reads `open()`, `max_holders` reads `holder_count`, which never decreases. A walker who commits again after deletion gets a fresh record with a new `seq`.
- ABI, events and storage layout are unchanged (the `Position` struct is identical).

## Tests (all pass)

- Unit (`contracts/core/src/token_claims_tests.rs`, 7 new): deleted on Open and Failed once the refund lands (record, `seq_index`, `positions_live`, ledger `credited == refunded`); dissolve succeeds afterwards; dissolve refused while the refund is in flight; a failed refund leg keeps the record and the due money and blocks dissolve; a partial resolution never deletes; a funder with open money is never deleted; dissolve refused while any other position is live.
- Sandbox (`tests/tests/lifecycle.rs`, `walk_then_fail_still_dissolves_and_returns_bond`): 5 buyers, one walks, re-commits and walks again, a second walks, FAIL, dissolve refused while 3 refunds are due, refunds, `positions_live == 0`, `dissolve`, `reclaim_bond` returns the bond.
- Results: `cargo test -p kruxa-core --lib` 29 passed; math and logic 64 passed; the full sandbox suite `cargo test -p kruxa-tests --no-fail-fast` 33 binaries, 321 passed, 0 failed (includes `lifecycle` 11 with the new test, `adversarial` 18 with 2 ignored, and the attack gallery 100 passed). The attack gallery rewrote `evidence/attack-gallery/records`; those changes were reverted, not committed.

## New artifact

- Local (non-reproducible, `scripts/build.sh`): `target/near/kruxa_core/kruxa_core.wasm`, 674,996 bytes, sha256 `4771da48d5b8268431124b799e398318462e72df9fdbd98e3e18fe9888aaa949`.
- Reproducible (docker cargo-near 0.23.0, rust 1.99.1): 655,376 bytes, sha256 `f83c6232325d0aa4a40fc822130b6b0c9f9cc130ba0b410593b20737240e20ae` (two runs from the same snapshot gave identical bytes). Limit is 700,000. Caveat: cargo-near embeds the source revision of the build checkout in the wasm (NEP-330 `source_code_snapshot`). This hash was built from an exported snapshot of the source commit in a scratch repo (the worktree sits inside another repo, which cargo-near cannot clone), so the embedded revision is the scratch one. The authoritative reproducible hash is the one produced from the final committed tree you freeze: rebuild there (`TMPDIR=<dir under /Users/MAC> cargo near build reproducible-wasm`; the docker mount needs a shared path) and use that hash.

## What must be re-done (nothing here has been done)

1. Decide the commit to freeze, then run `scripts/build-artifacts.sh` (reproducible) on that clean tree; it rewrites `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.reproducible`, `artifacts/kruxa_core*.wasm` and `BUILD-KIND`. Record the new sha256 and size.
2. Update every place that names `665caab5...`: the freeze row and `gate-freeze.sh` record, `EXPECT_SHA256` in deploy commands, the `verify.sh` CODE sums file, README, SUBMISSION_STATUS and LIMITATIONS "reproducible core" text, and evidence files that quote the hash.
3. Deploy to a fresh testnet account (core5; do not upgrade core4, its evidence names the old hash): `KXI_CORE_WASM=artifacts/kruxa_core.reproducible.wasm EXPECT_SHA256=<new> node scripts/core-testnet/deploy.mjs core`, then redeploy and relink market and the launcher against it (`set_market`) and re-seed.
4. Re-run the testnet lifecycle that exposed the limit: `lifecycle-fail.mjs open` and `finish` with walkers, then `dissolve` and `reclaim_bond`; expect `Dissolved` and the creator bond returned. Add the transcripts under `evidence/` and remove LIMITATIONS item 21.
5. Re-run the judge (`make judge`, `scripts/gate-g1.sh`, `gate-g2.sh`, `gate-g3.sh`), the attack gallery and the full sandbox suite on the frozen commit; refresh `evidence/judge-run.txt`, the gate evidence and `docs/ATTACK-GALLERY.md`. Earlier testnet evidence stays valid only for the old hash and must be labelled as such.
6. Re-run the swarm and `verify.sh` against the new account, since the CODE check compares `view_code` with the sums file.
