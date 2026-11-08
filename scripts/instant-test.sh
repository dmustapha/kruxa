#!/usr/bin/env bash
# Instant launcher gate: pure-crate tests, wasm build, size check, then the three sandbox suites (flow, adversarial, real market).
# MARKET_DIR (a checkout of the market at ABI 1.1.0) is needed until ws/market2 is merged:
#   MARKET_DIR=../kruxa-wt-market2 ./scripts/instant-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test -p kruxa-instant
./scripts/instant-build.sh
size=$(wc -c < target/near/kruxa_instant_contract/kruxa_instant_contract.wasm)
echo "instant wasm: $size bytes"
[ "$size" -lt 300000 ] || { echo "FAIL: launcher wasm is not under 300 KB"; exit 1; }
cargo test -p kruxa-tests --test instant --test instant_adversarial --test instant_market -- --test-threads=4
