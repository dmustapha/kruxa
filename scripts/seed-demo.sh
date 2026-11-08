#!/usr/bin/env bash
set -euo pipefail
[ "${NEAR_ENV:-testnet}" = "mainnet" ] && { echo "refusing: seed-demo is testnet only"; exit 1; }
echo "seed-demo skeleton: launches A, B, C are created in Task 6.4"
