# Kruxa indexer and API

Node 24, zero runtime dependencies (`node:sqlite`, native type stripping). Tails NEAR via neardata.xyz, parses NEP-297
`EVENT_JSON` events (standard `kruxa`, 1.0.0) from the configured core and market contracts into one SQLite file (WAL),
and serves `docs/interfaces/api.openapi.yaml` from `services/api`.

    make -f make/indexer.mk indexer-demo     # candle series from fixtures (root Makefile must include make/*.mk)
    make -f make/indexer.mk indexer-test     # all tests
    KRUXA_NETWORK=fixture ops/run.sh         # serve fixture data on :8787 (every number says source: fixture)
    KRUXA_NETWORK=testnet KRUXA_CORE=<acct> KRUXA_MARKET=<acct> ops/run.sh

Rules the parser enforces: only logs from the configured contract accounts count, only events valid for that contract
kind, only from receipts that did not fail. Replay is by canonical order (block height, receipt position, log index);
`state_hash` in `/api/health` is a sha256 of the whole read model and is equal for equal events.

Event fields the fold reads (names follow core `events.rs` and ARCHITECTURE 5.8; missing optional fields become `null`
in the API, never guesses): `charter_created` may carry `soft_cap`, `min_funders`, `stream_days`, `payout_recipient`,
`token_decimals`; `pool_opened` may carry `quote_reserve`, `token_reserve`, `fee_bps`, `creator_bps`, `payout_recipient`,
`mint_authority`, `freeze_authority` (null means revoked); `swap` carries `launch_id, side, trader, amount_in, amount_out,
fee_total`, five fee slices (flat `fee_*` or a `slices` object) and the reserves after.
