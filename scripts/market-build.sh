#!/usr/bin/env bash
# Builds the market wasm (and mock-ft, which the market suites use as USDC and launch token).
set -euo pipefail
cd "$(dirname "$0")/.."
for c in market market/mock-ft-ret mock-ft; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
ls -l target/near/*/*.wasm | grep -E "market|mock_ft"
