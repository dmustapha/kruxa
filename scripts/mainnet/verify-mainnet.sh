#!/usr/bin/env bash
# READ-ONLY. Runs the judge verifier (scripts/verify.sh) against NEAR MAINNET. Sends nothing, needs no key.
#   ./scripts/mainnet/verify-mainnet.sh ops               KEYS and CODE lines of the core and the market (works as soon as they are deployed)
#   ./scripts/mainnet/verify-mainnet.sh launch <id> [--tamper-all] [--rpc2 <solana mainnet url>] [--near-rpc2 <near url>]
#        full recompute of one launch; exit 3 (pending) is NORMAL until the round has settled; 0 = MATCH, 2 = MISMATCH, 4 = RPC problem
# Env: KRUXA_CORE, KRUXA_MARKET (mainnet account ids), KRUXA_NEAR_RPC (default https://rpc.mainnet.near.org).
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${KRUXA_NEAR_RPC:-https://rpc.mainnet.near.org}"
case "$RPC" in *test*|*dev*|*local*|*sandbox*|*beta*) echo "refusing RPC $RPC: not a mainnet endpoint" >&2; exit 64;; esac
chain=$(curl -s -m 20 -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["chain_id"])' 2>/dev/null || echo unreachable)
[ "$chain" = "mainnet" ] || { echo "refusing: $RPC reports chain_id '$chain', not mainnet" >&2; exit 4; }
echo "NETWORK: NEAR MAINNET (chain_id mainnet) via $RPC"
: "${KRUXA_CORE:?set KRUXA_CORE to the mainnet core account}"
case "${1:-}" in
  ops)
    ./scripts/verify.sh near-ops --rpc "$RPC" --contract "$KRUXA_CORE"
    if [ -n "${KRUXA_MARKET:-}" ]; then ./scripts/verify.sh near-ops --rpc "$RPC" --contract "$KRUXA_MARKET" --sums-name kruxa_market_contract.wasm; fi ;;
  launch)
    [ -n "${2:-}" ] || { echo "usage: $0 launch <id> [verify.sh flags]" >&2; exit 64; }
    id="$2"; shift 2
    # verify.sh reads its Solana RPC from SOL_DEVNET_RPC (historic name); point it at Solana mainnet here. The Solana half needs the genesis
    # record file (KRUXA_GENESIS_PREFIX<id>.json) written after the genesis ceremony; before that the Solana rows cannot pass.
    SOL_DEVNET_RPC="${KRUXA_SOL_RPC:-https://api.mainnet-beta.solana.com}" KRUXA_NEAR_RPC="$RPC" KRUXA_CONTRACT="$KRUXA_CORE" ./scripts/verify.sh "$id" --production "$@" ;;
  *) echo "usage: $0 ops | launch <id> [flags]" >&2; exit 64 ;;
esac
