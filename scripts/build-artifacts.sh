#!/usr/bin/env bash
# Builds the contract wasm files that get deployed and writes artifacts/SHA256SUMS (the file verify.sh's CODE line compares view_code with).
#   ./scripts/build-artifacts.sh            reproducible build (cargo-near in docker; needs `[reproducible_build]` in each Cargo.toml and a
#                                           clean committed tree) of core, market and launcher; copies them to artifacts/
#   ./scripts/build-artifacts.sh --local    NON-reproducible: copies the wasm that ./scripts/build.sh and market-build.sh / instant-build.sh
#                                           already built under target/near/. For rehearsals only; SHA256SUMS is labelled in artifacts/BUILD-KIND
#   ./scripts/build-artifacts.sh --check    only checks the files against SHA256SUMS (shasum -a 256 -c)
# SHA256SUMS lines are "<sha256>  artifacts/<name>.wasm" so `shasum -a 256 -c artifacts/SHA256SUMS` works from the repo root, and
# scripts/verify_near_ops.py finds a name by its basename. gate-freeze.sh records artifacts/kruxa_core.wasm when it exists, and gate-g3.sh GR-14
# hashes the file the FREEZE row names, so the freeze and the gate always talk about the same bytes.
# Nothing here deploys or sends anything.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-reproducible}"
OUT=artifacts
# crate directory : wasm name (target/near/<name>/<name>.wasm)
CONTRACTS=("core:kruxa_core" "market:kruxa_market_contract" "instant:kruxa_instant_contract")

sha() { shasum -a 256 "$1" | cut -c1-64; }

case "$MODE" in
  --check)
    [ -f "$OUT/SHA256SUMS" ] || { echo "missing $OUT/SHA256SUMS: run ./scripts/build-artifacts.sh first"; exit 1; }
    shasum -a 256 -c "$OUT/SHA256SUMS"
    exit 0 ;;
  reproducible|--reproducible) KIND="reproducible (cargo-near reproducible-wasm, docker)" ;;
  --local) KIND="non-reproducible (local cargo-near)" ;;
  *) echo "usage: build-artifacts.sh [--reproducible | --local | --check]" >&2; exit 64 ;;
esac

if [ "$KIND" != "${KIND#reproducible}" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "refusing: a reproducible build needs a clean committed tree (git status shows changes)" >&2
  exit 1
fi

mkdir -p "$OUT"
: > "$OUT/SHA256SUMS.tmp"
for entry in "${CONTRACTS[@]}"; do
  dir="${entry%%:*}"; name="${entry##*:}"
  src="target/near/$name/$name.wasm"
  if [ "$KIND" != "${KIND#reproducible}" ]; then
    (cd "contracts/$dir" && cargo near build reproducible-wasm)
  fi
  [ -f "$src" ] || { echo "missing $src: build it first (./scripts/build.sh, market-build.sh, instant-build.sh) or drop --local" >&2; rm -f "$OUT/SHA256SUMS.tmp"; exit 1; }
  cp "$src" "$OUT/$name.wasm"
  printf '%s  %s/%s.wasm\n' "$(sha "$OUT/$name.wasm")" "$OUT" "$name" >> "$OUT/SHA256SUMS.tmp"
done
mv "$OUT/SHA256SUMS.tmp" "$OUT/SHA256SUMS"
printf '%s\n' "$KIND" > "$OUT/BUILD-KIND"
cat "$OUT/SHA256SUMS"
echo "build kind: $KIND"
shasum -a 256 -c "$OUT/SHA256SUMS" > /dev/null && echo "SHA256SUMS ok"
