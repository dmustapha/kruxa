#!/usr/bin/env bash
# Anti-idle measure for Oracle Always Free. Oracle may reclaim an instance whose CPU, network and (A1) memory use all stay low for 7 days.
# This is a backstop only; the real fix is upgrading the account to Pay As You Go (still free inside Always Free limits). See docs/runbooks/hosting.md.
# Runs hourly from kruxa-keepalive.timer: busy-loop on every core for BURN_SECONDS, plus one public health request for network traffic.
set -euo pipefail
burn="${BURN_SECONDS:-420}"
cores="$(nproc)"
for _ in $(seq "$cores"); do timeout "$burn" sh -c 'while :; do :; done' & done
if [ -n "${API_URL:-}" ]; then curl -fsS --max-time 10 "$API_URL/api/health" >/dev/null || echo "keepalive: health request failed" >&2; fi
wait || true
