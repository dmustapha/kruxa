#!/usr/bin/env bash
# Genesis ceremony driver. DEVNET (default) or --cluster local (preloaded local validator, labelled).
#   ./scripts/genesis-devnet.sh --launch 1 --mode F1 [--cluster local] [--claim-test]
# Refuses any cluster whose genesis hash is not devnet (or whose --cluster local RPC is not localhost). Mainnet is impossible here.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${NEAR_ENV:-testnet}" = "mainnet" ] && { echo "refusing: genesis rehearsal is testnet/devnet only" >&2; exit 1; }
if printf '%s\n' "$@" | grep -qx -- '--cluster' && printf '%s\n' "$@" | grep -A1 -x -- '--cluster' | grep -qx local; then
  exec ./scripts/genesis-local.sh -- npx --prefix relayer tsx relayer/src/genesis-cli.ts "$@"
fi
exec npx --prefix relayer tsx relayer/src/genesis-cli.ts "$@"
