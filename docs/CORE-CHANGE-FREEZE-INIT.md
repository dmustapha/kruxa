# Core change: freeze barrier, private init and 12 h minimum commit window

Three owner-authorized changes to `contracts/core` (sections 1 and 2 below, and the 12 h commit window in section 3). Nothing else in core, and nothing in `contracts/market` or `contracts/instant`, was touched.

## 1. Freeze re-arm bound

Problem: `freeze()` could be called again at any moment, each call restarting the 7 day clock, so exits could stay closed indefinitely. That contradicts SECURITY.md ("a freeze auto-expires after 7 days").

Fix: the launcher's `freeze_barrier` design, copied.

- Pure logic in `crates/kruxa-logic/src/controls.rs`: `freeze_barrier(frozen_until)` and `freeze_allowed(barrier, now)`; re-exported from the crate root.
- `contracts/core/src/admin.rs::freeze`: refuses with `R_NOT_YET` when `freeze_allowed` is false; otherwise freezes and sets `barrier = frozen_until + FREEZE_MAX_NS`.
- New view `freeze_barrier() -> U64` (ns; 0 when no freeze has ever happened). All existing method signatures are unchanged.

### Constants and exact semantics (same as the launcher)

- `FREEZE_MAX_NS` = 7 days = 604,800,000,000,000 ns (unchanged). A freeze started at `t` is in force until `frozen_until = t + 7d`.
- Barrier = `frozen_until + 7d` = `t + 14d`, written when the freeze is armed.
- A freeze (owner or guardian) is accepted only when `now >= barrier` (equality passes). Before that: `R_NOT_YET`, no state change. This also blocks re-arming a freeze that is still running.
- The barrier is anchored to the freeze start, not to the lift. If the owner unpauses early, the barrier does not move, so the next freeze still waits until `t + 14d`. Exits are therefore never closed more than 7 days in any 14, against every caller; `pause` (which keeps exits open) is not bound.
- Coordinator decision: the owner is NOT exempt (the launcher exempts the owner; core does not). Owner and guardian are bound alike. The launcher is unchanged and still has its owner exemption.
- Barrier 0 (never frozen, or a state deployed before this change) never blocks.

### Exits (behaviour preserved)

Exits are closed while FROZEN (`R_FROZEN`) and open while PAUSED or unpaused, exactly as before; this change does not alter any freeze semantics. The brief said exits "stay available while FROZEN"; that is not what the code does today and it was not changed. What the barrier adds is a guaranteed open window between freezes.

### Storage

The barrier is a raw little-endian u64 under the key `x:fbar`, read and written with `env::storage_read/write`. It is not a field of `Contract`, `Config` or `Extra`: all three are borsh structs, so adding a field would change the deployed layout and `migrate`/`state_read` would fail on existing state. The `x:` prefix cannot collide with the one-byte `Key` enum or the other `x:*` prefixes. A backward compatible struct field was not possible; the raw key is.

## 2. Private init

`new` is now `#[init] #[private]`. Only the contract account can call it, so a deploy and init that are separate transactions can no longer be front-run by a stranger. A second `new` is still refused by the init guard. The sandbox harness already initialised through `Contract::call`, which signs as the contract account, so `tests/src/lib.rs` needed no change; the one other call site (`tests/tests/solvency.rs`) does the same. Testnet deploy scripts use `deployWasm(..., 'new', ...)` with the contract account as signer, so they work unchanged.

## 3. Minimum commit window 24 h to 12 h (production `ladder` preset)

`crates/kruxa-logic/src/rules.rs`: `Rules::ladder().min_commit_secs` 86_400 to 43_200. `min_tail_secs` (3_600), `max_commit_secs`, and the `demo_clock` preset (90 s) are unchanged. `R_WINDOW` for a commit window under 12 h; exactly 12 h passes. `TrialParams::example` keeps 24 h (still legal). Rules are a snapshot per charter, so launches created before this change keep their window.

Updated to match: `fixtures/hostile.json` (86399 to 43199, used by `kruxa-sim validate`), `app/lib/charter/rules.ts` (`minCommitSecs`), `app/lib/charter/rules.test.ts`, `app/lib/charter/presets.ts` (quick preset 12 h, hostile preset 43_199 s), `app/content/docs/facts.ts` (`commitHours.min` 12, which feeds the docs pages and `facts.test.ts`), `CreateStudio.tsx` hint, `app/content/docs/pages/security.ts` wording. Rust tests: the R_WINDOW and hostile fixtures moved from 86_399 to 43_199, the inclusive boundary test uses 43_200, and `ladder_commit_window_minimum_is_twelve_hours` checks 11h59m refused, 12 h passes, demo untouched.

Docs still saying 24 h for this rule (not edited here): `docs/PRD.md` (lines 305, 343, 835, 1026, 1030), `docs/INVARIANTS.md` (D-26 line 120, line 208), `ARCHITECTURE.md` (lines 1010, 1131, 1397 code copies; 6613, 6634, 6651), plus the USER-ONBOARDING and charter copy that PRD.md references (`docs/PRD.md` points to it; no separate file exists in this tree) and `docs/ATTACK-GALLERY.md` / app `attack-gallery.summary.json` only if a record quotes the window.

## Tests

- Unit (`cargo test -p kruxa-logic`): 2 new in `controls.rs` (barrier arithmetic and saturation; blocked until the barrier, one ns before blocks, at the barrier passes, barrier 0 never blocks).
- Sandbox (`tests/tests/freeze_init.rs`, 4 tests): a second guardian freeze inside the barrier is refused with `R_NOT_YET` (still frozen, and after an owner lift), the refused call changes nothing, and a freeze is accepted after the barrier (the 14 day wait is simulated by `patch_state` of `x:fbar`); the owner's second freeze inside the barrier is refused `R_NOT_YET` and accepted after it, and a creator is still `R_NOT_AUTHORIZED`; `walk` is `R_FROZEN` while frozen and succeeds in the window between freezes while the guardian is refused; `new` by a stranger is refused (private), `new` by the contract account succeeds, a second `new` is refused, and the first config stands.

## Caveats

- The real 14 day wait is not exercised in the sandbox (patched). The timestamp logic itself is covered by the pure unit tests.
- Local non-reproducible wasm size: 675632 bytes (limit 700,000; previous local build 674,996).

## Files that must change when the new hash is frozen

Same list as `docs/CORE-CHANGE-DISSOLVE.md`: run `scripts/build-artifacts.sh` on the clean committed tree (rewrites `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.reproducible`, `artifacts/kruxa_core*.wasm`, `BUILD-KIND`), then update every place that names the old core hash: `scripts/gate-freeze.sh` and its record, `EXPECT_SHA256` in deploy commands, the `verify.sh` CODE sums file, README, SUBMISSION_STATUS, LIMITATIONS and HONESTY reproducible-core text, `docs/VERIFY-REPORT.md`, `docs/benchmarks.md`, evidence files that quote the hash. Also: `docs/interfaces/CORE-ABI.md` (add the `freeze_barrier` view, `R_NOT_YET` on a second `freeze`, private `new`), `SECURITY.md` row "Pause trapping exits" (mention the barrier), and the attack gallery and judge records (re-run on the frozen commit; a fresh testnet core account is needed because the hash changes).
