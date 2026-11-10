# Core views added for the app (IR-C1 to IR-C4, D-2)

Owner: workstream A. All are view-only (no state change), all u128/u64 values are decimal strings, `null` means the launch does not exist.

| View | Args | Returns |
|---|---|---|
| `get_phase` | `launch_id` | `{phase: "Scheduled"|"Open"|"Closing"|"Ready", status, now, opens_at, commit_end, walk_end}` (same `phase` as `get_state`) |
| `preview_charter` | `params: TrialParams`, `creator?: AccountId` | `{ok, violations: [{code, field, got, limit}], required_deposit: string|null}`. Includes `R_CREATOR_GATE` when the gate is closed and `creator` is not the owner; `required_deposit` only when clean and equal to the `required_deposit` view |
| `preview_settlement` | `launch_id`, `holder` (`near:<account>` or `sol:<base58>`) | `{ok, would_pass, provisional, spend, refund, tokens, bonus, total_active, soft_cap, soft_cap_margin (signed), funders, min_funders, funders_margin}` at the live totals; after settlement the real numbers with `provisional:false`. Errors: `{ok:false, code:"R_DELIVER"}` for a malformed holder, `R_NO_POSITION` for no position |
| `declared_wallets` | `launch_id` | `{creator, payout_recipient, wallets: [creator, payout_recipient?]}` (the recipient is listed once). Core knows no other declared wallets (no payees or allocation beneficiary in the submission build). Not sybil resistance |
| `get_book_hash` | `launch_id` | 64 hex, equal to `get_state.book_hash` |
| `payout_recipient` | key inside `get_charter` and `get_state` | the Charter `stream_recipient` (D-2) |
| `get_market_link`, `get_genesis`, `get_genesis_spec`, `solana_allocations_page` | see HANDOFF.md and REQ-1 | handoff and genesis state |

`get_config` gained `creator_gate`, `market`, `genesis_relayer`, `genesis_paused`; `get_ledger` gained `lp_seed_inflight` and `lp_seed_sent`.

Views added later (2026-11-10, details in `CORE-ABI.md`): `solvency_report`, `get_ops_state(launch_id?, account_id?)`, `get_token_custody(launch_id)`; `get_invariants` also asserts the solvency counters (identity L6). `get_config` does not return `burn_mode`; read it from `get_token_custody`.
