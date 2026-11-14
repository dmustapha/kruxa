# Hosting runbook: Vercel (app) and Oracle Cloud (backend)

Goal: durable hosting through Nov 25 (DN-16), testnet only. App on Vercel, indexer plus API on one Oracle VM. Files: `deploy/oracle/`, `deploy/vercel/`, `scripts/smoke-hosted.sh`.

Placeholders used below: `kruxa.example` (site) and `api.kruxa.example` (API). Replace with your real names.

## What exists and what does not

- Indexer and API run as one Node process (`ops/Dockerfile`, health at `/api/health`). Covered.
- The keeper and the genesis watcher exist now (`services/keeper`, `relayer/src/watcher-cli.ts`) and are in the compose profile `daemons`, off by default and dry-run until you set `KEEPER_SEND=1` / `WATCHER_SEND=1`. Their signer keys would live on the VM as read-only files (say so before enabling). See `docs/runbooks/keeper-watcher.md`.
- The relayer in `relayer/` is a library and CLI set (genesis, sweep, resume), not a server. Not hosted. `NEXT_PUBLIC_RELAYER_URL` stays empty.

## What only you can do

1. Create the Oracle Cloud account (card, phone, email verification). Choose the home region carefully: it cannot change.
2. Upgrade the Oracle account to Pay As You Go (this is the anti-reclaim fix, see below). Cost stays 0 inside Always Free limits.
3. Create the Vercel account and connect the GitHub repo.
4. Buy or choose the domains and create the DNS records at your registrar.
5. Accept Oracle and Vercel terms, create the VM in the Oracle console, download the SSH key it offers.
6. Decide whether anything mainnet ever happens. This runbook never touches it.

## What the agent can do once you give access

Give it SSH access to the VM (user and IP, key added to the agent), and a Vercel token or an invited seat. Then it can: run `bootstrap.sh`, write `.env` and `indexer.env`, start the stack, bake and commit the snapshot, set Vercel env vars, trigger the deploy, run the smoke test, and run rollbacks. It cannot create accounts, pay, or edit DNS at your registrar.

## Step 1. Oracle VM

1. Console, Compute, Instances, Create. Image: Ubuntu 24.04. Shape: Ampere A1 Flex, 2 OCPU and 12 GB is plenty (Always Free allows up to 4 OCPU and 24 GB total). If "out of capacity", retry later or try another availability domain. A VM.Standard.E2.1.Micro (x86, 1 GB) also works but is tight.
2. Networking: assign a public IPv4 (Always Free includes one). Add the SSH public key.
3. Networking, VCN, Security List: add ingress rules for TCP 80 and 443 from 0.0.0.0/0 (22 is already open).
4. Reserve the IP: instance, Attached VNICs, IPv4, edit, choose Reserved public IP. A reserved IP survives a stop and start.
5. Note the public IP.

## Step 2. DNS

At your registrar:

| Type | Name | Value |
|---|---|---|
| A | `api` | the Oracle public IP |
| CNAME or A | `@` or `www` | the values Vercel shows in Project, Settings, Domains (step 5) |

Check: `dig +short api.kruxa.example` returns the IP. TLS only issues after this resolves.

## Step 3. Put the backend on the VM

    ssh ubuntu@<ip>
    git clone <repo url> kruxa && cd kruxa
    bash deploy/oracle/bootstrap.sh          # installs Docker, opens 80/443, creates /srv/kruxa/data, installs systemd units
    exit; ssh ubuntu@<ip>                     # re-login so the docker group applies
    cd kruxa/deploy/oracle
    cp compose.env.example .env              # set API_DOMAIN and ACME_EMAIL
    cp indexer.env.example indexer.env       # defaults match app/.env.testnet; edit only if the testnet accounts change
    sudo systemctl start kruxa.service kruxa-backup.timer kruxa-keepalive.timer

Values you supply: `API_DOMAIN` (goes in `.env`), `ACME_EMAIL` (`.env`). Everything in `indexer.env` is public account ids with working defaults. No secret is needed anywhere on the VM.

