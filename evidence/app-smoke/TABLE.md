# App route smoke

Tree: this branch. App: next dev --webpack on 127.0.0.1:3111 with app/.env.testnet and NEXT_PUBLIC_KRUXA_API=http://127.0.0.1:8788.
Data: services/api snapshot mode (`node services/api/src/snapshot.ts serve evidence/indexer-testnet/snapshot-core3 8788`), NO indexer running, no wallet, no mainnet.
Browser: Chrome via playwright, headless. "Recorded strip" = the RECORDED snapshot strip appears (only pages that read the API can show it). Overflow = horizontal page scroll.

| Route | Status 375 / 1280 | Overflow 375 | Recorded strip | Console errors 375 / 1280 | Error kinds |
|---|---|---|---|---|---|
| / | 200 / 200 | no | yes | 1 / 0 | 404 for an endpoint not baked in the snapshot (expected, page shows its honest empty state) |
| /launches | 200 / 200 | no | yes | 0 / 0 | none |
| /launch/9 | 200 / 200 | no | yes | 24 / 24 | RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /launch/1 | 200 / 200 | no | yes | 24 / 24 | RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /token/1 | 200 / 200 | no | yes | 46 / 48 | 404 for an endpoint not baked in the snapshot (expected, page shows its honest empty state); RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /create | 200 / 200 | no | n/a | 4 / 4 | RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /creator | 200 / 200 | no | n/a | 0 / 0 | none |
| /portfolio | 200 / 200 | no | n/a | 0 / 0 | none |
| /charter | 200 / 200 | no | n/a | 0 / 0 | none |
| /legal/terms | 200 / 200 | no | n/a | 0 / 0 | none |
| /legal/privacy | 200 / 200 | no | n/a | 0 / 0 | none |
| /legal/risk | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/how-it-works | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/creators | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/buyers | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/fees | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/verify | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/security | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/charter | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/faq | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/glossary | 200 / 200 | no | n/a | 0 / 0 | none |
| /docs/api | 200 / 200 | no | n/a | 0 / 0 | none |
| /ops-log | 200 / 200 | no | yes | 24 / 24 | RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /status | 200 / 200 | no | yes | 24 / 24 | RPC CORS (browser to public NEAR RPC from 127.0.0.1); Failed to load resource: net::ERR_FAILED |
| /settings | 200 / 200 | no | n/a | 0 / 0 | none |
| /insights | 200 / 200 | no | yes | 0 / 0 | none |
| /search | 200 / 200 | no | n/a | 0 / 0 | none |
| /u/creator-a.kxi-root-1108.testnet | 200 / 200 | no | yes | 4 / 4 | 404 for an endpoint not baked in the snapshot (expected, page shows its honest empty state) |
| /llms.txt | 200 / 200 | no | n/a | 0 / 0 | none |
| /AGENTS.md | 200 / 200 | no | n/a | 0 / 0 | none |
