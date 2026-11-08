# Swarm rules: the crowd test game

Status: P1 (recorded, scripted, offline). Owner: workstream T1. Code: `tools/swarm-sim`. Output shape: `docs/interfaces/SWARM-OUTPUT.md`.

This is collective purchasing, not an auction. Many buyers pool USDC into one trial. Everyone who is accepted pays the same price. The only thing a buyer chooses is how much to commit and whether to Walk. Nothing in the game is discretionary: the verdict and the allocation are the real `kruxa-logic` functions (`verdict`, `allocate`, `settle_position`) and the clocks are the real `phase_at` and `walk_window_open`. The simulator never re-implements that math.

What this is NOT: no model-driven agents (cut by CHANGE-ORDER-6 E-2), no sellers, no sealed bids, no real chain. All 16 agents are our own scripted strategies. It tests the rules against hostile behaviour we thought of; it does not prove no other attack exists.

## 1. The trial

One trial, parameters from `TrialParams::example("SWARM")` run through `validate_params` with the `Rules::ladder()` profile (so every limit below is the real, validated one):

| Parameter | Value | Where it bites |
|---|---|---|
| hard cap H | 1,000 USDC | the most the creator can take (`accepted = min(sigma, H)`) |
| soft cap | seed-chosen, between the validated floor and H | verdict `BELOW_SOFT_CAP` |
| min funders | 10 | verdict `BELOW_MIN_FUNDERS` |
| min buy | 20 USDC | `R_MIN_CONTRIBUTION` |
| per-wallet cap | max(ceil(H x 200 / 10000), 5 x min buy) = 100 USDC | `R_CAP_ACCOUNT` |
| oversubscription ceiling | H x 20000 / 10000 = 2,000 USDC | `R_CAP_LAUNCH` |
| sale / LP / creator / backer buckets | 60 / 25 / 10 / 5 percent | tokens sold = `n_sale` |
| stream | 30 days linear from PASS | `STREAM_CAP` |

Recorded runs: seeds 1 to 3 are named presets (seed 1 warm crowd with a comfortable pass; seed 2 a crowd just below the soft cap that a last-minute sniper rescues and the walk-flipper then undoes; seed 3 a cold crowd that fails on its own). Seeds 4 and up draw the soft cap (350 to 1,000 USDC) and the honest budget scale from the seed. The presets were chosen to show the three shapes, not found by searching for flattering results; the sweep in `make swarm` covers hundreds of other seeds.

Time is 24 rounds. A round is one tick of a synthetic clock (`now = round`). `opens_at = 0`, `commit_end = 20`, `walk_end = 24`:

- rounds 0 to 19: the commit window (`Phase::Open`). Commit and Walk are both allowed.
- rounds 20 to 23: the tail (`Phase::Closing`). Commit is refused (`R_WRONG_PHASE`). Walk is still allowed.
- after round 23 (`now = 24`): `Phase::Ready`. Walk is refused (`R_WALK_CLOSED`); anyone may settle.

Walk and settle can never both be open at an instant (the kruxa-logic boundary test proves this; the simulator probes it at `now = 24`).

## 2. Actions

Each round every agent acts once, in a seeded random order, seeing the public book as it stands at that moment (total committed, funder count, caps, margin). Actions:

- **Commit(amount)**: add USDC to the agent's single position. Admission (mirrors the contract's `check_commit`, same rule codes): phase must be Open; net amount at least min buy; the agent's open position plus the amount at most the per-wallet cap; funders below the holder cap; total committed plus the amount at most the oversubscription ceiling. A refused commit changes nothing and is logged with its rule code.
- **Walk**: allowed from `opens_at` until `walk_end` (exclusive). The whole open position returns to the agent's wallet at once. The funder count drops by one. There is no partial walk and no penalty.

Nobody can move USDC out of the book any other way. The creator draws nothing during the trial (see section 5).

## 3. Settlement (after round 23)

1. **Verdict**: `verdict(VerdictInputs { total_active, active_funders, soft_cap, min_funders, cancelled: false })`. PASS needs `total_active >= soft_cap` AND `active_funders >= min_funders` (both inclusive). Otherwise FAIL with reason bits. Pure integers; no clock, no discretion.
2. **FAIL**: every position is refunded in full. Spend is zero for everyone.
3. **PASS**: `allocate(total_active, H, ...)` gives `accepted = min(total_active, H)` split into launch fee, LP quote, creator stream and the excess. Then for each position with commit `c_i` and `sigma = total_active`:
   - `spend_i = ceil(c_i x accepted / sigma)` (charged amounts round UP)
   - `refund_i = c_i - spend_i`
   - `tokens_i = floor(c_i x n_sale / sigma)` (paid amounts round DOWN)
   - the rounding residue (`sum spend - accepted`, under one unit per buyer) and token dust go to the LP bucket.

   When `sigma <= H` nothing is refunded and every token still sells (a cheaper price). When `sigma > H` the sale is oversubscribed: everyone is scaled back by the same ratio `H / sigma`. The clearing price is `accepted / n_sale` for every buyer; there is no way to pay less per token than anyone else.

## 4. Agents (16)

Seven honest backers, each with a budget between 20 and 100 USDC (seeded) and one risk rule:

