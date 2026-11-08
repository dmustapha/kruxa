#!/usr/bin/env bash
# Instant launcher gate: pure-crate and in-VM tests, wasm rebuild, freshness and size checks, then the sandbox suites
# (flow, adversarial, review regressions, gas sweep, real market).
# The wasm files are ALWAYS rebuilt here (instant-build.sh), and the gate fails if any of them is older than its sources, so a
# stale wasm can never let the sandbox suites pass against old code.
# MARKET_DIR (a checkout of the market) overrides the market source; the freshness check then skips the market wasm.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test -p kruxa-instant -p kruxa-instant-contract -p kruxa-market-contract
./scripts/instant-build.sh

stale=0
check_fresh() { # <crate dir> <wasm name> [shared sources]
  local wasm="target/near/$2/$2.wasm" newer shared="${3:-}"
  [ -f "$wasm" ] || { echo "FAIL: $wasm was not built"; stale=1; return; }
  newer=$(find "contracts/$1/src" "contracts/$1/Cargo.toml" $shared -type f -newer "$wasm" 2>/dev/null | head -3)
  [ -z "$newer" ] || { echo "FAIL: $wasm is older than: $newer"; stale=1; }
}
check_fresh instant kruxa_instant_contract "crates/*/src Cargo.lock"
check_fresh mock-ft mock_ft
check_fresh mock-factory mock_factory
check_fresh mock-market mock_market
[ -n "${MARKET_DIR:-}" ] || check_fresh market kruxa_market_contract "crates/*/src Cargo.lock"
[ "$stale" -eq 0 ] || exit 1

size=$(wc -c < target/near/kruxa_instant_contract/kruxa_instant_contract.wasm)
echo "instant wasm: $size bytes"
[ "$size" -lt 300000 ] || { echo "FAIL: launcher wasm is not under 300 KB"; exit 1; }
echo "market wasm: $(wc -c < target/near/kruxa_market_contract/kruxa_market_contract.wasm) bytes"
cargo test -p kruxa-tests --test instant --test instant_adversarial --test instant_review --test instant_gas --test instant_market -- --test-threads=4
