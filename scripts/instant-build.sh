#!/usr/bin/env bash
# Builds the instant launcher wasm plus what its sandbox suites deploy: the real market, mock-ft (USDC and the launch token),
# mock-factory. Output: target/near/<crate>/<crate>.wasm
set -euo pipefail
cd "$(dirname "$0")/.."
for c in instant market mock-ft mock-factory; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
ls -l target/near/*/*.wasm | grep -E "instant|market_contract|mock_ft|mock_factory"
