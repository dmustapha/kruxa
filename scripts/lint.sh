#!/usr/bin/env bash
# fmt, clippy (contracts are checked for the wasm target because near-sdk 5.30 refuses native builds), wasm size gate.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fmt --all -- --check
cargo clippy -p kruxa-math -p kruxa-logic -p kruxa-sim --all-targets -- -D warnings
cargo clippy -p kruxa-core -p mock-ft -p mock-intents -p mock-factory -p mock-market --target wasm32-unknown-unknown -- -D warnings
MAX=600000
SIZE=$(wc -c < target/near/kruxa_core/kruxa_core.wasm)
if [ "$SIZE" -gt "$MAX" ]; then echo "kruxa_core.wasm is $SIZE bytes, budget $MAX"; exit 1; fi
echo "lint ok, kruxa_core.wasm $SIZE bytes (budget $MAX)"
