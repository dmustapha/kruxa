# Events (NEP-297, standard `kruxa`, version `1.0.0`)

Format of every line: `EVENT_JSON:{"standard":"kruxa","version":"1.0.0","event":"<name>","data":[{...}]}`. u128 and u64 values are decimal strings. The indexer reads only these.

<!-- BEGIN CORE EVENTS (owner: workstream A; merge: keep both sections) -->
## Core events (workstream A writes this section)
<!-- END CORE EVENTS -->

<!-- BEGIN MARKET EVENTS (owner: workstream M) -->
## Market events (contract `market.kruxa.near`)

| Event | Data fields | When |
|---|---|---|
| `pool_opened` | `launch_id, token, quote, q, t, payout_recipient, opened_ns, terms{FeeTerms}` | both handoff legs landed |
| `swap` | `launch_id, side ("buy"/"sell"), trader, receiver, amount_in, amount_out, fee_total, fee_bps_applied, creator, platform, holders, lp, referral, surcharge, red_holders, red_referral, q, t, ts_ns` | every successful swap. `amount_out` is what the receiver is owed (tokens for buy, net USDC for sell). `creator+platform+holders+lp+referral == fee_total`. `surcharge`, `red_holders`, `red_referral` are subsets of `lp`. `q`, `t` are reserves after the swap |
| `creator_claimed` | `launch_id, recipient, amount, paid_creator` | claim debited (before the transfer lands) |
| `platform_withdrawn` | `to, amount` | platform withdraw debited |
| `market_paused` | `paused (bool), by` | pause and unpause |
| `owed_credited` | `account, token, amount, reason ("buy_payout"/"sell_payout")` | an outbound swap payout failed; the amount is claimable with `claim_owed` |
| `owed_claimed` | `account, token, amount` | `claim_owed` debited |
| `payout_recredited` | `kind ("creator"/"platform"/"owed"), launch_id?, amount` | an outbound claim failed and the counter was restored |

Price for the indexer: `q / t` after each `swap` or `pool_opened` (micro-USDC per smallest token unit). Candle volume uses `amount_in` for buys and `amount_out + fee_total` for sells (gross USDC).
<!-- END MARKET EVENTS -->
