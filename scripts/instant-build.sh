#!/usr/bin/env bash
# Builds the instant launcher wasm plus what its sandbox suites deploy: the real market, mock-ft (USDC and the launch token),
# mock-factory and the stub market (failure modes). Output: target/near/<crate>/<crate>.wasm
# The end-to-end suite needs a market at ABI 1.1.0. Until ws/market2 is merged, point MARKET_DIR at a checkout of it:
#   MARKET_DIR=../kruxa-wt-market2 ./scripts/instant-build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
for c in instant mock-ft mock-factory mock-market; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
if [ -n "${MARKET_DIR:-}" ]; then
  (cd "$MARKET_DIR/contracts/market" && cargo near build non-reproducible-wasm --no-abi)
  mkdir -p target/near/kruxa_market_contract
  cp "$MARKET_DIR/target/near/kruxa_market_contract/kruxa_market_contract.wasm" target/near/kruxa_market_contract/
else
  (cd contracts/market && cargo near build non-reproducible-wasm --no-abi)
fi
ls -l target/near/*/*.wasm | grep -E "instant|market|mock_ft|mock_factory"
