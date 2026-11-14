# Railway: Kruxa backend

Same backend as `deploy/oracle/` and `deploy/render/`, on Railway. Testnet only. No secrets in this folder.
Railway config files cannot create volumes or variables, so those are dashboard steps (below). The full walkthrough
and the Render-or-Railway choice are in `docs/runbooks/hosting.md`, section "Render or Railway instead of Oracle".

## Files

| File | Use |
|---|---|
| `railway.json` | indexer + API. Builds `ops/Dockerfile`, health check `/api/health`, restart on failure. |
| `railway.keeper.json` | optional keeper daemon. Builds `deploy/oracle/Dockerfile.keeper`. |

Set the file per service: Service, Settings, Config-as-code, Railway Config File: `/deploy/railway/railway.json`
(or `/deploy/railway/railway.keeper.json`). Do not set a Root Directory: the Docker build context is the repo root.

## Indexer + API service

1. New Project, Deploy from GitHub repo, pick the repo. Name the service `kruxa-api`. Set the config file as above.
2. Volume: Service, right-click or Settings, Volumes, add a volume, mount path `/data`.
3. Variables (Raw Editor, paste):

       KRUXA_DB=/data/indexer.db
       KRUXA_NETWORK=testnet
       KRUXA_CORE=core3.kxi-root-1108.testnet
       KRUXA_MARKET=market3.kxi-root-1108.testnet
       KRUXA_LAUNCHER=demo-instant.kxi-root-1111.testnet
       KRUXA_START_HEIGHT=tip
       KRUXA_RPC_URL=https://rpc.testnet.near.org
       KRUXA_MAX_LAG=120
       KRUXA_INSTANT_DAY_SECONDS=86400
       RAILWAY_RUN_UID=0

   `RAILWAY_RUN_UID=0` makes the container run as root so it can write the volume (the image runs as user `node`, and a
   fresh volume is root-owned). Railway documents this variable for volume permission errors; UNVERIFIED for your
   account, so if the log shows `EACCES` or `unable to open database file`, this is the first thing to check.
   Do not set `PORT`: Railway injects it and the API reads it.
4. Settings, Networking, Generate Domain. You get `https://<name>.up.railway.app` with automatic HTTPS.
5. Verify: `curl -s https://<name>.up.railway.app/api/health` returns `"status":"ok"`.

## Keeper (optional, dry-run by default)

Add a second service from the same repo with config file `/deploy/railway/railway.keeper.json`. No volume needed.

       KEEPER_CORE=core3.kxi-root-1108.testnet
       KEEPER_ACCOUNT_ID=keeper.kxi-root-1108.testnet
       NEAR_RPC_URL=https://test.rpc.fastnear.com
       KEEPER_SEND=0
       KEEPER_INTERVAL_MS=30000

Railway has no secret files, so the key goes in as a variable instead: `KEEPER_KEY` (an `ed25519:` string, supported by
`services/keeper/src/near-chain.ts`). Add it as a sealed or hidden variable in the dashboard, never in this repo.
Only then set `KEEPER_SEND=1`.

## Watcher: not on Railway

The watcher reads its two keys only from file paths (`KRUXA_NEAR_KEY`, `KRUXA_RELAYER_KEY` in `relayer/src/watcher-cli.ts`)
and Railway offers no secret files. Run the watcher on Render (`deploy/render/render-daemons.yaml`) or leave it off.
