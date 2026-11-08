# Market ABI (owner: workstream M; readers: A core, I indexer, U2 market UI)

Status: FROZEN 1.0.0 for M-A (Market-lite). Source: ARCHITECTURE 5.1, 5.8, 5.9; PRD 4b.2, C5. Contract: `contracts/market`, account `market.kruxa.near`.
All u128 and u64 values are decimal strings in JSON. USDC is 6 decimals (micro-USDC). All `ft_on_transfer` messages are JSON objects with `"v":1` and an `"op"`.
Unknown fields are ignored. Any bad message, wrong token, pause (for buys and opens), cap breach or unmet `min_out` REFUSES: `ft_on_transfer` returns the full amount (the token contract refunds the sender) and logs a rule code. `ft_on_transfer` never panics.

## Changes against the ARCHITECTURE 5.1 sketch (A must read)
1. Terms ride on the USDC leg. Only the USDC contract is authenticated by `predecessor_account_id`; a launch token can be any contract, so the `seed_quote` message (USDC leg, `sender_id == core`) carries the authoritative `token`, `terms` and `payout_recipient`. The token leg `open_pool_token` carries only `launch_id` (extra fields ignored) and is accepted only from the token named by `seed_quote`.
2. Either leg may land first. A token leg that lands first is parked (bounded, max 64 parked) and joins when the seed lands. The pool is `AwaitSeed` until both legs landed, then `Open`.
3. `FeeTerms` is the existing `kruxa_logic::FeeTerms` (it already carries `fee_vest_bps`, `fee_vest_days`).

## Handoff (core -> market), two ft_transfer_call legs from core
| Leg | Token contract (predecessor) | `sender_id` | amount | msg |
|---|---|---|---|---|
| seed | USDC | core account | LP seed in micro-USDC | `{"v":1,"op":"seed_quote","launch_id":"7","token":"tok.near","payout_recipient":"alice.near","total_supply":"1000000000000000000000000000","charter_hash":"<64 hex>","terms":{FeeTerms}}` |
| token | the launch token | core account | LP bucket (all of it) | `{"v":1,"op":"open_pool_token","launch_id":"7"}` |

