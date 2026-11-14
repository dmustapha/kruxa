#!/usr/bin/env bash
# Genesis ceremony driver. DEVNET (default) or --cluster local (preloaded local validator, labelled).
#   ./scripts/genesis-devnet.sh --launch 1 --mode F1 [--cluster local] [--claim-test]
# Refuses any cluster whose genesis hash is not devnet (or whose --cluster local RPC is not localhost). This wrapper is the REHEARSAL entry point:
# it refuses NEAR_ENV=mainnet. The Solana mainnet-beta path is relayer/src/genesis-cli.ts --cluster mainnet-beta, guarded as in docs/MAINNET-SOLANA-GENESIS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${NEAR_ENV:-testnet}" = "mainnet" ] && { echo "refusing: genesis rehearsal is testnet/devnet only" >&2; exit 1; }
printf '%s\n' "$@" | grep -qx -- 'mainnet-beta' && { echo "refusing: this wrapper is devnet/local only; see docs/MAINNET-SOLANA-GENESIS.md" >&2; exit 1; }
if printf '%s\n' "$@" | grep -qx -- '--cluster' && printf '%s\n' "$@" | grep -A1 -x -- '--cluster' | grep -qx local; then
  exec ./scripts/genesis-local.sh -- npx --prefix relayer tsx relayer/src/genesis-cli.ts "$@"
fi
exec npx --prefix relayer tsx relayer/src/genesis-cli.ts "$@"