| Id | Type | Rule |
|---|---|---|
| H1 steady | honest | commits the whole budget early (rounds 0 to 3) |
| H2 dca | honest | commits 20 USDC at a time in rounds 2, 5, 8, 11 until the budget is spent |
| H3 cautious | honest | waits until the book holds a quarter of the soft cap, then commits (gives up after round 17) |
| H4 fill-averse | honest | commits early; in the tail Walks if the book is oversubscribed beyond 1.5x (fill would drop under 67 percent) |
| H5 small | honest | one small commit (20 to 40 USDC) in rounds 12 to 16 |
| H6 top-up | honest | half the budget at round 1; the other half at round 14 only if the book is currently passing |
| H7 nervous | honest | commits at round 6; in the tail Walks if the pass margin is under 10 percent of the soft cap |

Nine adversaries (our own scripts):

| Id | Type | Attack tried |
|---|---|---|
| W1, W2 whale | adversary | try to dominate the pool: attempt a commit far above the per-wallet cap (W1 at round 0, W2 at round 8), get refused `R_CAP_ACCOUNT`, then commit the cap and keep trying to top up |
| S1, S2 sniper | adversary | commit in the last commit round (19). S1 (rescuer) only if the book is failing and one wallet cap would lift it over the line; S2 always. Both also try to commit in the tail (refused `R_WRONG_PHASE`) |
| Y1 to Y4 sybil ring | adversary | one controller, four accounts. Y1 first tries a single 4x-cap commit (refused), then the ring commits one cap per account in staggered rounds to get 4x the per-wallet cap |
| F walk-flipper | adversary | commits the cap at round 4; in the tail watches the public margin and, on the last tail round, Walks if that single Walk would drop the book below the soft cap or the funder floor, flipping PASS to FAIL |

## 5. Invariants (asserted after EVERY round, and again at settlement)

At the end of each round the simulator runs the checker on the whole book and, on a copy, a hypothetical settlement "as if settle ran now". A violation is printed with its round and the run exits non-zero.

| Id | Statement |
|---|---|
| C1 conservation | sum over agents of (wallet + open position) equals the total funds the agents started with. After settlement: wallets + sum of spend equals the starting funds |
| C2 ledger | the running ledger counters (total committed, funder count), updated on each commit and Walk like the contract does, equal the values recomputed from the positions |
| K1 per-wallet cap | no position exceeds the per-wallet cap |
| K2 launch caps | total committed never exceeds the oversubscription ceiling; funder count never exceeds the holder cap; every open position is at least min buy |
| A1 entitlement | `tokens_i <= floor(c_i x n_sale / sigma)` and sum of tokens at most `n_sale`; `bonus_i` likewise |
| A2 spend and refund | `spend_i = ceil(c_i x accepted / sigma)`, `spend_i <= c_i`, and `refund_i = c_i - spend_i` exactly |
| A3 buckets | launch fee + LP quote + stream + excess equals total committed; `accepted <= H`; sum of spend minus accepted is under one unit per buyer |
| A4 FAIL refunds | on FAIL every spend is zero and every refund equals the commit |
| V1 verdict | the verdict is recomputed from the positions and equals the verdict from the ledger counters |
| T1 STREAM_CAP | before PASS the creator can draw nothing; after PASS, at every probe time the amount drawn is at most `linear_unlocked(stream, settled_at, duration, now)`, and a withdraw-all at the settle instant is refused `STREAM_CAP` |

The checker is itself tested: `tools/swarm-sim` has tests that inject a deliberate bug into a test-only copy of the logic and assert the matching invariant fires (see the crate tests).

## 6. What is measured

Per agent: committed (peak and final), spend, refund, tokens, bonus tokens, walked, refused attempts by rule code, effective price per token. Aggregate: clearing price, oversubscription ratio, verdict and its margin (in USDC and in funders) after every round, fill ratio by group (honest, whale, sniper, sybil, flipper), token share versus commit share by group, and the answer to "did the adversaries beat the honest backers".

"Beat" means: an adversary paid a lower price per token than the honest backers, OR exceeded the per-wallet cap on one account, OR extracted funds, OR broke an invariant. Any of these would be reported as a failure. A group taking a larger SHARE of the pool by committing more is not a price advantage and is reported separately as share.

## 7. Blocked versus bounded (read this before quoting results)

- **Blocked by a rule (the contract refuses it)**: a single wallet above the cap (`R_CAP_ACCOUNT`), a commit after the window (`R_WRONG_PHASE`), a Walk after the deadline (`R_WALK_CLOSED`), a commit below min buy, total above the oversubscription ceiling (`R_CAP_LAUNCH`), creator draws above the stream cap (`STREAM_CAP`). Whales and snipers hit these.
- **Bounded, NOT blocked**:
  - *Sybil split.* The contract cannot link accounts, so four accounts can hold four times the per-wallet cap. What bounds it: each account needs its own funds and min buy; the ring pays the same uniform price as everyone; its share cannot exceed accounts x cap over the total; it is further limited by the oversubscription ceiling and the holder cap; and a larger pool dilutes it pro-rata with everyone else. The run reports the ring's share.
  - *Walk-flip.* A committed buyer can Walk on the last tail round, when no one can answer with a commit. It succeeds only when the pass margin is smaller than that one position, so the damage per flipper is limited by the per-wallet cap, and every other buyer is refunded in full (nobody loses money, the trial just fails). Cost to the flipper: only its time-locked USDC. It is NOT prevented. A designer who wants more safety sets a higher soft cap margin or a lower wallet cap.
- **Not modelled**: network ordering and MEV, gas griefing, collusion between the creator and buyers, off-chain pressure, real wallets, and any strategy we did not script.
