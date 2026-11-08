# Instant launcher ABI (owner: workstream L; readers: I indexer, U app, D docs, T tests)

Status: DRAFT 1.0.0, 2026-11-08. Source: CHANGE-ORDER-7 (sections 2.3 to 2.14), DECISIONS-PACK1 fourteenth block (R-INSTANT-NOW, D-2 to D-11 adopted provisionally). Contract: `contracts/instant`, account `instant.kruxa.near`, wasm `kruxa_instant_contract`. Pure logic: `crates/kruxa-instant`.
Not deployed, not signed, nothing on mainnet. Where this file and the code disagree the code on branch `ws/instant` wins and this file is fixed in the same commit.

Conventions (same as MARKET-ABI): u128 and u64 are decimal strings in JSON. USDC has 6 decimals (micro-USDC); the launch token has 6 decimals. `ft_on_transfer` messages are JSON objects with `"v":1` and an `"op"`. Panics (user calls) start with the rule code: `R_X: text`. `ft_on_transfer` and every callback NEVER panic: a refusal returns the full amount and logs the code as the first token of a log line.
Times are block nanoseconds. `unit` below means one "day": 86 400 s on the `mainnet` and `testnet` profiles, 10 s on the `demo` profile (labelled demo account and sandbox tests only, same wasm).

## 1. What it is

A second launch mode. The creator pays a NEAR deposit, the launcher creates a fixed-supply factory token, the creator seeds the pool with their own USDC, and anyone opens the pool at the market. No trial, no verdict, no Walk, no buyer refund. Core is not touched. The market must be ABI 1.1.0 (second allowed handoff sender, ids at or above 1 000 000 000).

```
creator --(1) create_instant {params} + NEAR deposit-------------> launcher --create_token--> factory
creator --(2) USDC.ft_transfer_call(launcher, seed_q, seed_instant)-> launcher.ft_on_transfer
anyone  --(3) open_instant(launch_id)--> launcher --USDC.ft_transfer_call(market, seed, seed_quote)--> market
                                         launcher --(after the seed was consumed) token.ft_transfer_call(market, n_pool, open_pool_token)
```
Legs are SEQUENTIAL (seed first, token leg only after the seed leg was consumed, sent from the seed callback). So the market never parks a launcher token leg, and "the seed is refundable only while the market consumed none of it" has no half-state. If the token leg is refused it is retried by calling `open_instant` again.

`launch_id = 1_000_000_000 + n` (n from 0). The market derives `mode = "instant"` from the authenticated sender (this launcher), never from the message.

## 2. Status machine