Optional: set `API_URL=https://api.kruxa.example` in `/etc/systemd/system/kruxa-keepalive.service` so the hourly burst also makes a network request, then `sudo systemctl daemon-reload`.

Fresh database: with `KRUXA_START_HEIGHT=tip` the indexer sees only new blocks. The testnet history in the committed snapshot (`evidence/indexer-testnet/`) was built by selective ingest (`scripts/indexer-ingest-heights.ts`), not by a tail. To restore that history on the VM, run the three ingest commands in `evidence/indexer-testnet/README.md` with `KRUXA_DB`-style paths pointed at `/srv/kruxa/data/indexer.db` while the container is stopped, then start it. Until then the live API shows only new activity and the snapshot carries the old.

## Step 4. Verify the backend

    curl -s http://127.0.0.1:8787/api/health            # on the VM; expect "status":"ok"
    curl -s https://api.kruxa.example/api/health         # from anywhere; expect the same
    curl -s https://api.kruxa.example/api/launches | head -c 300
    docker compose ps                                     # indexer healthy, caddy up
    sudo reboot                                           # then re-run the curls after two minutes: it must come back by itself

Health says `"stale"` when the indexer trails the chain by more than 120 blocks or the last neardata call failed. A brief stale right after start is normal.

## Step 5. Vercel

1. Vercel, Add New Project, import the repo.
2. Root Directory `app`. Node.js 24.x. Install `npm ci`. Build `next build`.
3. Environment Variables: paste `deploy/vercel/env.testnet.example`, setting `NEXT_PUBLIC_KRUXA_API=https://api.kruxa.example` and `NEXT_PUBLIC_SITE_URL=https://kruxa.example`.
4. Do NOT add `NEXT_PUBLIC_MAINNET_CONFIRMED`. Ever.
5. Ship the RECORDED fallback first: `cp -R evidence/indexer-testnet/snapshot-core3 app/public/snapshot`, commit, push to `main`.
6. Deploy. Add the domain under Settings, Domains, and create the DNS record Vercel shows.

## Step 6. Verify everything

    scripts/smoke-hosted.sh https://kruxa.example https://api.kruxa.example

Exit 0 and `ALL PASS` means: all pages and footer links return 200, `/llms.txt` names the API, `/api/health` is ok, CORS is present, API is https. Then open the site in a browser and confirm the strip does not say RECORDED.

Fallback drill: `sudo systemctl stop kruxa.service` on the VM, reload the site, the strip should say RECORDED with the snapshot date. Then `sudo systemctl start kruxa.service`.

## Oracle Always Free: idle reclaim

