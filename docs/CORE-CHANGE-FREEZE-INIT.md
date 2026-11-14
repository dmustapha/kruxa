# Core change: freeze barrier and private init

Two owner-authorized changes to `contracts/core`. Nothing else in core, and nothing in `contracts/market` or `contracts/instant`, was touched.

## 1. Freeze re-arm bound

Problem: `freeze()` could be called again at any moment, each call restarting the 7 day clock, so exits could stay closed indefinitely. That contradicts SECURITY.md ("a freeze auto-expires after 7 days").

Fix: the launcher's `freeze_barrier` design, copied.

- Pure logic in `crates/kruxa-logic/src/controls.rs`: `freeze_barrier(frozen_until)` and `freeze_allowed(by_owner, barrier, now)`; re-exported from the crate root.
- `contracts/core/src/admin.rs::freeze`: refuses with `R_NOT_YET` when `freeze_allowed` is false; otherwise freezes and sets `barrier = frozen_until + FREEZE_MAX_NS`.
- New view `freeze_barrier() -> U64` (ns; 0 when no freeze has ever happened). All existing method signatures are unchanged.

### Constants and exact semantics (same as the launcher)

- `FREEZE_MAX_NS` = 7 days = 604,800,000,000,000 ns (unchanged). A freeze started at `t` is in force until `frozen_until = t + 7d`.
- Barrier = `frozen_until + 7d` = `t + 14d`, written when the freeze is armed.
- The guardian may freeze only when `now >= barrier` (equality passes). Before that: `R_NOT_YET`, no state change. This also blocks the guardian from re-arming a freeze that is still running.
- The barrier is anchored to the freeze start, not to the lift. If the owner unpauses early, the barrier does not move, so the guardian still waits until `t + 14d`. Exits are therefore open for at least 7 days between two guardian freezes when a freeze runs to its end, and for longer when it is lifted early.
- The owner is exempt, exactly as in the launcher (it is also the only account that can unpause). An owner freeze still moves the barrier.
- Barrier 0 (never frozen, or a state deployed before this change) never blocks.

### Exits (behaviour preserved)

Exits are closed while FROZEN (`R_FROZEN`) and open while PAUSED or unpaused, exactly as before; this change does not alter any freeze semantics. The brief said exits "stay available while FROZEN"; that is not what the code does today and it was not changed. What the barrier adds is a guaranteed open window between guardian freezes.

### Storage

The barrier is a raw little-endian u64 under the key `x:fbar`, read and written with `env::storage_read/write`. It is not a field of `Contract`, `Config` or `Extra`: all three are borsh structs, so adding a field would change the deployed layout and `migrate`/`state_read` would fail on existing state. The `x:` prefix cannot collide with the one-byte `Key` enum or the other `x:*` prefixes. A backward compatible struct field was not possible; the raw key is.

## 2. Private init

`new` is now `#[init] #[private]`. Only the contract account can call it, so a deploy and init that are separate transactions can no longer be front-run by a stranger. A second `new` is still refused by the init guard. The sandbox harness already initialised through `Contract::call`, which signs as the contract account, so `tests/src/lib.rs` needed no change; the one other call site (`tests/tests/solvency.rs`) does the same. Testnet deploy scripts use `deployWasm(..., 'new', ...)` with the contract account as signer, so they work unchanged.

## Tests

- Unit (`cargo test -p kruxa-logic`): 2 new in `controls.rs` (barrier arithmetic and saturation; guardian blocked until the barrier, one ns before blocks, at the barrier passes, owner never blocked, barrier 0 never blocks).
- Sandbox (`tests/tests/freeze_init.rs`, 4 tests): a second guardian freeze inside the barrier is refused with `R_NOT_YET` (still frozen, and after an owner lift), the refused call changes nothing, and the guardian can freeze after the barrier (the 14 day wait is simulated by `patch_state` of `x:fbar`); the owner is not held back and a creator is still `R_NOT_AUTHORIZED`; `walk` is `R_FROZEN` while frozen and succeeds in the window between freezes while the guardian is refused; `new` by a stranger is refused (private), `new` by the contract account succeeds, a second `new` is refused, and the first config stands.

## Caveats

- The owner exemption means a compromised or hostile owner key can still re-arm freezes back to back. The bound is on the guardian. If the owner must be bound too, drop the `by_owner` argument in `freeze_allowed` (one line plus tests); this is a decision for Dami.
- The real 14 day wait is not exercised in the sandbox (patched). The timestamp logic itself is covered by the pure unit tests.
- Local non-reproducible wasm size: 675,697 bytes (limit 700,000; previous local build 674,996).

## Files that must change when the new hash is frozen

Same list as `docs/CORE-CHANGE-DISSOLVE.md`: run `scripts/build-artifacts.sh` on the clean committed tree (rewrites `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.reproducible`, `artifacts/kruxa_core*.wasm`, `BUILD-KIND`), then update every place that names the old core hash: `scripts/gate-freeze.sh` and its record, `EXPECT_SHA256` in deploy commands, the `verify.sh` CODE sums file, README, SUBMISSION_STATUS, LIMITATIONS and HONESTY reproducible-core text, `docs/VERIFY-REPORT.md`, `docs/benchmarks.md`, evidence files that quote the hash. Also: `docs/interfaces/CORE-ABI.md` (add the `freeze_barrier` view, the guardian `R_NOT_YET` on `freeze`, private `new`), `SECURITY.md` row "Pause trapping exits" (mention the barrier), and the attack gallery and judge records (re-run on the frozen commit; a fresh testnet core account is needed because the hash changes).
