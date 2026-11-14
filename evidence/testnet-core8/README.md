# core8: INTERMEDIATE core (047567d9), superseded

`core8.kxi-root-1108.testnet` runs the reproducible wasm `047567d95fa19981d5c1e8957528dd6dbcef59ef4509b028215075ca62245ac6` (655,992 B, commit `712d676`):
guardian-and-owner freeze barrier, private `new`, 12 hour minimum commit window, Instant views and announced open merged.
It is NOT the submitted core: the final core also carries the $100 launch bar (`docs/CORE-CHANGE-LOWER-BAR.md`) and the real repository URL in its NEP-330 metadata, so it has a different hash.
The evidence here is kept as proof that those changes work on a live chain; the final hash gets its own `evidence/testnet-core9/`.

| What | Result | Where |
|---|---|---|
| deploy, `view_code` equals artifact, private `new` through the deploy script | OK | `deploy-core8.log`, `deploy-market6.log` |
| launch with walkers (NEAR key and Solana signature), FAIL, refunds, `dissolve`, creator `reclaim_bond` (+0.1957 NEAR) | OK | `lifecycle/` |
| swarm seed 2 (FAIL, sniper and walk-flipper; walkers' records deleted) | GREEN 47 of 47 | `../swarm-testnet/run-seed2-core8-run1*` |
| swarm seed 1 | GREEN 56 of 56 | `../swarm-testnet/run-seed1-core8-run1*` |
| swarm seed 3 | GREEN 49 of 49 | `../swarm-testnet/run-seed3-core8-run1*` |
| refund and dissolve of the failed swarm launch (global held 0) | OK | `refund-dissolve-swarm-seed2.log` |
| sandbox suite on these bytes | stopped after 97 tests ok, 0 failed (superseded by the final hash) | `../core-wasm-bytes/sandbox-suite-047567d9.log` |
