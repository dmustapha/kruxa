#!/usr/bin/env bash
# One-time DEVNET setup: deploys a labelled rehearsal COPY of the immutable Jito merkle-distributor binary (dumped read-only from mainnet) to a
# devnet program id we control. Costs about 4.35 SOL of devnet rent from the relayer key. Prints the address to export as JITO_PROGRAM.
# Never touches mainnet except the read-only dump. Run only after the relayer key is funded.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYS="${HOME}/.kruxa-secrets/genesis"; RELAYER="${KRUXA_RELAYER_KEY:-$KEYS/relayer-devnet.json}"
MAIN=mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv
[ "$(solana genesis-hash -u devnet)" = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ] || { echo "refusing: devnet genesis hash mismatch" >&2; exit 1; }
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
solana program dump "$MAIN" "$OUT/jito.so" -u mainnet-beta >/dev/null
echo "binary sha256: $(shasum -a 256 "$OUT/jito.so" | cut -d' ' -f1)"
[ -f "$KEYS/jito-devnet-program.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$KEYS/jito-devnet-program.json" >/dev/null
chmod 600 "$KEYS/jito-devnet-program.json"
solana program deploy "$OUT/jito.so" --program-id "$KEYS/jito-devnet-program.json" -k "$RELAYER" -u devnet >/dev/null
echo "REHEARSAL COPY of the Jito distributor on devnet: $(solana address -k "$KEYS/jito-devnet-program.json")"
echo "export JITO_PROGRAM=$(solana address -k "$KEYS/jito-devnet-program.json")"
