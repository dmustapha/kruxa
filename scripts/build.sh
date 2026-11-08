#!/usr/bin/env bash
# Builds every contract wasm with cargo-near (handles the wasm feature lowering that mainnet requires).
set -euo pipefail
cd "$(dirname "$0")/.."
for c in core mock-ft mock-intents mock-factory; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
ls -l target/near/*/*.wasm
