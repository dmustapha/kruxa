#!/usr/bin/env bash
# make swarm-testnet (SW-2): thin wrapper around scripts/swarm-testnet.mjs. See the header of that file for flags and the safety rules.
#   ./scripts/swarm-testnet.sh [--seed N] [--round-secs S]          PLAN ONLY (default): prints every step, sends nothing
#   NEAR_ENV=testnet ./scripts/swarm-testnet.sh [...] --yes         execute on NEAR TESTNET (play money); needs 'npm ci' in scripts/instant-testnet
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "missing: node" >&2; exit 1; }
exec node scripts/swarm-testnet.mjs "$@"
