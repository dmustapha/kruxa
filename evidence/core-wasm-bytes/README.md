# Core sandbox suite on the reproducible wasm (FG-24)

## Final hash `c55bffdb` (the submitted core): GREEN

`sandbox-suite-c55bffdb.log`: the whole sandbox suite run on the container build of commit `5c2874d` (sha256
`c55bffdbdec7909464c65511219ec77be7d8f765bc037a46350efe713cb8b13b`, 655,376 bytes):

    KXI_CORE_WASM=$PWD/artifacts/kruxa_core.wasm KXI_CORE_WASM_SHA256=c55bffdb... cargo test -p kruxa-tests --no-fail-fast -- --test-threads=2 --include-ignored --nocapture

Result: EXIT 0, 324 passed, 0 failed, 0 ignored (including the attack gallery's 100 tests and `walk_then_fail_still_dissolves_and_returns_bond`).
The log line `CORE_WASM_SHA256 c55bffdb...` is the proof that the sandbox deployed those exact bytes (`view_code` equals the file and the pin). The one
"panicked" text in the log is the recorded STREAM_CAP refusal inside an outcome dump, not a test failure. The run rewrote `evidence/attack-gallery/records`
(new sandbox tx hashes and gas figures that moved by about 0.00001 Tgas, same rule codes and outcomes); those rewrites were reverted so the committed
records still match `docs/ATTACK-GALLERY.md`.

## Old hash `665caab5` (superseded, kept as history)

Superseded: main later merged a core fix (dissolve after a walk), so `665caab5...` is no longer the candidate. This record proves the
mechanism (`KXI_CORE_WASM`, see `tests/src/lib.rs core_wasm_bytes()`) and the result for that one hash. FG-24 must be redone on the new
reproducible build:

    KXI_CORE_WASM=$PWD/artifacts/kruxa_core.wasm KXI_CORE_WASM_SHA256=<new hash> cargo test -p kruxa-tests --no-fail-fast -- --test-threads=2 --include-ignored --nocapture

The test `core_wasm_bytes` deploys the override into the sandbox, reads it back with `view_code` and asserts the sha256 equals the file (and
the pin, when `KXI_CORE_WASM_SHA256` is set). The log line `CORE_WASM_SHA256 665caab5...` is that proof.

| File | What |
|---|---|
| sandbox-suite-665caab5-run1-intents-flake.log | run 1, `--test-threads=3`, no `--no-fail-fast`: stopped at `pass_with_intents_buyers_consolidates_and_pays_the_stream` (R_NOT_CLEAR); the same test passes alone on the local wasm and on 665caab5 (timing under machine load, other agents were running suites) |
| sandbox-suite-665caab5.log | run 2, `--no-fail-fast --test-threads=2`: 322 tests ok, 1 FAILED: `failed_transfer_recredits_the_claim_and_the_position_survives` (R_WRONG_PHASE, a clock race under load) |
| rerun-failed_transfer_recredits-alone.log | that test rerun alone on 665caab5: ok |

Local-build default (no override) was also run for `core_wasm_bytes`: deployed hash e85198ed..., so the override really changes the bytes.
Result for 665caab5: all suites green except one load-dependent test that passes alone. Not a claim about any other hash.
