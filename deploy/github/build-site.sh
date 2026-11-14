#!/usr/bin/env bash
# Run one snapshot cycle: restore state, ingest, bake, check, save state, lay out the static site in <site-dir>.
# Exit 0 with <site-dir>/api present = publish. Exit 1 = keep what is published (nothing was changed on the state branch either).
#   build-site.sh <work-dir> <site-dir>
# Env (repo variables, all public): KRUXA_NETWORK KRUXA_CORE KRUXA_MARKET KRUXA_LAUNCHER KRUXA_START_HEIGHT KRUXA_NEARDATA_URL KRUXA_RPC_URL
#   KRUXA_SNAPSHOT_RESET=1 ignores the saved state once (new contracts, or a deliberate fresh start). SKIP_STATE_PUSH=1 for a local dry run.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="${1:?work dir}"; site="${2:?site dir}"
rm -rf "$work" "$site"; mkdir -p "$work" "$site"
export NODE_NO_WARNINGS=1
mkdir -p "$work/state"
prev="-"
if [ "${KRUXA_SNAPSHOT_RESET:-}" = "1" ]; then
  echo "KRUXA_SNAPSHOT_RESET=1: starting a fresh database"
else
  "$here/deploy/github/snapshot-state.sh" restore "$work/state"
  [ -f "$work/state/meta.json" ] && prev="$work/state/meta.json"
fi
node "$here/services/api/src/snapshot-ci.ts" run "$work/state/indexer.db" "$site" "$work/meta.json" "$prev"
[ "${SKIP_STATE_PUSH:-}" = "1" ] || "$here/deploy/github/snapshot-state.sh" push "$work/state/indexer.db" "$work/meta.json"
cp "$work/meta.json" "$site/snapshot-meta.json"
: > "$site/.nojekyll"
printf '<!doctype html><meta charset="utf-8"><title>Kruxa snapshot</title><p>Static JSON mirror of the Kruxa read API. See <a href="snapshot-meta.json">snapshot-meta.json</a> and <a href="api/health.json">api/health.json</a>.\n' > "$site/index.html"
echo "site ready: $(find "$site/api" -name '*.json' | wc -l | tr -d ' ') api files"
