# Events (NEP-297, standard `kruxa`, version `1.0.0`)

Format of every line: `EVENT_JSON:{"standard":"kruxa","version":"1.0.0","event":"<name>","data":[{...}]}`. u128 and u64 values are decimal strings. The indexer reads only these.

<!-- BEGIN CORE EVENTS (owner: workstream A; merge: keep both sections) -->
## Core events (contract `core.kruxa.near`)

Written by workstream I from `contracts/core/src/*.rs` on main (the section was empty); owner A should review and keep it in step with the code. `launch_id`, amounts and times are decimal strings; times are block nanoseconds; `holder` is a holder key (`near:<account>` or `sol:<base58>`). The indexer folds only the events in the "Emitted today" table, from the configured core account, from successful receipts.

### Emitted today
| Event | Data fields | When |
|---|---|---|
| `charter_created` | `launch_id, creator, symbol, charter_hash` | `create_trial` accepted, token creation started |
| `trial_opened` | `launch_id, opens_at, commit_end, walk_end` | token created, trial open |
| `contributed` | `launch_id, holder, net, relay_fee, custody ("Native"/"Intents"), total_active, funders, book_hash` | a commit landed; `total_active`, `funders`, `book_hash` are the launch totals after it |
| `walked` | `launch_id, holder, amount, total_active, funders, book_hash` | walk (exit) accepted; totals after it |
| `verdict` | PASS: `launch_id, outcome:"PASS", inputs_hash, total_active, funders`. FAIL: `launch_id, outcome:"FAIL", reasons[], total_active, funders` | `settle` decided the launch |
| `pass_allocated` | `launch_id, accepted, launch_fee, lp_quote, stream, excess_pool` | right after a PASS verdict |
| `payout_resolved` | `launch_id, kind ("RefundNative","RefundIntents","LaunchFee","Stream","RelayFee","Consolidate","Claim"), amount, ok` | an outbound payout callback resolved; `ok=false` is retryable. A Stream draw is `kind:"Stream"` |
| `tokens_claimed` | `launch_id, holder, amount` | a PASS backer claimed launch tokens |
| `residue_swept` | `launch_id, amount` | leftover dust swept |
| `dissolved` | `launch_id` | FAIL path finished, every refund cleared |
| `bond_reclaimed` | `launch_id, amount` | creator bond returned (yoctoNEAR) |
| `token_creation_failed` | `launch_id, code, reason` | factory token creation failed |
| `contribution_submitted` | `launch_id, holder, amount` | S4 contribution submitted |
| `contribution_failed` | `launch_id, holder` | S4 contribution failed |
| `deposit_rejected` | `payer, amount, code, detail` or `token` | a deposit was refused and returned |
| `deposit_rejected_refundable` | `launch_id, holder, code` | S4 deposit refused, refundable |
| `paused` | `by` | owner or guardian paused |
| `frozen` | `by, until` | freeze (auto-expires to paused) |
| `unpaused` | none | owner unpaused |
| `global_cap_lowered` | `value` | instant lower |
| `global_cap_queued` / `global_cap_applied` | `value, effective_at` / `value` | timelocked raise |
| `launch_cap_queued` / `launch_cap_applied` | `value, effective_at` / `value` | timelocked raise |

### Requested additions (not emitted yet; the indexer reads them when present and shows `null`/`unknown` otherwise)
| Event | Extra fields | Why |
|---|---|---|
| `charter_created` | `name, soft_cap, min_funders, stream_days, total_supply, payout_recipient` (alias of Charter `stream_recipient`), `token_decimals` | feed and detail cards show the name; verdict margin needs the soft cap and minimum backers; the stream meter needs `stream_days`; market cap needs `total_supply`. `payout_recipient` is Charter `stream_recipient` |
| `pool_opened` (market) | `total_supply` | market cap without an RPC view |

### Proposed, not emitted by any contract yet (genesis progress; the indexer accepts them from the core account)
| Event | Data fields |
|---|---|
| `genesis_committed` | `launch_id, network, path ("F0"/"F1"), spec_hash` |
| `genesis_confirmed` | `launch_id, mint, tx_create, tx_authority, distributor, root, mint_authority (null = revoked), freeze_authority, verified_checks[]` |
| `external_pool` | `launch_id, venue ("meteora"), pool, url` (only when verified on chain) |

Until these exist the API reports genesis `stage:"pending"` after a PASS, with every other genesis fact `null` or `"unknown"`.
<!-- END CORE EVENTS -->

<!-- BEGIN MARKET EVENTS (owner: workstream M) -->
## Market events (contract `market.kruxa.near`)

| Event | Data fields | When |
|---|---|---|
| `pool_opened` | `launch_id, token, quote, q, t, payout_recipient, opened_ns, fee_bps (base total), creator_bps, mint_authority, freeze_authority (null = revoked), terms{FeeTerms}` | both handoff legs landed |
| `swap` | `launch_id, side ("buy"/"sell"), trader, receiver, amount_in, amount_out, fee_total, fee_bps (applied rate incl. opening surcharge), creator_bps (from terms), creator, platform, holders, lp, referral, surcharge, red_holders, red_referral, q, t, ts_ns` | every successful swap. `amount_out` is what the receiver is owed (tokens for buy, net USDC for sell). `creator+platform+holders+lp+referral == fee_total`. `surcharge`, `red_holders`, `red_referral` are subsets of `lp`. `q`, `t` are reserves after the swap |
| `creator_claimed` | `launch_id, recipient, amount, paid_creator` | claim debited (before the transfer lands) |
| `platform_withdrawn` | `to, amount` | platform withdraw debited |
| `market_paused` | `paused (bool), by` | pause and unpause |
| `owed_credited` | `account, token, amount, reason ("buy_payout"/"sell_payout"/"creator"/"platform"/"owed_claim")` | an outbound swap payout failed; the amount is claimable with `claim_owed` |
| `owed_claimed` | `account, token, amount` | `claim_owed` debited |

Price for the indexer: `q / t` after each `swap` or `pool_opened` (micro-USDC per smallest token unit). Candle volume uses `amount_in` for buys and `amount_out + fee_total` for sells (gross USDC).
<!-- END MARKET EVENTS -->
