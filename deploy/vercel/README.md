# Vercel: the Kruxa app (Next.js)

Hosts `app/` only. The backend is on Oracle (`deploy/oracle/`). Testnet only.

## Project settings

| Setting | Value |
|---|---|
| Root Directory | `app` |
| Framework | Next.js (auto) |
| Install Command | `npm ci` (lockfile: `app/package-lock.json`) |
| Build Command | `next build` (plain, NOT `build:testnet`: that script sources `.env.testnet`, which Vercel does not have) |
| Node.js Version | 24.x |
| Production branch | `main` |

`deploy/vercel/vercel.json` mirrors this. Copy it to `app/vercel.json` only if you prefer config in git; the dashboard values are enough, and the file is not required.

## Environment variables

Paste `env.testnet.example` into Settings, Environment Variables. Every key is a public `NEXT_PUBLIC_*` value (account ids and URLs). They are baked into the bundle at build time, so a change needs a redeploy. `lib/env-example.test.ts` keeps `app/.env.example` equal to the keys the code reads.

- Point the app at the backend: `NEXT_PUBLIC_KRUXA_API=https://<API_DOMAIN>` (the Oracle Caddy hostname). The browser calls it directly; the API already answers CORS for any origin. https is required, an http API is blocked as mixed content.
- `NEXT_PUBLIC_INSTANT_MODE=1` shows Instant launches in Create. `0` turns on the kill switch card. Redeploy after changing it.
- `NEXT_PUBLIC_KRUXA_ENV` and `NEXT_PUBLIC_NEAR_NETWORK` stay `testnet`.
- NEVER set `NEXT_PUBLIC_MAINNET_CONFIRMED` (the mainnet confirmation variable) in any Vercel environment, Production or Preview. Only the owner sets it, per action, and mainnet stays refused (R_MAINNET_GATE) without it. If it appears in the Vercel UI, delete it.

## Snapshot fallback (RECORDED mode)

When the API is unreachable the app serves static JSON from `/snapshot/api/...` on the same site, labelled RECORDED. The folder does not exist in the repo by default (`app/public/snapshot` is absent), so without it a backend outage shows errors instead of recorded data.

Bake and ship, from the repo root:

    # Option A, today (committed testnet bake, core3 + market3):
    cp -R evidence/indexer-testnet/snapshot-core3 app/public/snapshot
    # Option B, fresh from the live database on Oracle (nightly backup.sh already bakes it):
    scp -r <vm-user>@<vm>:/srv/kruxa/data/snapshot app/public/snapshot
    #   or on the VM: deploy/oracle/bake-snapshot.sh

Then commit `app/public/snapshot` and push to `main`; Vercel redeploys and ships it with the site (about 400 KB). Refresh it after every meaningful batch of launches, or the fallback shows old data (the strip prints the bake time).

Note: the committed Option A bake covers only the launches indexed at that time, and `/api/health` in a snapshot reports `status: "snapshot"`.

## Build check

`cd app && npx next build` with the testnet env passes locally (see the hosting runbook for the exact env line). `/llms.txt` is statically generated, so it prints whatever `NEXT_PUBLIC_KRUXA_API` was at build time.

## Rollback

Vercel, Deployments, pick the last good one, Promote to Production (under a minute). An env var mistake is fixed by editing it and redeploying.
