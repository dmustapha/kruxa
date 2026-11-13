#!/usr/bin/env bash
# Greps tracked files for key material and mainnet confirmation strings. Exit 1 on any hit.
# Allowlist: docs that describe the guard (ARCHITECTURE.md, DECISIONS.md, docs/), the commented example env line, and this script (its own pattern).
set -uo pipefail
cd "$(dirname "$0")/.."
pat='(sk-[A-Za-z0-9_-]{20,}|[A-Z_]*(API_KEY|_TOKEN|_SECRET)=[A-Za-z0-9_./+-]{12,}|ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY|"secret_key"|private_key *[=:] *[0-9a-fA-F]{32,}|NEXT_PUBLIC_MAINNET_CONFIRMED=DAMI)'
# relayer/src/f0.test.ts holds PUBLIC keys only (the MPC signer root key and a derived child key, recorded as test vectors).
# evidence/genesis* and evidence/testnet-core3 hold public ceremony records and verify outputs: the MPC signer root key and the core owner full-access PUBLIC key printed by the KEYS line.
# evidence/verify and evidence/testnet-core7 hold verify.sh outputs: the only matches are the PUBLIC full-access keys printed by the KEYS line (44-character base58, 32 bytes; a secret key is 64 bytes).
# fixtures/dry-quote.json is a recorded 1Click dry quote; its response.signature is the service's PUBLIC ed25519 signature over the quote, not a key.
# evidence/attack-gallery/disclosed-facts.json quotes the PUBLIC test.near full-access key from the read-only N-06 mainnet view (a public key, not a secret).
allow='^(ARCHITECTURE\.md|DECISIONS\.md|docs/|app/\.env\.example|scripts/secret-scan\.sh|relayer/src/f0\.test\.ts|evidence/genesis|evidence/testnet-core3|evidence/testnet-core7|evidence/verify|evidence/attack-gallery/disclosed-facts\.json|fixtures/dry-quote\.json)'
hits=$(git ls-files -z | xargs -0 grep -IlE "$pat" 2>/dev/null | grep -Ev "$allow" || true)
if [ -n "$hits" ]; then echo "$hits"; echo "SECRET-SCAN FAIL"; exit 1; fi
echo "SECRET-SCAN PASS"
