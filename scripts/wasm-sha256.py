"""Prints `sha256 <name>.wasm <hex> <bytes>` for the three contract wasm files that `make judge` builds."""
import hashlib, os, sys

for name in ("kruxa_core", "kruxa_market_contract", "kruxa_instant_contract"):
    path = f"target/near/{name}/{name}.wasm"
    if not os.path.isfile(path):
        sys.exit(f"missing {path}")
    data = open(path, "rb").read()
    print(f"sha256 {name}.wasm {hashlib.sha256(data).hexdigest()} {len(data)} bytes")
