#!/usr/bin/env bash
# Starts a LOCAL solana-test-validator preloaded with the real Metaplex Metadata, Jito distributor and Squads binaries
# (dumped read-only from mainnet-beta, where all three are immutable; override with KRUXA_PROGRAM_SOURCE=devnet), runs the given command
# against it, then kills the validator. LOCAL rehearsal only. Nothing here touches devnet or mainnet except read-only program dumps.
#   scripts/genesis-local.sh -- <command...>        (command sees SOL_LOCAL_RPC=http://127.0.0.1:28899)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${KRUXA_PROGRAM_SOURCE:-mainnet-beta}"
CACHE="${KRUXA_PROGRAM_CACHE:-${TMPDIR:-/tmp}/kruxa-programs}/$SRC"
LEDGER="$(mktemp -d "${TMPDIR:-/tmp}/kruxa-ledger.XXXXXX")"
JITO=mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv; META=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s; SQDS=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
[ "${1:-}" = "--" ] || { echo "usage: $0 -- <command...>" >&2; exit 64; }
shift
mkdir -p "$CACHE"
dump() { [ -s "$CACHE/$1.so" ] || solana program dump "$1" "$CACHE/$1.so" -u "$2" >/dev/null; }
dump "$JITO" "$SRC"; dump "$META" "$SRC"; dump "$SQDS" "$SRC"
# Squads ProgramConfig PDA (read-only copy from $SRC; multisig creation reads its treasury)
SQDS_CFG=BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr
[ -s "$CACHE/$SQDS_CFG.json" ] || solana account "$SQDS_CFG" -u "$SRC" --output json -o "$CACHE/$SQDS_CFG.json" >/dev/null
solana-test-validator --reset --quiet --ledger "$LEDGER" --rpc-port 28899 --faucet-port 29900 --gossip-port 28001 --dynamic-port-range 28010-28040 \
  --bpf-program "$JITO" "$CACHE/$JITO.so" --bpf-program "$META" "$CACHE/$META.so" --bpf-program "$SQDS" "$CACHE/$SQDS.so" --account "$SQDS_CFG" "$CACHE/$SQDS_CFG.json" \
  >"$LEDGER/validator.log" 2>&1 &
VPID=$!
trap 'kill "$VPID" 2>/dev/null || true; wait "$VPID" 2>/dev/null || true; rm -rf "$LEDGER"' EXIT
for _ in $(seq 1 60); do
  curl -s -m 2 http://127.0.0.1:28899 -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"' && break
  sleep 1
done
SOL_LOCAL_RPC=http://127.0.0.1:28899 "$@"
