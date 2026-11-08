#!/usr/bin/env bash
# Pure unit and property tests first (milliseconds), then wasm builds, then the sandbox suite.
# Extra args go to the sandbox run, e.g. `scripts/test.sh --include-ignored` for the slow holder-cap test.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test -p kruxa-math -p kruxa-logic
./scripts/build.sh
cargo test -p kruxa-tests -- --test-threads=3 "$@"
