#!/usr/bin/env bash
# make swarm: offline crowd test. 1) seed 1 table with 24 INV lines, 2) recorded JSON reproduces, 3) 300-seed sweep.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -q --offline -p swarm-sim
BIN=target/debug/swarm-sim
"$BIN" run --seed 1
echo
echo "== recorded runs reproduce (seeds 1 to 3) =="
"$BIN" verify-recorded swarm/runs 1 2 3
echo
echo "== sweep: invariants over 300 more seeds =="
"$BIN" sweep 1 300
