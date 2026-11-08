#!/usr/bin/env bash
# Greps tracked files for key material and mainnet confirmation strings. Exit 1 on any hit.
# Allowlist: docs that describe the guard (ARCHITECTURE.md, DECISIONS.md, docs/), the commented example env line, and this script (its own pattern).
set -uo pipefail
cd "$(dirname "$0")/.."
pat='(ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY|"secret_key"|private_key *[=:] *[0-9a-fA-F]{32,}|NEXT_PUBLIC_MAINNET_CONFIRMED=DAMI)'
# relayer/src/f0.test.ts holds PUBLIC keys only (the MPC signer root key and a derived child key, recorded as test vectors).
allow='^(ARCHITECTURE\.md|DECISIONS\.md|docs/|app/\.env\.example|scripts/secret-scan\.sh|relayer/src/f0\.test\.ts)'
hits=$(git ls-files -z | xargs -0 grep -IlE "$pat" 2>/dev/null | grep -Ev "$allow" || true)
if [ -n "$hits" ]; then echo "$hits"; echo "SECRET-SCAN FAIL"; exit 1; fi
echo "SECRET-SCAN PASS"
