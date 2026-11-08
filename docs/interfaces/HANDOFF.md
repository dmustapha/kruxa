# Handoff `open_market` (core -> market)

Owner of this file: workstream A (core side). Receiving side: workstream M (`docs/interfaces/MARKET-ABI.md`, section "Handoff", is the frozen ABI this file follows).
Source: ARCHITECTURE 5.1 and 5.13 D-3, PLAN C3.4 item 3, PRD GR-15. Status: FROZEN 1.0.0 for the core wasm freeze (Nov 10 20:00 UTC).

## Core method

```
open_market(launch_id: U64) -> u8        // ANY caller; returns how many legs were sent (0 to 2)
set_market(account: AccountId)           // OWNER; stores the market account. Refused once any open_market has run (R_NOTHING).
get_config().market                      // null until set
get_market_link(launch_id) -> {opened, lp_seed_due, lp_seed_inflight, lp_seed_sent, lp_tokens_inflight, lp_tokens_sent, lp_tokens_total}
```

Preconditions (otherwise `R_NOT_CLEAR`, `R_PAUSED`, `R_FROZEN` or `R_NOTHING`):
1. core not PAUSED or FROZEN (`require_live`); `market` is set (`R_NOTHING` "market account not set").
2. launch `Passed`, every position settled, `sweep_residue` done (the LP seed is final only after the sweep).
3. the launch fee is fully paid (`launch_fee_paid == launch_fee_due`, nothing in flight) and every Intents proceed is consolidated (`consolidated == spent_intents`, `consolidating == 0`), so the native USDC balance covers the seed.
4. something is left to send: `lp_seed_due > 0` or `lp_tokens_total - lp_tokens_sent - lp_tokens_inflight > 0`.
`open_market` is never called inside `settle` (settle stays promise-free).

## Debit first

Before any promise: `lp_seed_due -> lp_seed_inflight` (all of it) and the unsent token bucket -> `lp_tokens_inflight`. Then up to two `ft_transfer_call` legs, each with 1 yoctoNEAR and its own callback `on_market_leg`:

| Leg | Contract called | receiver | amount | msg |
|---|---|---|---|---|
| seed | USDC | market | `lp_seed_due` (micro-USDC) | `{"v":1,"op":"seed_quote","launch_id":"7","token":"tok.near","payout_recipient":"alice.near","total_supply":"<n_total>","charter_hash":"<64 hex>","mint_authority":null,"freeze_authority":null,"terms":{FeeTerms}}` |
| token | the launch token | market | `n_lp` (Charter `derived.n_lp`, all of it) | `{"v":1,"op":"open_pool_token","launch_id":"7"}` |

`mint_authority` and `freeze_authority` are `null` (revoked) because the genesis plan only accepts revoked authorities (R_GENESIS_AUTH); they describe the SOLANA mint, not the NEAR factory token. `terms` is the Charter's `params.fees` (`kruxa_logic::FeeTerms`, the snapshot taken at `create_trial`), `payout_recipient` is the Charter `stream_recipient`, `total_supply` is `derived.n_total`, `charter_hash` is the stored Charter hash. Either leg may land first on the market side (MARKET-ABI change 2). A leg is sent only if its amount is greater than zero, so a retry after a partial failure sends only the missing leg.

## Callback and re-credit

`on_market_leg(launch_id, leg, amount)` reads the `ft_transfer_call` result, which is the amount the market USED (NEP-141). The market returns `"0"` unused-by-refusal as: consumed means result `amount`; refused means result `0` (the token contract refunds core). If the promise itself failed, used is `0`.
- `used = min(result, amount)`; `unused = amount - used`.
- seed: `lp_seed_inflight -= amount`, `lp_seed_sent += used`, `lp_seed_due += unused`, `global_held -= used`.
- token: `lp_tokens_inflight -= amount`, `lp_tokens_sent += used`.
- event `market_leg_resolved {launch_id, leg, amount, used, unused}`; when both legs are fully sent, event `market_opened {launch_id, lp_seed, lp_tokens, market}` once. A failure leaves everything retryable by calling `open_market` again.
The callback never panics on market data.

## Ledger identities touched (D-3, "one counter")

- L4 bucket identity: `launch_fee_due + (lp_seed_due + lp_seed_inflight + lp_seed_sent) + stream_total + excess_pool == open + spent`.
- I5 no overpay: `lp_seed_sent + lp_seed_inflight <= lp_seed_total` is implied by L4; `lp_tokens_sent + lp_tokens_inflight <= n_lp` is checked.
- native free balance (`draw`, `pay_launch_fee`) reserves `lp_seed_due + inflight + sent`.

## What M must do on receipt (restated from MARKET-ABI)

Authenticate `seed_quote` by `predecessor == usdc` and `sender_id == core`; accept the token leg only from the `token` named by the seed leg; validate `terms`; return `"0"` when consumed and the full amount when refused; never panic. A refused leg is re-credited by core.

## Tests

Failure modes run against `contracts/mock-market` (a stub implementing exactly this table; modes `accept`, `refuse_seed`, `refuse_token`, `panic`). The happy path also runs against the REAL market wasm (`tests/tests/handoff.rs`, `open_market_against_the_real_market_opens_the_pool_and_a_buy_works`; build it with `./scripts/market-build.sh`). Pool states on the market side are `AwaitToken` then `Open`.
