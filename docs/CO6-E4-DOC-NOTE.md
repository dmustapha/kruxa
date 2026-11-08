# CO-6 E-4 / VX-1: verify exit-code patch, note for the doc owner

Applied in the repo on 2026-11-08 (branch main, local only). The final code is the source of truth; paste from these files, do not retype:
`tools/kruxa-sim/src/{main,cli,verify}.rs`, `tools/kruxa-sim/tests/exit_codes.rs`, `scripts/verify.sh`.

## Contract as built
| Code | Meaning | Where |
|---|---|---|
| 0 | MATCH | every recomputed value equals the stored one |
| 2 | MISMATCH only, always with a `MISMATCH <field>` line | `verify.rs::report_mismatch`, `finish_tamper` |
| 3 | pending (`get_settlement` is null) | prints `PENDING launch N is not settled yet` |
| 4 | infra: connect failure, non-200, non-JSON body, JSON-RPC error or contract panic (no `result.result`), result bytes not JSON, `get_verdict_inputs` null (no such launch), settlement without `pass` or `inputs_hash`, two RPCs disagree | `cli::infra` |
| 64 | usage: unknown or missing flag, stray argument, unknown tamper field, bad number | `cli::usage` |
| 1 | `--tamper`/`--tamper-all` run NOT detected: prints `TAMPER NOT DETECTED <field>` | `verify.rs::tamper_runs` |

## Behaviour that differs from the CO-6 text (doc owner should mirror)
1. Views are fetched and compared BEFORE any tamper run, so a dead RPC can never print a MISMATCH line.
2. A real mismatch on the untampered record exits 2 first (names `pass` and/or `inputs_hash`); tamper runs only happen after a clean MATCH.
3. `--tamper [FIELD]` and `--tamper-all` (exclusive). Fields: `launch_id charter_hash total_active active_funders soft_cap min_funders cancelled`. Bare `--tamper` means `total_active` (old behaviour). After a clean MATCH the tamper lines are `MISMATCH <field>` (detected) and the exit is 2; any undetected field prints `TAMPER NOT DETECTED <field>` and the exit is 1.
4. New optional `--rpc2 URL` (verify.sh: same flag after the positional args): every view is read from both RPCs; a difference is exit 4.
5. All subcommands now reject unknown flags and stray arguments with 64 (before, they were ignored). `settle` with arguments the pure code refuses also exits 64 (was 2).
6. `scripts/verify.sh` is one path, `exec`s the sim, usage exits 64; `chain` passes extra flags through (`"$@"`).
7. Tests: `cargo test -p kruxa-sim` runs 14 integration tests against a localhost JSON-RPC stub (dead port, garbage 200, panic, bad bytes, missing launch, RPC disagreement, usage cases, MATCH, pending, mismatch on each stored field, single tamper, tamper-all).

## Doc changes required (not made here; docs are read-only for the build)
- ARCHITECTURE 4.6: replace the embedded `kruxa-sim` main.rs and verify.sh with the files above (main.rs is now three modules; add `tests/exit_codes.rs`); update the "Current behaviour being replaced" sentence to past tense; list the `--rpc2` and `--tamper FIELD` flags.
- ARCHITECTURE Section 17 / extractor: `tools/kruxa-sim/src/*` and `scripts/verify.sh` no longer round-trip identical to the doc (file list grows by 3: cli.rs, verify.rs, tests/exit_codes.rs). Either re-extract the doc or record the divergence in CHANGE-ORDERS.
- PLAN Task 3.3 step 0 and task VX-1: mark done in Phase 1 (this commit); the sim test count is now 14 on top of 9 + 16 native. Task 4.9 step 2c negative tests: dead RPC (exit 4, no MISMATCH), bad flag (64), garbage 200 (4) already exist as Rust tests; only the live-chain runs remain.
- PLAN C6.3 VX-1 acceptance line stays valid verbatim.
- NOT done (belongs to VX-2 / E-5): the `KEYS:` and `CODE:` lines and the `./scripts/verify.sh <launch_id>` short form.
