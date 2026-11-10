# Core final surface (ABI additions, 2026-11-10)

Status: CURRENT as of main `e1cdae4`. Source of truth is `contracts/core/src` (file named per row); where this file and the code disagree the code wins and this file is fixed in the same commit. Views are in `CORE-VIEWS.md`, events in `EVENTS.md`, market in `MARKET-ABI.md`, launcher in `INSTANT-ABI.md`.

Conventions: u64 and u128 are decimal strings in JSON. Panics (user calls) start with the rule code: `R_X: text`. Every `#[private]` callback never panics. `owner` and `guardian` are the config accounts; `require_live` refuses while PAUSED or FROZEN; `require_exit_open` refuses only while FROZEN (exits stay open while PAUSED).

Deployed: `core3.kxi-root-1108.testnet`, wasm sha256 `e85198ed37c2aa1d6cd5f18571f5e023eed391108ca8f22edc8599ac390e65ac`, 675,007 bytes, non-reproducible local build (`view_code` read from testnet RPC on 2026-11-10 and equal to `artifacts/SHA256SUMS`). The reproducible candidate is a different binary (`artifacts/SHA256SUMS.reproducible`, `d362ffa2...`, built before the R_GAS change; see LIMITATIONS).

## 1. Change methods added or changed since the Wave 1 ABI

