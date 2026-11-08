#!/usr/bin/env bash
# Single-process run script: indexer tail + API in one Node process, state in one SQLite file.
# Configuration is environment variables only (no secrets are needed; the indexer is read-only):
#   KRUXA_NETWORK=testnet|mainnet|fixture   KRUXA_CORE=a.testnet   KRUXA_MARKET=b.testnet
#   KRUXA_DATA_DIR=/var/lib/kruxa  (persistent volume mount; the DB lives at $KRUXA_DATA_DIR/indexer.db)
#   KRUXA_START_HEIGHT=tip|<height>   PORT=8787   KRUXA_MAX_LAG=120
# Stop with SIGTERM; the process closes the DB cleanly.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_dir="${KRUXA_DATA_DIR:-$here/ops/data}"
mkdir -p "$data_dir"
export KRUXA_DB="${KRUXA_DB:-$data_dir/indexer.db}"
export KRUXA_NETWORK="${KRUXA_NETWORK:-fixture}"
export NODE_NO_WARNINGS=1
exec node "$here/services/api/src/main.ts"