```
Creating --factory ok + supply ok--> TokenReady --seed accepted--> Seeded --open_instant--> Handoff --seed and token legs consumed--> Open
   |                                    |                              |                        |
   +--factory or supply fail--> CreationFailed                         |                        +--a leg refused--> Handoff (retry open_instant)
                                        +--abandon_instant (creator any time, anyone after 24 u)--> Abandoned
                                                                       +--abort_instant (creator, 72 u after the seed, seed leg NOT consumed)--> Aborted
```
No edge leaves `Open`. No edge returns a seed once the market consumed it. `Open` is recorded when the token leg callback confirms (`opened_at` = that block time, within seconds of the market's `opened_ns`).

## 3. Change methods

| Method | Caller | Effect |
|---|---|---|
| `new(owner, guardian, treasury, usdc, factory, profile)` | init | `profile` in `mainnet` / `testnet` / `demo`. `creator_gate` is true only on `mainnet`. Launch fee is 10 USDC on `mainnet`, 0 otherwise. Defaults: seed range 100..1000 USDC, aggregate unconsumed-seed cap 3000 USDC |
| `create_instant(params, payout_recipient?) -> Promise` (payable) | any (gate permitting) | checks in order: not paused/frozen (`R_PAUSED`/`R_FROZEN`), creator gate (`R_CREATOR_GATE`, refuses EVERY account including the owner until `open_beta`), rate limit (`R_RATE_LIMIT`: one instant launch per account per 24 u), symbol (`R_SYMBOL`, `R_SYMBOL_RESERVED`), `validate_instant` first violation, deposit (`R_DEPOSIT`: attached >= `required_deposit()`, the excess is sent back at once). Creates the record (status `Creating`), calls the factory `create_token` (whole supply minted to the launcher), verifies `ft_total_supply == n_total` AND `ft_balance_of(launcher) == n_total` |
| `finalize_creation(launch_id) -> Promise` | any | recovery: re-run the verification when still `Creating` 10 minutes after create (`R_TOO_EARLY` before) |
| `ft_on_transfer(sender_id, amount, msg)` | the USDC contract | op `seed_instant` (section 4). Never panics |
| `open_instant(launch_id) -> u8` | ANY | needs `Seeded` or `Handoff`, not paused, market set (`R_NO_MARKET`). Locks `market` on first use. Debit first, then sends ONE leg (seed, or the token leg once the seed was consumed). Returns 1. Nothing to send or a leg in flight: `R_INSTANT_STATE` |
| `abandon_instant(launch_id)` | creator any time; anyone else 24 u after creation (`R_TOO_EARLY`) | status `TokenReady` only (`R_INSTANT_STATE`). Becomes `Abandoned`; deposit refundable minus the factory deposit and record storage. The token stays in the launcher and is never listed |
| `abort_instant(launch_id) -> Promise` | creator | status `Seeded` or `Handoff`, 72 u after the seed (`R_TOO_EARLY`), `seed_sent == 0` and `seed_inflight == 0` (`R_INSTANT_STATE`: IL-8). Becomes `Aborted`; pays the whole seed (including the launch fee) back to the creator (owed on failure); the token is dead and its allocation never vests |
| `reclaim_deposit(launch_id) -> Promise` | creator | pays `deposit_refundable` after `CreationFailed`, `Abandoned` or `Aborted` as a plain NEAR transfer (debit first). `R_NOTHING_TO_CLAIM` when zero. LIMIT: a NEAR transfer that fails (the creator account no longer exists) bounces back to the launcher and is not tracked as owed |
| `claim_vested(launch_id, amount?) -> Promise` | payout recipient only (`R_NOT_AUTHORIZED`) | pays `amount` (default all) of `unlocked(now) - claimed` in the launch token. `amount > claimable` panics `STREAM_CAP: requested X > claimable Y` (same string and cap semantics as core `draw`). Nothing claimable (cliff not over, or already claimed) with no amount: `R_NOTHING_TO_CLAIM`. Debit before outbound; a failed transfer becomes an owed token balance |
| `claim_owed(token_id) -> Promise` | the owed account | pays tokens or USDC an outbound transfer failed to deliver |
| `withdraw_platform() -> Promise` | treasury or owner | pays accrued launch fees (USDC) to the treasury (owed on failure) |
| `pause()` | owner or guardian | blocks `create_instant`, seed acceptance, `open_instant`. Exits stay open |
| `freeze()` | owner or guardian | also blocks exits; auto-expires to paused after 7 days |
| `unpause()` | owner | resumes |
| `open_beta()` | owner | one-way; opens the creator gate (`R_NOTHING` if already open). Procedural precondition: $KRUXA genesis done and BLK-1 closed |
| `set_market(account)` | owner | before the first `open_instant`; locked afterwards (`R_NOTHING`) |
| `reserve_symbol(symbol)` | owner | adds a symbol to the reserved list (event `symbol_reserved`); `KRUXA` and the core reserved list are built in |
| `set_seed_cap(kind, value)` | owner or guardian | `kind` = `aggregate` (unconsumed seeds) or `per_launch` (max seed). A value BELOW the current cap applies at once (not below the minimum seed, `R_CAP_GLOBAL`). A value at or above it is owner only and queued for 7 days (event `cap_queued`) |
| `apply_seed_cap(kind)` | any | applies the queued raise after the timelock (`R_NOT_YET`, `R_NOTHING`) |

Exits that stay open while PAUSED: `claim_vested`, `claim_owed`, `reclaim_deposit`, `abort_instant`, `abandon_instant`, `withdraw_platform`. Only FROZEN closes them. Gas: attach 300 Tgas to `open_instant` (it reserves 90 Tgas for the seed leg and 150 Tgas for the callback that sends the token leg).

## 4. Messages

Seed (creator -> launcher), `USDC.ft_transfer_call(receiver_id: launcher, amount, msg)`:
`{"v":1,"op":"seed_instant","launch_id":"1000000007"}`
Accepted only if: predecessor is the configured USDC (`R_UNEXPECTED_TOKEN`), message valid (`R_BAD_MSG`), launch exists and status is `TokenReady` (`R_INSTANT_STATE`), `sender_id == creator` (`R_NOT_CREATOR`), `amount == seed_q` exactly (`R_SEED_AMOUNT`), aggregate unconsumed seeds + amount <= cap (`R_CAP_GLOBAL`), not paused (`R_PAUSED`). Accepted: returns `"0"`, status `Seeded`, `fee_held = launch_fee`, `seed_due = seed_q - launch_fee`. Refused: returns the full amount.

Launcher -> market, seed leg (`USDC.ft_transfer_call(market, seed_due, msg)`):
`{"v":1,"op":"seed_quote","launch_id":"1000000007","token":"abc.factory.near","payout_recipient":"alice.near","creator":"alice.near","total_supply":"1000000000000000","charter_hash":"<64 hex>","supply_model":"near_factory_fixed","terms":{FeeTerms}}`
No `mint_authority` / `freeze_authority` (there is no Solana mint). There is NO announced-open delay in this release: the market (ABI 1.1.0) does not implement `trade_from_ns`, so the launcher does not offer `trade_delay_secs` (CO-7 2.7 listed it as cut-first; dropping it keeps the charter honest). Trading starts when the pool opens; the opening-fee decay (500 bps falling to the base over 60 minutes, surcharge to LP) is the only anti-snipe tool besides the declared-wallet self-buy block.
Token leg (`token.ft_transfer_call(market, n_pool, msg)`): `{"v":1,"op":"open_pool_token","launch_id":"1000000007"}`. Before the token leg the launcher registers the market on the token (`storage_deposit`, 0.00125 NEAR) and forwards 0.05 NEAR to the market for pool storage, once.

## 5. Parameters

`InstantParams` JSON (omitted fields take the default):
```
{ "name": "My Coin", "symbol": "MYC", "creator_alloc_bps": 500, "cliff_days": 7, "vest_days": 90,
  "seed_q": "250000000", "fees": {FeeTerms} }
```
| Field | Range | Default | Code |
|---|---|---|---|
| `name` | 1..=32 printable ASCII | required | `R_SYMBOL` (field `name`) |
| `symbol` | 2..=12 of `[A-Z0-9]`, not reserved, unused in the launcher | required | `R_SYMBOL`, `R_SYMBOL_RESERVED` |
| `creator_alloc_bps` | 0..=1000 | 500 | `R_ALLOC` |
| `cliff_days` | 7..=30 and <= `vest_days` | 7 | `R_VEST` |
| `vest_days` | 30..=365 | 90 | `R_VEST` |
| `seed_q` | 100 000 000..=`per_launch` cap (1 000 000 000) micro-USDC, and above the launch fee | 250 000 000 | `R_SEED_RANGE` |
| `fees` | the trial rules (`kruxa_logic` fee checks) plus `validate_market_terms`; default = standard 50/15/15/10/10, total 100 bps, opening 500 bps decaying over 60 minutes, creator fee vest 50% over 90 days | see left | `R_FEE_TOTAL`, `R_CREATOR_SHARE`, `R_CREATOR_TAKE`, `R_PLATFORM_FLOOR`, `R_PLATFORM_FIXED`, `R_HOLDER_RANGE`, `R_LP_RANGE`, `R_HOLDER_LP_FLOOR`, `R_REFERRAL`, `R_SPLIT_SUM`, `R_FEE_VEST`, `R_OPENING`, `R_FEE_TERMS` |

Derived: `n_total = 1_000_000_000 * 10^6` base units (the trial default supply; a test pins it to `TrialParams::example`), `n_alloc = floor(n_total * creator_alloc_bps / 10000)`, `n_pool = n_total - n_alloc` (exact). `pool_seed_q = seed_q - launch_fee`. Opening price per whole token = `pool_seed_q * 10^6 / n_pool` micro-USDC.
Deposit (`required_deposit()`): factory deposit 0.06 NEAR + record storage 0.02 + token registration of the market 0.00125 + market pool storage 0.05 = 0.13125 NEAR. Refunds always keep record storage; a verification failure or any later refund also keeps the factory deposit (the factory keeps it on the token account).

## 6. Vesting (IL-5)

`opened_at` is the time `Open` was recorded. `unlocked(t) = 0` if `t < opened_at + cliff`; else `linear_unlocked(n_alloc, opened_at, vest, t)` from `kruxa_math` (floor, `n_alloc` at or after `opened_at + vest`). `claimable = unlocked - claimed`. The allocation is held by the launcher; it is never in the pool and never sent anywhere except to the payout recipient by `claim_vested` (or the owed path). Nothing vests for `Abandoned`, `Aborted` or `CreationFailed`.

## 7. Views (JSON)

- `get_config()` -> `{owner, guardian, treasury, usdc, factory, market, market_locked, profile, creator_gate, paused ("None"|"Paused"|"Frozen"), launch_fee, factory_deposit, seed_min, seed_max, seed_cap_aggregate, pending_caps, unit_ns, next_launch_id, platform_unpaid}`
- `required_deposit()` -> yocto string
- `preview_instant(params, creator?, payout_recipient?)` -> `{ok, violations:[{code, field, got, limit}], required_deposit, n_total, n_alloc, n_pool, pool_seed_q, launch_fee, open_price_micro_per_token}` (with `creator` it also reports gate, pause, rate limit and symbol availability)
- `get_instant(launch_id)` -> `null` or `{launch_id, mode:"instant", status, creator, payout_recipient, name, symbol, token, total_supply, n_alloc, n_pool, creator_alloc_bps, cliff_days, vest_days, seed_q, launch_fee, pool_seed_q, terms, charter_hash, created_at_ns, seeded_at_ns, opened_at_ns, seed_due, seed_inflight, seed_sent, fee_held, tokens_unsent, tokens_inflight, tokens_sent, alloc_claimed, deposit_paid, deposit_refundable}`
- `get_phase(launch_id)` -> `{status, step ("create"|"seed"|"open"|"done"|"dead"), next_action ("seed"|"open_instant"|"retry_open_instant"|"none"), can_cancel, can_abandon_at_ns, can_abort_at_ns}`
- `get_vesting(launch_id)` -> `{recipient, total, unlocked, claimed, claimable, cliff_end_ns, vest_end_ns}` (zeros before `Open`)

- `owed_of_account(account, token_id)` -> string (an owed token or USDC balance)

- `get_invariants(launch_id?)` -> `{usdc_custody_identity, usdc_custody (expected, at rest), usdc_expected, owed_usdc, seeds_held_le_cap, market_locked_consistent}`; with `launch_id` also `{token, token_custody (expected, at rest), token_custody_identity, supply_conservation (IL-1), claimed_le_unlocked, vest_bounds (IL-5)}`. A test or the indexer compares `usdc_custody` and `token_custody` with `ft_balance_of(launcher)`: custody >= expected means solvent, donations only add. Expected balances exclude amounts in flight to the market

## 8. Rule codes

`R_PAUSED`, `R_FROZEN`, `R_CREATOR_GATE`, `R_RATE_LIMIT`, `R_SYMBOL`, `R_SYMBOL_RESERVED`, `R_ALLOC`, `R_VEST`, `R_SEED_RANGE`, `R_SEED_AMOUNT`, `R_CAP_GLOBAL`, `R_FEE_*` (as listed in section 5), `R_DEPOSIT`, `R_NOT_CREATOR`, `R_NOT_AUTHORIZED`, `R_UNEXPECTED_TOKEN`, `R_BAD_MSG`, `R_INSTANT_STATE`, `R_TOO_EARLY`, `R_NOTHING_TO_CLAIM`, `R_NOTHING`, `R_NOT_YET`, `R_NO_MARKET`, `R_NO_LAUNCH`, `R_MATH`, and the string `STREAM_CAP` (claim above the claimable amount).

## 9. Events (NEP-297, standard `kruxa`, version `1.0.0`, emitted by the launcher account)

| Event | Data |
|---|---|
| `instant_created` | `launch_id, mode:"instant", creator, payout_recipient, symbol, name, total_supply, token_decimals, creator_alloc, pool_tokens, cliff_days, vest_days, seed_q, launch_fee, terms, charter_hash` |
| `instant_token_ready` | `launch_id, token` |
| `instant_creation_failed` | `launch_id, code:"R_TOKEN_CREATE", reason` |
| `instant_seeded` | `launch_id, seed, launch_fee` |
| `instant_handoff` | `launch_id, leg ("Seed"/"Token"), amount, market` |
| `instant_leg_resolved` | `launch_id, leg, amount, used, unused` |
| `instant_opened` | `launch_id, token, market, q, t, opened_at` |
| `instant_abandoned` | `launch_id, by, refundable_deposit` |
| `instant_aborted` | `launch_id, by, refunded_seed, refundable_deposit` |
| `alloc_claimed` | `launch_id, recipient, amount, claimed_total, unlocked_total` |
| `fee_credited` | `launch_id, amount` (launch fee moved to the platform once the seed was consumed) |
| `platform_withdrawn` | `to, amount` |
| `deposit_reclaimed` | `launch_id, to, amount` |
| `owed_credited` / `owed_claimed` | `account, token, amount, reason` |
| `paused` / `frozen` / `unpaused` | `by` / `by, until` / none |
| `beta_opened` | `by` |
| `market_set` | `market` |
| `symbol_reserved` | `symbol` |
| `cap_lowered` / `cap_queued` / `cap_applied` | `kind, value` / `kind, value, effective_at` / `kind, value` |

Indexer notes: `instant_created` inserts the launch (status `launching`), `instant_opened` sets `trading`, the market's `pool_opened` (mode `instant`) attaches by `launch_id >= 1e9`. `declared` trades: creator and payout recipient.

## 10. Invariants (INVARIANTS.md CO-7 numbering)

IL-1 supply conservation at `TokenReady` (both views checked); IL-2 no mint method; IL-3 custody (at rest, per token: balance >= `n_alloc - claimed + tokens_unsent + owed`; USDC: balance >= `seed_due + fee_held + platform_unpaid + owed`); IL-4 no method sends pool tokens anywhere except `market`, locked on first `open_instant`; IL-5 vesting above; IL-6 payout recipient fixed (no setter); IL-7 mode integrity (market side, namespace `>= 1e9`); IL-8 seed refundable only while `seed_sent == 0 && seed_inflight == 0`.

## 11. What this file depends on in the market (ABI 1.1.0, workstream M)

`set_launcher(launcher)` called by the market owner; `seed_quote` from the launcher accepted for ids >= 1e9 with `creator` in the message; seed-time cap check `R_MARKET_CAP`; `R_SELF_BUY` for creator and payout recipient on buys; `R_ID_NAMESPACE` on the wrong id range; `pool_opened` and `get_pool` carry `mode` and `creator`. `trade_from_ns` (announced open) is not in market 1.1.0 and not used.
