# App and services test record, 2026-11-11

Every log ends with its `exit=` line. Run on this branch tree, TESTNET and local only.

| Suite | Command | Result | Log |
|---|---|---|---|
| app typecheck | `npm run typecheck` | exit 0 | app-typecheck.log |
| app vitest | `npx vitest run` | 52 files, 513 tests, exit 0 | app-vitest.log |
| app next build | `npx next build --webpack` | exit 0, 30 static pages | app-next-build.log |
| services/indexer | `npm test` | 40 pass, exit 0 | services-indexer-test.log |
| services/api | `npm test` | 39 pass, exit 0 | services-api-test.log |
| relayer | `npm test` | 35 pass, exit 0 | relayer-test.log |
| services/venue | `npm test` | 6 pass, exit 0 | services-venue-test.log |

Notes:
- `next build` with turbopack refuses a symlinked node_modules in a worktree (app-next-build-turbopack-symlink-rejected.log, exit 1, environment only). The webpack build is the record.
- A `next build` writes a generated app/AGENTS.md; lib/claims.test.ts then fails its dash scan on it. It was deleted before the recorded vitest run; delete it after any local build.
- Indexer, relayer and venue logs were produced before the final small edits to app/ and services/api/src/snapshot.ts; those touch only app and services/api, whose logs are from the final tree.