| Method | Caller | Args | Effect and limits | File |
|---|---|---|---|---|
| `reopen_genesis` | owner only | `launch_id` | Puts an ABORTED genesis back to its default state so the relayer can commit again. Refused `R_GENESIS_STATE` unless aborted; a confirmed genesis can never be reopened. Event `genesis_reopened` | `genesis.rs` |
| `register_f0_message` | genesis relayer | `launch_id, tx_index (0 or 1), message_sha256 (64 hex)` | F0 only. Registers the sha256 of the message `sign_genesis` may later sign for that transaction slot. A slot that was already signed cannot be re-registered. Event `f0_message_registered` | `genesis.rs` |
| `sign_genesis` | genesis relayer | `launch_id, tx_index, message_hex` | F0 only. The F0 gate: asks the MPC signer (`v1.signer-prod.testnet` on testnet) to sign only a message whose sha256 equals the registered hash, once per registration, on the path `kruxa:genesis:<launch_id>` (built in the contract, never passed in), domain 1 (Ed25519). The slot is spent before the request leaves. `R_GENESIS_ARG` with `E_POLICY_MISMATCH` on a different message. The gate proves the signed bytes equal the registered hash; it does NOT prove the registered hash equals the compiled transaction: that is verify check C17 | `genesis.rs` |
| `check_solvency` | anyone (caller pays gas) | none | Reads `ft_balance_of(core)` on USDC and `mt_balance_of(core)` on Intents in parallel and compares each with the liability counter. Moves no money. At most one check per 30 s across both entry points (`R_TOO_EARLY`). Emits `solvency_report` | `solvency.rs` |
| `reconcile_intents` | anyone | none | The Intents-only half of the same check, same 30 s limit. A short Intents balance sets `intents_alert`, which refuses NEW Intents commits only (`R_SOLVENCY`); the next check that finds the balance sufficient clears it. Refunds, Walk, settle, consolidate, claims and streams are never blocked by it | `solvency.rs` |
| `claim_creator_alloc` | payout recipient only, payable | `launch_id` | PASSED launches only. Pays the creator allocation (`creator_bps`) after the cliff, then linear, to the payout recipient. Attach at least 1 yocto (plus 0.00125 NEAR when the recipient is not registered on the token; the rest is refunded). `R_NOTHING` before the cliff or when claimed. Debit first | `token_claims.rs` |
| `claim_tokens` (changed) | NEAR holder, payable | `launch_id` | Now registers the holder on the launch token inside the claim (NEP-145): attach 1 yocto when registered, 0.00125 NEAR + 1 yocto when not; everything above is refunded. A failed hop restores `claimed` and refunds the deposit. The app attaches 200 Tgas (about 150 is needed). The vested bonus stops at the sweep window | `payout.rs` |
| `sweep_tokens` | anyone, payable | `launch_id` | Releases supply nobody is owed to `burn_mode`: on PASSED the unclaimed backer bonus plus rounding dust after the bonus vest and the sweep window; on DISSOLVED the whole supply. Never to the creator or the platform. Under `Hold` it moves nothing (counts it as swept, refunds the deposit). `R_NOTHING` when zero. First sweep locks `burn_mode` | `token_claims.rs` |
| `set_burn_mode` | owner only | `mode`: `hold`, `burn` or `sink:<account>` | Default `Hold`. `Burn` is refused `R_BURN_UNSUPPORTED` (the factory token has no `ft_burn`). A `Sink` may not be a Kruxa-controlled account (`R_NOT_AUTHORIZED`). One shot: the first call or the first sweep locks it (`R_NOTHING`). No event; the mode in force is the `mode` field of `tokens_swept` | `token_claims.rs` |
| `queue_upgrade` | owner only | `code_hash` (64 lowercase hex, sha256 of the wasm) | Starts the public timelock: deployable 7 days later (`R_UPGRADE_HASH` on a bad hash). A new call replaces a pending one. Event `upgrade_queued` | `govern.rs` |
| `cancel_upgrade` | owner or guardian | none | Drops the queued upgrade (`R_NOTHING` if none). Event `upgrade_cancelled` | `govern.rs` |
| `upgrade_core` | owner only | wasm as raw call input | After the delay (`R_NOT_YET`) and only if the wasm hashes to the queued value (`R_UPGRADE_HASH`): deploys it and calls `migrate` with 30 Tgas; a failed `migrate` rolls the deploy back. Event `upgraded` | `govern.rs` |
| `migrate` | the contract itself (`#[private]`) | none | `#[init(ignore_state)]`; reads the existing state back unchanged. It is the identity function: a layout change must ship its own `migrate` (see section 4) | `govern.rs` |
| `halt_launch` | owner or guardian | `launch_id, reason` | Stops NEW commits (`R_HALTED`), `consolidate`, `pay_launch_fee`, `draw` and `open_market` for ONE launch. Walk, refunds, token claims, the verdict and `settle` are untouched, so a halt can only push a launch toward FAIL; it cannot trap money. `R_NOTHING` if already halted or finished. Event `halted` | `govern.rs`, `payout.rs`, `intake.rs` |
| `resume_launch` | owner only | `launch_id` | Clears the halt. Event `resumed` | `govern.rs` |
| `force_resolve_op` | owner only | `launch_id, kind, holder?, amount, ok, evidence` | Two steps with the SAME arguments. First call queues it in public (`force_resolve_queued`); a call 48 hours later (`R_NOT_YET` before) settles ONE stuck outbound leg (its callback never ran) as the receipt evidence says: `ok = true` counts it paid, `ok = false` returns it to due for the same holder or bucket. Moves at most what is in flight (`R_NOTHING` otherwise), to no new destination, never touches a verdict. Token legs (`Claim`, `AllocClaim`, `Sweep`) cannot be resolved this way. Event `op_force_resolved` | `govern.rs` |
| `withdraw_owed` | any account | none | Pulls NEAR a failed push left owed to the caller (debit first, re-credited if this push fails too). `R_NOTHING` if nothing owed. Refused while FROZEN | `govern.rs` |
| `claim_refund_batch` | anyone | `launch_id, holders[]` (`near:<account>` or `sol:<base58>`) | 1 to 25 holders (`R_BATCH_SIZE`), each paid like `claim_refund` to the destination fixed by its position; stops early when the attached gas cannot cover another holder (120 Tgas each) and returns `{handled, paid}`. Event `refund_batch` | `refunds.rs` |
| `set_refund_route` | the holder, for their own refund | `launch_id, intents_account` | Sends the holder's due NATIVE refund to their account on `intents.near` instead of their NEAR account (for a holder whose USDC registration is gone). Debit first; the callback re-credits what did not arrive. Event `refund_route_set` | `refunds.rs` |
| `claim_orphan_credit` | anyone | `signed` (the buyer's signed Intents payload) | Credits money that reached core's Intents balance with no credit (payload executed at the Verifier by someone else): re-verifies the signature, asks the Verifier whether the nonce is spent and whether core's balance exceeds what its ledgers owe, then credits like an S4 commit. Open launches only; double credit blocked by payload hash. Event `orphan_credit_refused` when refused | `s4.rs` |
| `lengthen_stream` | creator only | `launch_id, new_duration_days` | After PASS, before the stream is fully unlocked. Moves the stream end later, never earlier (`R_LENGTHEN_ONLY`); at most `max_stream_days` (365, `R_STREAM`); `R_TOO_LATE` once fully unlocked. The cap is continuous at the change and never higher afterwards. Event `stream_lengthened` | `stream.rs` |
| `create_trial` (changed) | creator, payable | unchanged | Refuses under 250 Tgas prepaid with `R_GAS` before any state change. Attach 300 Tgas (unused gas is refunded). `create_token` to the factory is now sent with 110 Tgas (80 fails on the real factory, 91 to 95 is needed) | `lifecycle.rs` |

## 2. Views added

| View | Returns | File |
|---|---|---|
| `solvency_report()` | `{held_native, held_intents, recomputed_native, recomputed_intents, counters_ok, intents_alert, cooldown_ns, last_check}` | `solvency.rs` |
| `get_ops_state(launch_id?, account_id?)` | `{halted, owed_near, pending_upgrade: {code_hash, effective_at} or null}` | `govern.rs` |
| `get_token_custody(launch_id)` | `{alloc_total, alloc_unlocked, alloc_claimed, alloc_cliff_ends_at, claimed_total, unclaimed_sale_total, solana_locked_total, swept, sweepable_now, sweep_at, burn_mode, burn_mode_locked, solana_claim_rent}` | `token_claims.rs` |
| `get_invariants(launch_id)` (changed) | also asserts the held counters equal the recomputation (identity L6) | `solvency.rs`, `views.rs` |

## 3. Solvency anchor: what it is and is not

- `held.native` and `held.intents` are the two running liability sums (identity L6 in the module header of `solvency.rs`). They are updated at the single write choke point `save_state`, so every money path is covered without per-site arithmetic.
- `check_solvency` compares the balance with the SMALLER of the liability at call time and at callback time, so a shortfall has to survive the whole window to count. A leg in flight across both snapshots can still read as short; the next check clears it.
- The report is informational. The only effect it can have is `intents_alert`, which pauses NEW Intents commits. It cannot pause exits.
- Checks C33 and C34 of the verifier (solvency views) have no live transcript in `evidence/`.

## 4. State layout and `migrate`

- The `Contract` struct gained `x: Extra` (upgrade queue, queued force-resolves, stream extensions, owed NEAR, credited S4 hashes), `Config` gained `burn_mode` and `burn_mode_locked`, and `LaunchState` gained `halted`; the solvency counters live under the raw storage keys `kruxa:held` and `kruxa:last_check`.
- State written by an older layout (core2) is not readable by this wasm. `core3` is a fresh `new` deploy, not a migration. A migration from core2 was not attempted [UNVERIFIED].
- The redeploys over core3 (`e338f84d...` then `e85198ed...`) kept the layout, so `migrate` (identity) was not exercised on a layout change.
- Any future layout change needs a `migrate` that reads the old struct and writes the new one, shipped through the 7-day queue.

## 5. Clock on the `demo` profile

`delay_ns` (`extra.rs`) replaces the 7-day upgrade delay and the 48-hour force-resolve delay with `DEMO_DELAY_NS` = 60 s on the `demo` profile only. `core3.kxi-root-1108.testnet` runs the `demo` profile, so its queued upgrade and force-resolve delays are 60 seconds, not 7 days and 48 hours. The `mainnet` and `testnet` profiles keep the real delays.

## 6. Rule codes added since Wave 1

| Code | Raised by |
|---|---|
| `R_BURN_UNSUPPORTED` | `set_burn_mode burn`, `sweep_tokens` when the mode is `Burn` |
| `R_HALTED` | commit while halted; `consolidate`, `pay_launch_fee`, `draw`, `open_market` while halted |
| `R_LENGTHEN_ONLY` | `lengthen_stream` with an end that is not later |
| `R_BATCH_SIZE` | `claim_refund_batch` with 0 or more than 25 holders |
| `R_UPGRADE_HASH` | `queue_upgrade` with a bad hash; `upgrade_core` with a wasm that does not hash to the queued value |
| `R_GAS` | `create_trial` under 250 Tgas prepaid |
| `R_VEST` | `create_trial` when `creator_bps > 0` and the rule set's cliff or total vest is out of bounds (`check_alloc_vest`) |
| `R_STREAM_INIT`, `R_PAYEES` | defined in `kruxa-logic` `RuleCode` with the pure checks `check_stream_init` and `check_payees` (unit-tested in `rules.rs`). No core method calls them today: the stream initial release is fixed at 0 and the shipped Charter has no payee list, so they are reserved for Market M-B |

Other codes reused by the new methods: `R_NOT_AUTHORIZED`, `R_NOTHING`, `R_NOT_YET`, `R_TOO_EARLY`, `R_TOO_LATE`, `R_WRONG_PHASE`, `R_DEPOSIT`, `R_SOLVENCY`, `R_GENESIS_STATE`, `R_GENESIS_ARG`, `R_STREAM`, `R_NO_POSITION`, `R_NO_LAUNCH`, `R_SIG`.

## 7. Gas the callers must attach

| Call | Attach | Why |
|---|---|---|
| `create_trial` | 300 Tgas (refused under 250 with `R_GAS`) | factory `create_token` leg 110 Tgas plus the creation callback; 150 left a launch stuck in `Creating` on testnet (rehearsal/ROUND2.md finding 1) |
| `claim_tokens`, `claim_creator_alloc`, `sweep_tokens` | 200 Tgas as the app sends; about 150 is the practical floor [UNVERIFIED lower bound, not swept] | balance read (8) + registration (15) + transfer + callbacks (80 and 55 reserved) |
| `claim_refund_batch` | 120 Tgas per holder handled | the loop stops early rather than starve a holder |
| `set_refund_route` | 120 Tgas for the Intents `ft_transfer_call` plus the callback | |
| `check_solvency`, `reconcile_intents` | views of 15 Tgas each plus a 25 Tgas callback | |
| `upgrade_core` | enough for the deploy plus 30 Tgas for `migrate` | |
