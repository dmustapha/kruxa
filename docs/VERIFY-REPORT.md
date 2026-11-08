# Verify report: G1 scaffold milestone (Phase 1 closeout, 2026-11-08)

## Sources
- Independent audit (a distinct model that did not write the build): `/Users/MAC/near-hack/kruxa/VERIFY-MILESTONE-G1.md`. It is the Task 1.9 step 2 milestone audit for G1. Its verdict was PARTIAL on Tasks 1.7, 1.8 and 1.9, with four weak tests and two done-criteria not fully closed.
- Gate script: `./scripts/gate-g1.sh`, re-run after the closeout changes below. Log of that run: `target/gate-g1/` (native.log, sandbox.log).

## Gate result after closeout
```
PASS G1-01 toolchain (rustc 1.95.0 (59807616e 2026-04-14))
PASS G1-04 wasm build (4 files, kruxa_core 462222 B)
PASS G1-02 lint (lint ok, kruxa_core.wasm   462222 bytes (budget 600000))
PASS G1-03 pure tests (50 in kruxa-math + kruxa-logic, 78 with kruxa-sim)
     sandbox suite: exit 0, 34 passed
PASS G1-05 .. G1-14 (all PASS)
G1 GREEN (14 of 14)
```

## What the closeout changed (each a separate commit)
| Verifier finding | Change | Shown able to fail by |
|---|---|---|
| `p_recompute` compared `fold_book` to a model built on the same function | independent reference (Vec scan, hand-built hash preimage, written verdict rule, its own `inputs_hash` encoding); plus `p_recompute_detects_a_corrupted_reference` | scratch run with the reference sabotaged: `p_recompute ... FAILED` with differing hashes; restored |
| fuzz order-independence near always true | folds two random commit and walk interleavings (pieces split and reordered, extra buyers who Walk), compares total, funders, verdict, inputs hash, positions; 3 unit tests | scratch run dropping one event from ordering B: `FAILED order-independence: total or funders`; restored |
| `reentrant_refund_cannot_pay_twice` never confirmed the reentrant call ran | asserts core returned exactly `[true, false]` in the transaction tree (outer claim paid, reentrant claim ran and paid nothing) and no failure receipts | scratch run pointing the reentry at a missing method: `left: [true] right: [true, false]`; restored |
| global cap hit only after lowering it | `global_cap_refuses_at_the_real_three_thousand_dollars` (slow, ignored by default, run by the gate): launch A $2,000, launch B $1,000, next $20 gives `R_CAP_GLOBAL` with the cap never lowered | scratch run with 9 wallets in B: `global_held` 2900000000 vs 3000000000 assertion fails; restored |
| DC-3 deposit refund on a refused create_trial not asserted | balance check around two refused `create_trial` calls (deposit 0.42 NEAR, loss about 0.0004 NEAR, bound deposit/4) | scratch run with an impossible bound printed the measured loss; restored |
| stale counts and wasm size | LIMITATIONS, SUBMISSION_STATUS, HONESTY, DECISIONS, ARCHITECTURE tables, DC-MAP | gate prints the live numbers |

## Not closed (carried honestly)
- W1-DC-9 FROZEN 7-day expiry in the sandbox: `Worker::fast_forward(100_000)` had not returned after more than 4 minutes, so several hundred thousand blocks for 7 days is not practical. Still proven only as the pure function `pause_at`. Carried in LIMITATIONS.
- WINNER-READINESS score (`hackathon-verify` milestone mode): not run by the closeout agent. The score needs the `/demo` route (PLAN: after Task 6.9); PLAN permits using the script result alone for G1. No score is claimed here.
- W1-DC-8, 12, 13, 15, 16 and deltas D-1 to D-3: scheduled Phase 2 and Nov 10, untouched.