`FeeTerms` JSON: `{"total_fee_bps":100,"creator_bps":5000,"platform_bps":1500,"holders_bps":1500,"lp_bps":1000,"referral_bps":1000,"opening_fee_start_bps":500,"opening_decay_minutes":60,"fee_vest_bps":5000,"fee_vest_days":90}`.
Market validates the terms (sum of five slices 10000, creator 6000 max, platform 1500 min, holders 1000..3000, lp 500 min, holders+lp 2000 min, referral 2000 max, total_fee_bps 200 max, `total_fee_bps * creator_bps <= 1_000_000`, opening start <= 1000 bps and decay <= 120 min, vest_days <= 365). A violation refuses the leg (core's callback re-credits `lp_seed_inflight`).
A relaunch of an existing `launch_id` is refused. Return value: the market returns `"0"` when the leg is consumed, the full amount when refused. The `open_market` callback in core must treat a returned unused amount > 0 as failure and re-credit.
The pool is permanent: there is no LP withdrawal method. The payout recipient is read from `seed_quote.payout_recipient` (core copies the Charter `stream_recipient`, default creator) and is stored once; no method changes it (PRD 4b.2, INVARIANT 8).

## Trading messages
| Op | Token (predecessor) | msg |
|---|---|---|
| buy | USDC | `{"v":1,"op":"buy","launch_id":"7","min_out":"1000","receiver":"bob.near","referrer":"carol.near"}` |
| sell | pool token | `{"v":1,"op":"sell","launch_id":"7","min_out":"1000000","receiver":"bob.near"}` |

`min_out` is MANDATORY and must be > 0 (missing or "0" refuses with `R_MIN_OUT`). `receiver` defaults to `sender_id`. `referrer` is accepted and ignored in M-A (the referral slice returns to LP). Minimum trade: 1_000_000 quote (USDC $1; for a sell, the gross output before fee). Fee is always paid in USDC: on the input for buys, on the gross output for sells.

## Change methods
| Method | Caller | Effect |
|---|---|---|
| `claim(launch_id)` | payout recipient only (`R_NOT_AUTHORIZED` otherwise) | pays the unlocked creator slice (immediate part + linear vest) to the recipient; pull based; minimum 1_000_000 |
| `withdraw_platform()` | treasury or owner | pays accrued platform slices (all pools) to the treasury |
| `claim_owed(token_id)` | the owed account | pays tokens or USDC that an outbound transfer failed to deliver |
| `pause()` | guardian or owner | blocks `buy`, `seed_quote`, `open_pool_token`. NEVER blocks `sell`, `claim`, `withdraw_platform`, `claim_owed` |
| `unpause()` | owner | resumes |
| `new(owner, guardian, treasury, usdc, core, max_pool_reserve_q?, max_global_reserve_q?)` | init | caps default 5_000_000_000 and 15_000_000_000 micro-USDC (DN-17 interim) |

All outbound payments follow debit-before-outbound: the counter moves first, then `ft_transfer`; a callback that never panics re-credits on failure (creator and platform counters are restored; failed swap payouts become `owed`).

## Views (all return JSON; u128 as strings)
- `get_config()` -> `{owner, guardian, treasury, usdc, core, paused, max_pool_reserve_q, max_global_reserve_q, global_q}`
- `get_pool(launch_id)` -> `null` or `{launch_id, token, quote, state: "AwaitSeed"|"Open", q, t, opened_ns, payout_recipient, total_supply, charter_hash, terms}`
- `quote_buy(launch_id, amount_in, now_ns?)` -> `{ok, code?, out, fee_total, fee_bps_applied, creator, platform, holders, lp, referral, surcharge, q_after, t_after, price_impact_bps}`
- `quote_sell(launch_id, amount_in, now_ns?)` -> same shape; `out` is net USDC to the seller
- `creator_status(launch_id)` -> `{recipient, accrued, unlocked, paid, claimable, epochs}`
- `ledger_report(launch_id)` -> the FeeLedger: `fee_total, acc_creator, acc_platform, acc_holders (0 in M-A), acc_referral (0), acc_lp, paid_creator, paid_platform, red_holders, red_referral, folded_unlocked, epoch_cursor`
- `solvency_report()` -> `{expected_usdc_custody, expected_token_custody: [{token, amount}], ok_reserves_le_bound}`; a test or the indexer compares with `ft_balance_of(market)`; custody >= expected means solvent (donations only add)
- `get_invariants()` -> `{k_non_decreasing_checked: true, slices_sum_checked: true, global_q_matches_pools, custody_identity}`

## Rule codes (logged, first token of the log line)
`R_PAUSED`, `R_BAD_MSG`, `R_UNEXPECTED_TOKEN`, `R_NOT_AUTHORIZED`, `R_NO_POOL`, `R_POOL_STATE`, `R_MIN_OUT`, `R_MIN_TRADE`, `R_MARKET_CAP`, `R_FEE_TERMS`, `R_DUP_LAUNCH`, `R_MATH`, `R_NOTHING_TO_CLAIM`, `R_PARK_FULL`.

## Fee router (the one place the split lives: `kruxa_logic::FeeTerms`; math in `crates/kruxa-market`)
Per swap: `fee_total = ceil(q_leg * rate_ppm / 1e6)`. `rate` = `total_fee_bps` after the opening window; inside the window it decays linearly from `opening_fee_start_bps` to `total_fee_bps` over `opening_decay_minutes` (all the surcharge goes to LP). The base part is cut by bps into creator, platform, holders, referral (floor), LP takes the remainder (dust). M-A routing: holders slice and referral slice are redirected to LP (no Hold Vault, no referral lots), reported as `red_holders` and `red_referral`, so in events `holders = 0` and `referral = 0` and `creator + platform + holders + lp + referral == fee_total` always.
Creator and platform slices leave the pool reserve into custody counters; LP slice stays in the quote reserve (permanent). Epochs: 24 h from `opened_ns`. Creator vest: of each epoch's creator slice `fee_vest_bps` vests linearly over `fee_vest_days` from the epoch close, the rest is claimable at once.
