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
