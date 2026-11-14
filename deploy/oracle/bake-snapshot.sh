#!/usr/bin/env bash
# Bake the RECORDED snapshot (static JSON mirroring the API paths) from the live database into $KRUXA_DATA_HOST/snapshot.
# Ship it with the site: copy that folder to app/public/snapshot in the repo, commit, let Vercel redeploy (see deploy/vercel/README.md).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
set -a; . ./indexer.env; set +a
docker compose exec -T indexer sh -c "rm -rf /data/snapshot.new && node services/api/src/snapshot.ts bake /data/indexer.db '$KRUXA_NETWORK' /data/snapshot.new '${KRUXA_CORE:-}' '${KRUXA_MARKET:-}' '${KRUXA_LAUNCHER:-}' && rm -rf /data/snapshot && mv /data/snapshot.new /data/snapshot"
echo "snapshot baked in ${KRUXA_DATA_HOST:-/srv/kruxa/data}/snapshot"
