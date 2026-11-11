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
