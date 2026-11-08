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

Event shapes are documented in `docs/interfaces/EVENTS.md`. Optional fields that the core does not emit yet (`name`, `soft_cap`,
`min_funders`, `stream_days`, `total_supply`, genesis and `external_pool` events) become `null` or `unknown` in the API, never guesses.
Chart price is `q / t` after each swap (EVENTS.md); candle volume is gross USDC. A database written by an older schema version is
dropped and refolded from its stored events when opened.