Oracle can reclaim an Always Free instance idle for 7 days (as I recall the rule: 95th percentile CPU under 20 percent, network under 20 percent, and on A1 memory under 20 percent; check Oracle's current Always Free page, it changes). A quiet indexer sits right under those numbers.

Measures, strongest first:

1. Upgrade the account to Pay As You Go. Always Free resources keep costing 0 and are no longer reclaimed for idleness. Set a budget alert of a few dollars.
2. `kruxa-keepalive.timer` (installed by bootstrap) burns every core for 7 minutes each hour plus one health request. That lifts CPU and network above 20 percent for more than 5 percent of the time. It does not reliably lift A1 memory, which is why step 1 is the real fix.
3. Keep it monitored: a free uptime check (for example UptimeRobot) on `https://api.kruxa.example/api/health`.

Only one public IP is included. Keep it reserved (Step 1.4). Do not delete the VNIC.

## If the instance is reclaimed or lost

1. Create a new VM (Step 1), reassign the reserved IP if it survived, else update the `api` A record.
2. `bootstrap.sh`, `.env`, `indexer.env` as in Step 3, but do not start yet.
3. Restore the newest backup: `gunzip -c indexer-<stamp>.db.gz > /srv/kruxa/data/indexer.db && sudo chown 1000:1000 /srv/kruxa/data/indexer.db`. Backups live in `/srv/kruxa/data/backups` on the VM; copy them off-box, or set `BACKUP_RCLONE_REMOTE` (Oracle Object Storage, 20 GB free) in `kruxa-backup.service` so each night's copy leaves the VM. Without an off-box copy a reclaimed VM takes its backups with it, and the fallback is the committed snapshot.
4. Start, then run Step 4 and Step 6. Meanwhile the site stays up in RECORDED mode.

## Rollback

| What | How | Time |
|---|---|---|
| App | Vercel, Deployments, previous good one, Promote to Production | under 1 min |
| Backend code | on the VM `git checkout <good commit>`, then `docker compose up -d --build` in `deploy/oracle` | 3 min |
| Bad database | stop, restore the last backup as in the reclaim section, start | 5 min |
| Bad env var (app) | fix it in Vercel and redeploy | 2 min |

## Operate

- Logs: `docker compose logs -f --tail 100 indexer` (rotated, 10 MB by 5 files per container).
- Backups: `/srv/kruxa/data/backups`, nightly 03:15 UTC, 14 days kept. Run by hand: `sudo systemctl start kruxa-backup.service`.
- Refresh the RECORDED snapshot: `scp -r <vm>:/srv/kruxa/data/snapshot app/public/snapshot`, commit, push.
- Update: `git pull` on the VM, `sudo systemctl restart kruxa.service`.

## Checklist

- [ ] Oracle account created, upgraded to Pay As You Go, budget alert set
- [ ] VM up, reserved public IP, ports 80 and 443 open in the security list
- [ ] DNS `api` A record resolves to the IP
- [ ] `bootstrap.sh` run, `.env` and `indexer.env` filled
- [ ] `https://api.kruxa.example/api/health` returns ok, survives `sudo reboot`
- [ ] Vercel project: root `app`, env vars pasted, no mainnet variable
- [ ] `app/public/snapshot` committed
- [ ] Domain attached, `scripts/smoke-hosted.sh` prints ALL PASS
- [ ] Fallback drill done (stop backend, site shows RECORDED, start again)
- [ ] Off-box backup configured, uptime monitor added

## Render or Railway instead of Oracle

Use this when Oracle is not an option. Same backend (`ops/Dockerfile`, one process, one SQLite file, health at `/api/health`), no domain purchase: the platform gives a free subdomain with automatic HTTPS (`<name>.onrender.com` or `<name>.up.railway.app`). Files: `deploy/render/render.yaml`, `deploy/render/render-daemons.yaml`, `deploy/railway/`. Steps 4 to 6 above (verify, Vercel, smoke test) still apply with the platform URL in place of `api.kruxa.example`.

### Which to pick

Pick Render. It reads a Blueprint from the repo (one import instead of many clicks), supports a persistent disk on a web service, and has secret files, which the watcher needs (its keys are file paths only). Pick Railway only if you prefer its dashboard; it works for the indexer + API and the keeper (key as a variable) but not the watcher. Both need a PAID instance for the durable setup, because a persistent disk or volume is what keeps the SQLite file across restarts.

### Free tier versus always-on

Prices and limits change, so check each pricing page before you pay (all of the following is UNVERIFIED, from memory):

- Render free web service: sleeps after a period without traffic, takes a while to wake, and has NO persistent disk, so the database is lost on every restart or redeploy and starts again from `KRUXA_START_HEIGHT=tip`. Usable for a demo only. The free type cannot take the `disk:` block in `render.yaml`; delete that block and the `KRUXA_DB` line if you try it.
- Render paid web service: always on, can mount the disk. This is the setup in `render.yaml`. Price: check the Render pricing page.
- Railway: usage-based with a trial or small plan; the service stays on while it has credit and a volume keeps the file. Price: check the Railway pricing page.

### How the app survives the backend sleeping or being down

The app asks the API with an 8 second timeout (`app/lib/api/client.ts`). On timeout or an unreachable host it reads the static snapshot under `/snapshot/api/...` on the Vercel site and shows the RECORDED strip. So a sleeping free instance costs the visitor one 8 second wait on the first call, then recorded data until the API answers again. This only works if `app/public/snapshot` is committed (Step 5.5 above). The snapshot is built from a database, so bake it from any copy you have, for example `evidence/indexer-testnet/snapshot-core3`.

### Render, exact clicks

1. Push the repo to GitHub (the Blueprint reads it from there). Render, New, Blueprint, connect GitHub, pick the repo.
2. Blueprint file path: `deploy/render/render.yaml`. Branch `main`.
3. Before applying, open `deploy/render/render.yaml` and set `plan:` to the smallest paid web plan that allows a disk (Blueprints have no variables for plans; edit the line and commit, or change the plan in the dashboard after).
4. Apply. Render builds `deploy/render/Dockerfile` and starts `kruxa-api`. No secret prompts: every value is a public account id. Values already in the file: `KRUXA_NETWORK=testnet`, `KRUXA_CORE=core3.kxi-root-1108.testnet`, `KRUXA_MARKET=market3.kxi-root-1108.testnet`, `KRUXA_LAUNCHER=demo-instant.kxi-root-1111.testnet`, `KRUXA_START_HEIGHT=tip`, `KRUXA_DB=/data/indexer.db`, disk `kruxa-data` mounted at `/data`.
5. Copy the service URL shown at the top of the service page (`https://kruxa-api-xxxx.onrender.com`). Verify: `curl -s https://<url>/api/health` returns `"status":"ok"` (a brief `"stale"` right after start is normal).
6. Keeper and watcher (optional, later): New, Blueprint, file path `deploy/render/render-daemons.yaml`. Then for each worker: Environment, Secret Files, add `keeper.json` (keeper) or `near-testnet-f0.json` and `relayer-devnet.json` (watcher), pasting the key JSON. They start in dry-run. Set `KEEPER_SEND=1` / `WATCHER_SEND=1` only when you mean it. Say so before enabling: it puts signer keys on a third party host (testnet and devnet keys only).

### Railway, exact clicks

Follow `deploy/railway/README.md`: new project from the repo, config file `/deploy/railway/railway.json`, add a volume at `/data`, paste the variables (including `RAILWAY_RUN_UID=0`), Generate Domain.

### Point the Vercel app at it

Vercel, project, Settings, Environment Variables: set `NEXT_PUBLIC_KRUXA_API` to the platform URL with no trailing slash (for example `https://kruxa-api-xxxx.onrender.com`), for Production and Preview. It is baked in at build time, so Redeploy afterwards. https is required (an http API is blocked as mixed content); both platforms serve https by default. The API answers CORS for any origin, so no further setting is needed. Then run `scripts/smoke-hosted.sh <site url> <platform url>`.

### Custom domain later (optional)

Render: service, Settings, Custom Domains, add `api.yourdomain`, create the CNAME it shows. Railway: Settings, Networking, Custom Domain, same idea. Then update `NEXT_PUBLIC_KRUXA_API` and redeploy Vercel. The old platform URL keeps working.

### GitHub Pages cannot host the API

`github.io` serves static files only. The indexer is a running process that tails the chain and writes SQLite, so it cannot live there. Pages could host only the static snapshot, which Vercel already does.

### Backups and rollback on Render or Railway

- Database: the `nightly VACUUM INTO` job of `backup.sh` does not exist here. Use the platform: Render disk snapshots (paid, check the pricing page) or Railway volume backups. A lost disk degrades to RECORDED mode, as in the Oracle reclaim case.
- Backend code: Render, Events or Deploys, pick the previous deploy, Rollback. Railway, Deployments, previous one, Redeploy.
- Bad database: stop the service, restore the disk snapshot or delete the file so the indexer restarts from `KRUXA_START_HEIGHT`.

### If the first deploy cannot write the database

Symptom in the logs: `unable to open database file` or `EACCES` on `/data`. Render: the Dockerfile in `deploy/render/` already runs as root for this reason. Railway: confirm `RAILWAY_RUN_UID=0` is set and redeploy.

## Free path: GitHub Actions snapshots

Use this when you will not pay for a server. There is NO always-on process. A scheduled GitHub Actions workflow (`.github/workflows/snapshot.yml`) wakes every 5 minutes, catches a SQLite copy of the indexer up to the chain, bakes every API page the app reads into static JSON, and publishes it on GitHub Pages. The Vercel app reads those files from `NEXT_PUBLIC_SNAPSHOT_BASE_URL` and labels them RECORDED. Cost: 0. Read-only: no key, no secret.

How it works, one run: restore the SQLite file from the orphan branch `snapshot-state` (one commit, force-pushed each run, so it never grows), ingest new blocks from neardata for up to 4 minutes (paced to its rate limit, optional RPC backup), bake the pages (`services/api/src/snapshot-ci.ts`), refuse to publish if the bake is empty or older than what is already published (block height, event count or launch count would go down, contract config changed, required files missing, or the source failed with zero progress), push the new state, deploy the files to Pages. A failed run changes nothing: the last good pages stay up and the database on `snapshot-state` is untouched. Scripts: `deploy/github/build-site.sh`, `deploy/github/snapshot-state.sh`.

### Owner steps (exact)

1. Push the repo to GitHub and make it PUBLIC. (Actions minutes are unlimited on public repos; a private repo has a monthly cap that a 5 minute cron burns through. The repo holds only public contract ids and chain data, no secrets.)
2. Settings, Pages, Build and deployment, Source: choose **GitHub Actions**.
3. Settings, Secrets and variables, Actions, tab **Variables**, New repository variable. All are public values (same as `deploy/oracle/indexer.env.example`):

   | Variable | Value |
   |---|---|
   | `KRUXA_CORE` | `core3.kxi-root-1108.testnet` |
   | `KRUXA_MARKET` | `market3.kxi-root-1108.testnet` |
   | `KRUXA_LAUNCHER` | `demo-instant.kxi-root-1111.testnet` |
   | `KRUXA_NETWORK` | `testnet` (optional, the default) |
   | `KRUXA_START_HEIGHT` | `tip` (default) or a block height to start from on the very first run |
   | `KRUXA_NEARDATA_URL` | optional mirror of neardata, no trailing slash. Empty means `https://testnet.neardata.xyz` |
   | `KRUXA_RPC_URL` | optional, `https://rpc.testnet.near.org`: block-scan backup when neardata errors |

   The job does nothing until at least one of the three account variables exists.
4. Actions tab, **snapshot**, Run workflow. After about 2 minutes the job summary shows the Pages URL, `https://<user>.github.io/<repo>`. Check `curl -s https://<user>.github.io/<repo>/api/health.json` (status `snapshot`, `as_of.block_height` set) and `.../api/launches.json`. If the deploy job fails with an environment protection error, Settings, Environments, github-pages, allow the default branch.
5. Vercel, project, Settings, Environment Variables (Production and Preview): set `NEXT_PUBLIC_SNAPSHOT_BASE_URL=https://<user>.github.io/<repo>` (https, no trailing slash) and make sure `NEXT_PUBLIC_KRUXA_API` is **not set** (delete it). Keep the rest of `deploy/vercel/env.testnet.example`. Redeploy (these values are baked in at build time).
6. Open the site: the strip says RECORDED with the as-of block time. Done. Wait 10 minutes and confirm the as-of time moved.

If you keep a live API too (Render, Oracle, the Mac tunnel below), set both `NEXT_PUBLIC_KRUXA_API` and `NEXT_PUBLIC_SNAPSHOT_BASE_URL`: the app asks the live API first and falls back to the snapshot on a network failure, a timeout (8 s) or a 5xx. With only the snapshot variable set it never tries a live API. Unset, the app behaves exactly as before (live API, then its own `/snapshot` folder).

First-run history: a fresh database starts at `KRUXA_START_HEIGHT`. With `tip` it only sees activity from then on, and the nine old testnet launches in `evidence/indexer-testnet/` are not in it. The app still checks its own `/snapshot` folder when a page is missing remotely (Step 5.5 above), but the feed is the remote one. To include older launches set `KRUXA_START_HEIGHT` to a block before them. The workflow catches up about 400 blocks a run (neardata allows roughly 2 requests a second) against about 300 new blocks per 5 minutes, so a start a few hours back catches up in a day and a start a week back effectively never does. Prefer a recent start height. After changing contracts or the start height, run the workflow once with **reset** ticked (or set `KRUXA_SNAPSHOT_RESET=1`, run, then delete the variable: leaving it set restarts the database every run).

### Staleness

Cron runs every 5 minutes but GitHub often starts a scheduled run 3 to 10 minutes late and can skip runs under load. A run takes about 1 to 4 minutes, Pages then propagates, and the app revalidates files on every read. Expect data about 5 to 10 minutes old, sometimes 15 to 20. The RECORDED strip shows the block time the data is as of. GitHub disables scheduled workflows after 60 days without repo activity: push any commit, or re-enable the workflow in the Actions tab.

### What works and what does not in snapshot mode

Writes never depend on any of this. Every action (create a launch, contribute, walk, trade, claim, sweep, withdraw) is signed in the wallet and sent straight to the chain; the contracts decide, not the site. After you act, the page will not show the result for 5 to 10 minutes (the app's own pending state covers the wait).

Works, from recorded pages: launch feed (search, tabs and creator filter applied in the browser), launch and token pages, trades (latest 200), holders (top 200), depth ladder, candles (1m, 5m, 1h, 1d), verify page, custody and genesis pages, stats, operations log (all, or filtered by scope core, market or launcher; latest 200), status and ops pages, creator desk and portfolio for every account that appears in indexed events.

Does not work offline:
- Live updates: no SSE stream, no ticking prices. Pages are as of the last bake.
- CSV exports (`/api/export/...`): live API only.
- Paging past the baked rows (trades beyond 200, ops log "load more", cursors), per-trader trade filters, custom candle ranges (`from`, `to`, `fill`), ops log filters by category or launch id.
- Creator desk or portfolio for an account with no indexed activity (a brand new wallet): shows "not in the recorded snapshot" instead of an empty page.
- Anything newer than the last successful run. If the source is down for hours, the pages stay frozen at the last good bake (honestly labelled with their block time).
- History before `KRUXA_START_HEIGHT`.

### Optional bonus: a live API on your Mac through a Cloudflare quick tunnel

For a demo with live numbers while your Mac is awake. No Cloudflare account is needed for a quick tunnel.

    KRUXA_NETWORK=testnet KRUXA_CORE=core3.kxi-root-1108.testnet KRUXA_MARKET=market3.kxi-root-1108.testnet \
      KRUXA_LAUNCHER=demo-instant.kxi-root-1111.testnet KRUXA_START_HEIGHT=tip ops/run.sh     # API on :8787
    cloudflared tunnel --url http://localhost:8787                                            # prints https://<random>.trycloudflare.com

Set `NEXT_PUBLIC_KRUXA_API` in Vercel to that URL and redeploy (keep `NEXT_PUBLIC_SNAPSHOT_BASE_URL` set). Caveats: the URL is random and changes every time `cloudflared` restarts, so each restart means a Vercel env change and a redeploy; there is no uptime guarantee (quick tunnels are for testing); the Mac must stay awake and online; the local database only has what it saw while running. When the tunnel is down the app falls back to the snapshot after the 8 second timeout, so a dead tunnel costs each first page load a wait. Stop both processes when you are done (`Ctrl-C`).

### Optional: the keeper as a scheduled workflow (off by default)

`.github/workflows/keeper.yml` runs one keeper cycle every 15 minutes (`--once`): the permissionless core methods plus solvency reports. It is disabled unless the repository variable `KEEPER_ENABLED=1` exists, and it is a dry run (prints what it would send) unless `KEEPER_SEND=1` or you tick **send** when running it by hand. Variables: `KEEPER_CORE`, `KEEPER_ACCOUNT_ID`, optional `KEEPER_RPC_URL`. Secret: `KEEPER_KEY`.

WARNING: a repository secret is readable by anyone who can edit workflows in the repo, and the key sits on a GitHub runner for each run. Enable this ONLY with a dedicated low-privilege testnet account that holds a few NEAR for gas and owns nothing else. Never use an owner, treasury or deploy key. The keeper itself refuses non-testnet accounts, cores and RPC URLs. A 15 minute scheduled cycle is slower than the daemon's 30 second loop and has no stuck-launch memory between runs, so it is a safety net, not a replacement. See `docs/runbooks/keeper-watcher.md`.
