# REQ-ui-market (from U2, market UI)

Readers: indexer/API owner (I), wallet layer owner, U1 (layout). The token page works without these and shows "unknown" for any missing fact.

## REQ-UI-1: token page data (API)
`GET /api/token/{id}` should carry, inside `pool`: `token` (launch token account, needed to build a sell), `market` (market contract account), `fee_terms` (FeeTerms as logged by `pool_opened`), `total_supply` (base units, for market cap). Top level: `external_pools: [{venue:"meteora", pool, url}]`, present only when a pool is verified on chain. Today the UI falls back to a NEAR RPC `get_pool` view on `NEXT_PUBLIC_MARKET_ACCOUNT`; in fixture mode there is no chain, so the quote preview and fee panel show "unknown".

## REQ-UI-2: fixture fee slices
Fixture swaps log a non-zero `holders` and `referral` slice, but MARKET-ABI M-A redirects both to LP (events carry `holders = 0`, `referral = 0`). The fixture generator should follow the ABI.

## REQ-UI-3: wallet layer
Add `'trade'` to `WalletAction` and `ACTION_LABEL` in `lib/wallet`. U2 registers the label at runtime in `lib/market/wallet-bridge.ts` as a stopgap; delete it once added. A NEAR-only gate for `trade` is also wanted (U2 gates on `sessions.near` itself).

## REQ-UI-4: layout (U1)
- Mount `<WalletProvider>` in the root layout (the token page mounts its own if absent).
- `main` is capped at 760px by `globals.css`; the market CSS widens it with `main:has(.mkt-root)`. A per-route layout width would be cleaner.
- Nav needs a way into `/token/[id]` (the launch feed rows and the launch page when a pool is open).
- `/launches`, `/charter` and `/launch/[id]/verify` are linked from the token page.

## Env
`NEXT_PUBLIC_KRUXA_API` (default http://localhost:8787), `NEXT_PUBLIC_MARKET_ACCOUNT` (default market.kruxa.testnet), `NEXT_PUBLIC_USDC_ACCOUNT`, `NEXT_PUBLIC_NEAR_RPC`, `NEXT_PUBLIC_EXPLORER_TX`. Dependency added: `lightweight-charts@5.2.1` (exact).
