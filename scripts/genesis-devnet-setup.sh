#!/usr/bin/env bash
# One-time DEVNET setup: deploys a labelled rehearsal COPY of the immutable Jito merkle-distributor binary (dumped read-only from mainnet) to a
# devnet program id we control. The Anchor program checks its compiled-in declared id, so the 32 id bytes in the binary are patched to the new
# program id (a deployment at another address otherwise fails with DeclaredProgramIdMismatch, error 4100). The copy is upgradeable by the relayer
# key: it is a rehearsal artefact, NOT the audited immutable program. Costs about 3.17 SOL of devnet rent. Prints the id to export as JITO_PROGRAM.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYS="${HOME}/.kruxa-secrets/genesis"; RELAYER="${KRUXA_RELAYER_KEY:-$KEYS/relayer-devnet.json}"
MAIN=mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv
[ "$(solana genesis-hash -u devnet)" = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ] || { echo "refusing: devnet genesis hash mismatch" >&2; exit 1; }
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
solana program dump "$MAIN" "$OUT/jito.so" -u mainnet-beta >/dev/null
echo "mainnet binary sha256: $(shasum -a 256 "$OUT/jito.so" | cut -d' ' -f1)"
KP="$KEYS/jito-devnet-program-patched.json"
[ -f "$KP" ] || solana-keygen new --no-bip39-passphrase -s -o "$KP" >/dev/null
chmod 600 "$KP"
NEW="$(solana address -k "$KP")"
python3 -I - "$OUT/jito.so" "$MAIN" "$NEW" <<'PY'
import sys
ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def d(s):
    n = 0
    for c in s: n = n * 58 + ALPHA.index(c)
    return n.to_bytes(32, "big")
path, old, new = sys.argv[1], d(sys.argv[2]), d(sys.argv[3])
b = open(path, "rb").read()
print("declared id occurrences patched:", b.count(old))
assert b.count(old) >= 1
open(path, "wb").write(b.replace(old, new))
PY
echo "patched binary sha256: $(shasum -a 256 "$OUT/jito.so" | cut -d' ' -f1)"
solana program deploy "$OUT/jito.so" --program-id "$KP" -k "$RELAYER" -u devnet >/dev/null
echo "REHEARSAL COPY (declared id patched) of the Jito distributor on devnet: $NEW"
echo "export JITO_PROGRAM=$NEW"
