#!/usr/bin/env bash
set -euo pipefail
[ "${NEAR_ENV:-testnet}" = "mainnet" ] && { echo "refusing: rehearsal is testnet/devnet only"; exit 1; }
id="${1:?drill id, e.g. R1}"; cd "$(dirname "$0")/.."
case "$id" in
  R1) ./scripts/test.sh ;;
  R2) ./scripts/verify.sh golden ;;
  *) echo "drill $id is defined in PLAN.md Rehearsal Track; add its command here when its task lands"; exit 2 ;;
esac
