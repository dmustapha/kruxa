#!/usr/bin/env bash
# Read-only smoke test of a hosted Kruxa stack. GET requests only. Exit 0 when every check passes, 1 otherwise.
#   scripts/smoke-hosted.sh https://kruxa.example https://api.kruxa.example
set -uo pipefail
APP="${1:-}"; API="${2:-}"
[ -n "$APP" ] && [ -n "$API" ] || { echo "usage: $0 <app-url> <api-url>" >&2; exit 64; }
APP="${APP%/}"; API="${API%/}"
fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
code() { curl -sL -o /dev/null -m 20 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

check_200() { local c; c="$(code "$1")"; if [ "$c" = 200 ]; then ok "200 $1"; else bad "$c $1"; fi; }

echo "== app routes"
for p in / /create /creator /portfolio /insights /search /settings /status /ops-log /charter /docs /docs/api /docs/faq /docs/security /legal/terms /legal/privacy /legal/risk /llms.txt /AGENTS.md; do
  check_200 "$APP$p"
done

echo "== footer links (read from the live home page)"
home="$(curl -sL -m 20 "$APP/" || true)"
foot="$(printf '%s' "$home" | tr '\n' ' ' | grep -o '<nav[^>]*aria-label="Footer"[^>]*>.*</nav>' | head -1 | grep -o 'href="/[^"]*"' | sed 's/^href="//; s/"$//' | sort -u)"
if [ -z "$foot" ]; then bad "footer nav not found on $APP/"; else
  while IFS= read -r p; do check_200 "$APP$p"; done <<< "$foot"
fi

echo "== llms.txt names the API"
if curl -sL -m 20 "$APP/llms.txt" | grep -qF "$API"; then ok "llms.txt mentions $API"; else bad "llms.txt does not mention $API (NEXT_PUBLIC_KRUXA_API baked at build time differs, redeploy)"; fi

echo "== api"
health="$(curl -sL -m 20 "$API/api/health" || true)"
if printf '%s' "$health" | grep -q '"status":"ok"'; then ok "api/health status ok"; else bad "api/health not ok: $(printf '%s' "$health" | cut -c1-160)"; fi
check_200 "$API/api/launches"
check_200 "$API/api/stats"
check_200 "$API/api/ops/status"
cors="$(curl -sI -m 20 -H "Origin: $APP" "$API/api/health" | tr -d '\r' | grep -i '^access-control-allow-origin:' || true)"
if [ -n "$cors" ]; then ok "CORS header present"; else bad "no access-control-allow-origin on $API/api/health"; fi
case "$API" in https://*) ok "api is https";; *) bad "api is not https (browsers block it from an https site)";; esac

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SMOKE FAILED"
exit "$fail"
