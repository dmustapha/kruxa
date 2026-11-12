# core7: the dissolve-after-walk core on NEAR testnet (play money)

Account `core7.kxi-root-1108.testnet`, a fresh `new` deploy of `artifacts/kruxa_core.reproducible.wasm`
(sha256 `c55bffdbdec7909464c65511219ec77be7d8f765bc037a46350efe713cb8b13b`, 655,376 bytes, built by
`cargo near build reproducible-wasm` from commit `5c2874d139a453839ec544431df0101b4b2cedeb`, two runs byte-identical).
`view_code` on the account equals that hash (`deploy-core7.log`). core3 to core6 are untouched and still run the old hash `665caab5...`.

## What this proves (LIMITATIONS item 21, now closed)

Launch 1 (`LCY1`, 10 funders at 36 USDC: 3 NEAR keys, 7 Solana-delivered through the mock Intents):
1. 10 of 10 commits landed (`lifecycle/open.log`).
2. In the tail one NEAR holder `walk`ed and one Solana holder `walk_signed`; settle gave FAIL; every refund was paid
   (360 USDC back, the core holds 0 USDC; `lifecycle/views-fail-5-after-refunds.json`).
3. `dissolve` was refused with `R_NOT_CLEAR` before the verdict and while refunds were due, then **succeeded** once every refund cleared:
   status `Dissolved`, `get_invariants` all_ok true, all 10 position records deleted, including the two walkers
   (`lifecycle/finish.log`, `lifecycle/views-fail-6-after-dissolve.json`). On the old wasm (core4 launch 3) the same step stayed `R_NOT_CLEAR`.
4. `reclaim_bond` by the creator succeeded: the 0.195 NEAR bond came back (`lifecycle/reclaim-bond.log`, tx `gzcmhaZ8ZeqijCBzAEKjXHhbZDqYqemKsRHnE4HzYX3`).

Behaviour change to know: a walker whose refund has landed has no record any more, so a second `walk` by the same key returns
`R_NO_POSITION` (the old wasm said "nothing active"). The script label still reads "expect refused: nothing active"; the refusal is the point.

Funding: 6 NEAR of testnet play money moved from `kxi-root-1111` to `kxi-root-1108` (logged in `lifecycle/txlog.jsonl`).
Not covered here: market linking, swarm, `verify.sh` and Solana genesis on core7 (see the follow-up files in this directory when present).

## Later additions (same day)

- Swarm seeds 1, 2 and 3 on core7, all GREEN (56 of 56, 47 of 47, 49 of 49); seed 2's first run was RED because the runner still expected a record for walkers (kept, `evidence/swarm-testnet/run-seed2-core7-run1-RED-walker-record-deleted.json`), and failed launches 3 and 4 were refunded and dissolved afterwards (`refund-and-dissolve-launches-3-4.log`).
- PASS launch 2: keeper, market5 pool (`market-flow-launch2.log`), `verify.sh 2` exit 3 only because swarm trials have no Solana genesis (`evidence/verify/core7-launch2-PASS-with-market5*.txt`).
- F0 launch 6 (`seed-K-f0.log`, `keeper-launch6-f0.log`, `evidence/genesis/core7-f0-devnet-launch6.json`): verify exit 0 and tamper-all exit 2 (`evidence/verify/core7-launch6-F0*.txt`), gate-g2 GREEN 9 of 9 (`gate-g2-core7.txt`). The first seed attempt's `create_trial` was never included in a block (creator balance too low, kept as `seed-K-f0-attempt1-...log`); the first driver start failed before sending anything (missing `tools/squads` install, kept in `evidence/genesis/`).
- gate-g1 (`gate-g1-final.txt`): 12 of 14 rows PASS; G1-11 (secret scan: the scan matched public keys in verify outputs, allowlist extended in `scripts/secret-scan.sh`) and G1-13 (another project's `next-server`, left running). gate-g3 (`gate-g3-final.txt`): NO-GO, blocked only by rows that need Dami plus GR-10 (clock).
