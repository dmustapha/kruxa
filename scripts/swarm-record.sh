#!/usr/bin/env bash
# Regenerate the committed recorded runs. Deterministic: re-running must change nothing unless the simulator changed.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -q --offline -p swarm-sim
mkdir -p swarm/runs
for seed in 1 2 3; do
  target/debug/swarm-sim run --seed "$seed" --quiet --json "swarm/runs/run-$seed.json"
done
