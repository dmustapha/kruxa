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

Instant launches (CHANGE-ORDER-7): add the launcher account to `KRUXA_LAUNCHER`. Launcher events are read from INSTANT-ABI section 9
(the launcher is a third contract kind next to core and market). Integrity rules: launcher events may only name ids at or above
1,000,000,000, core events only ids below, and a market `pool_opened` whose `mode` does not match its id range is refused. `mode` in the
API is the market's authenticated pool mode once a pool is open. Vesting is computed at the API clock from `instant_opened` time,
`cliff_days` and `vest_days`; set `KRUXA_INSTANT_DAY_SECONDS=10` only for the launcher's demo profile (the fixture profile uses 600).

## Operations, custody and governance events (1.3.0)

The core's later events are all folded; the raw rows stay in `events` and a typed projection answers the common questions. A schema change drops the derived tables and
refolds the stored events on open, so upgrading needs no migration step.

| Events | Projection | Served by |
|---|---|---|
| `paused`, `frozen`, `unpaused` (core and launcher), `market_paused`, `genesis_paused`, `genesis_resumed`, `genesis_relayer_set`, `beta_opened`, `market_set`, `*_cap_*` | `flags` (`state:core`, `state:launcher`, `state:market`, `state:genesis`, `cap:global`, `cap:launch`, ...) | `/api/ops/status` |
| `halted`, `resumed` | `halts` (one row per launch, halt count, reason) | `/api/ops/halts`, `halted` on every launch summary |
| `upgrade_queued`, `upgrade_cancelled`, `upgraded` | `upgrades` (queued, cancelled, applied, superseded) | `/api/ops/upgrades`, `/api/ops/status` |
| `force_resolve_queued`, `op_force_resolved` | `force_resolves` (queued, executed) | `/api/ops/force-resolves` |
| `solvency_report` | `solvency_reports` | `/api/ops/solvency`, `/api/ops/status` |
| `owed_near_*` (core), `owed_credited`, `owed_claimed` (market, launcher) | `owed` (credited minus claimed) | `/api/ops/owed` |
| `creator_alloc_claimed`, `tokens_swept`, `token_delivery_refused`, `stream_lengthened`, `refund_batch`, `refund_route_set`, `orphan_credit_refused`, `deposit_rejected_refundable`, `payout_resolved` kinds `AllocClaim` and `Sweep` | `launch_custody` (a failed leg re-credits, like the contract) | `/api/launch/{id}/custody`, creator desk stream meter |
| `genesis_reopened`, `f0_message_registered`, `f0_sign_requested`, `attest_log`, `genesis_aborted` | extra columns on `genesis` (reopen count, abort reason, F0 messages, attestations) | `/api/launch/{id}/genesis`, `genesis` on launch and token pages |
| `contributed`, `walked` | the rolling `book_hash` is replayed (`launches.book_hash_recomputed`) | `fold_ok` in `/api/verify/{id}` |

Everything else with an `EVENT_JSON` line from a configured contract is still listed by `/api/ops-log` (categories `pause caps config halt upgrade force_resolve solvency owed custody refunds genesis treasury`, filters `scope`, `category`, `launch_id`).

## Endpoint list (OpenAPI: `docs/interfaces/api.openapi.yaml`, version 1.3.0)

Feed and launches: `/api/health`, `/api/stats`, `/api/launches`, `/api/launch/{id}`, `/api/launch/{id}/custody`, `/api/launch/{id}/genesis`, `/api/verify/{id}`.
Token: `/api/token/{id}`, `/candles`, `/trades`, `/holders`, `/depth`, SSE `/api/stream`. People: `/api/creator/{account}`, `/api/portfolio/{account}`.
Operations: `/api/ops-log`, `/api/ops/status`, `/api/ops/upgrades`, `/api/ops/halts`, `/api/ops/force-resolves`, `/api/ops/solvency`, `/api/ops/owed`.
Exports: `/api/export/launches.csv`, `/api/export/trades.csv`, `/api/export/creator/{account}/claims.csv`.

Which page reads what (APP-SPEC): `/ops-log` reads `/api/ops-log` (and `/api/ops/upgrades` for the countdown); `/status` reads `/api/health` plus `/api/ops/status` (pause flags, caps,
pending upgrade, halted launches, latest solvency report and its age); the token page reads `/api/token/{id}` (`genesis` now carries `reopen_count`, `abort`, `f0`, `attestations`) and
`/api/launch/{id}/custody` for allocation, sweep and refund state; the trial page reads `halted` and `halt` from `/api/launch/{id}`.
`KRUXA_NETWORK=fixture` serves `generateFullFixtureBlocks` (base launches plus every event above), so each of those pages has data offline. Every `/api/ops/*` field says `observed`
or `since_block`: a state with no event indexed is reported as default and not as checked.

## Sources: neardata, RPC block-scan fallback

neardata.xyz is the primary source. Set `KRUXA_RPC_URL=<near rpc>` and the process falls back to `RpcSource` (`src/rpc.ts`) per call when neardata errors, with a circuit breaker
(three failures, one minute cooldown), and returns to neardata when it answers again; `/api/health` `data_source` shows which one served last. `KRUXA_RPC_ONLY=1` uses the scan alone.
There is no RPC method that lists the receipts executed in a block, so a block is rebuilt from `EXPERIMENTAL_tx_status` of the transactions included in the last 40 blocks that touch a
configured account (sent to it, signed by it, or an `ft_transfer(_call)` to it). Known limits, also in `RpcSource.limits`: a receipt that executes more than 40 blocks after its
transaction is missed; flows started by a third party that never names a configured account (an Intents withdrawal ending in `ft_on_transfer` to core) are missed unless
`KRUXA_RPC_SCAN_ALL=1`, which resolves every transaction (heavy on mainnet); in-block order follows the receipt tree. Events already stored keep the order they first arrived with.
Tested against a fake JSON-RPC built from fixture blocks (same state hash as neardata), never against a live node.

## Snapshot mode

    node services/api/src/snapshot.ts bake <db> <network> <outdir> [core,..] [market,..] [launcher,..]
    node services/api/src/snapshot.ts serve <outdir> [port]          # 127.0.0.1:8788, read-only

`bake` writes the feed, stats, ops pages and, per launch, the launch, custody, genesis, token, trades and four candle series as JSON files that mirror API paths. `serve` answers the same
paths from those files, with `x-kruxa-data: snapshot`, `/api/health` reporting `status: "snapshot"` with the bake time and block, 404 `not_in_snapshot` for pages not baked and
404 `snapshot_no_stream` for SSE. `services/api/test/ops.test.ts` bakes the fixture store, serves it and compares every page with the live API.

## Fold check

`fold_ok` in `/api/verify/{id}` means the indexer replayed the contract's rolling `book_hash` from the contributed and walked events and it matched the logged hash at every event.
It is not a comparison with the contract's `get_state` (the indexer makes no view calls); `scripts/verify.sh` stays the independent check.
