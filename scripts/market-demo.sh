#!/usr/bin/env bash
# Buy then sell on a pool with the real market math; prints SLICES OK. Pure and offline: no network, no keys.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo run -q -p market-sim -- demo
