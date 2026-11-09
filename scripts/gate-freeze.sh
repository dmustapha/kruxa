#!/usr/bin/env bash
# A-4: records the core wasm freeze in rehearsal/LOG.md (sha256, size, git commit) and prints the view_code check to run after the deploy.
#   ./scripts/gate-freeze.sh candidate   append a CANDIDATE row (any time; not a freeze)
#   ./scripts/gate-freeze.sh freeze      append the FREEZE row (target: Nov 10 20:00 UTC); refuses a dirty tree or a missing wasm
# The wasm recorded is artifacts/kruxa_core.wasm when ./scripts/build-artifacts.sh made it (the reproducible build that gets deployed), else
# target/near/kruxa_core/kruxa_core.wasm; KRUXA_WASM overrides. gate-g3.sh GR-14 hashes the file the newest FREEZE row names and compares.
# Nothing is deployed or sent.
set -euo pipefail
cd "$(dirname "$0")/.."
KIND="${1:?usage: gate-freeze.sh candidate|freeze}"
case "$KIND" in candidate) LABEL=CANDIDATE ;; freeze) LABEL=FREEZE ;; *) echo "usage: gate-freeze.sh candidate|freeze"; exit 64 ;; esac
if [ -n "${KRUXA_WASM:-}" ]; then WASM="$KRUXA_WASM"
elif [ -f artifacts/kruxa_core.wasm ]; then WASM=artifacts/kruxa_core.wasm
else WASM=target/near/kruxa_core/kruxa_core.wasm; fi
[ -f "$WASM" ] || { echo "missing $WASM: run ./scripts/build-artifacts.sh (reproducible) or ./scripts/build.sh first"; exit 1; }
if [ "$LABEL" = FREEZE ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "refusing: uncommitted changes, commit first"; exit 1; fi
SHA=$(shasum -a 256 "$WASM" | cut -c1-64)
SIZE=$(wc -c < "$WASM" | tr -d ' ')
COMMIT=$(git rev-parse --short HEAD)
NOW=$(date -u +%FT%TZ)
DEFAULT_KIND="non-reproducible (local cargo-near)"
[ "$WASM" = artifacts/kruxa_core.wasm ] && [ -f artifacts/BUILD-KIND ] && DEFAULT_KIND="$(cat artifacts/BUILD-KIND)"
KIND_OF_BUILD="${KRUXA_BUILD_KIND:-$DEFAULT_KIND}"
if [ "$LABEL" = FREEZE ] && [ "$WASM" = artifacts/kruxa_core.wasm ]; then
  grep -q "^$(shasum -a 256 "$WASM" | cut -c1-64)  artifacts/kruxa_core.wasm$" artifacts/SHA256SUMS 2>/dev/null || { echo "refusing: $WASM does not match artifacts/SHA256SUMS (run ./scripts/build-artifacts.sh)"; exit 1; }
fi
printf '| %s | A-4 | `./scripts/gate-freeze.sh %s` | `sha256sum %s` equals this row; after the deploy `view_code` sha256 must equal it | %s sha256 %s, %s bytes, commit %s, build %s | RECORDED | pass |\n' \
  "$NOW" "$KIND" "$WASM" "$LABEL" "$SHA" "$SIZE" "$COMMIT" "$KIND_OF_BUILD" >> rehearsal/LOG.md
echo "$LABEL recorded: sha256 $SHA ($SIZE bytes, commit $COMMIT)"
echo "after the deploy (read-only): curl -s \$RPC -H 'content-type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"finality\":\"final\",\"account_id\":\"<core account>\"}}' | jq -r .result.code_base64 | base64 -d | shasum -a 256"
