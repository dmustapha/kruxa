#!/usr/bin/env python3
"""Regenerates fixtures/vectors/genesis-{a,b}.json: the spec comes from the contract's own Rust code (kruxa-specvec), the expected
transactions from the Python reference compiler. Usage: python3 -I tools/genesis/make-vectors.py   (needs cargo)"""
import json, os, subprocess, sys, tempfile
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "tools", "genesis", "ref"))
import compile as gc, merkle, sol  # noqa: E402

def pk(t): return sol.sha256(b"kruxa-vector", t.encode())

def build(launch, name, symbol, uri, leaves, reserve, seed_tag):
    g = pk("g-" + seed_tag)
    root, _, ls = merkle.build(leaves) if leaves else (bytes(32), [], [])
    mint = sol.create_with_seed(g, str(launch), sol.TOKENKEG)
    total = sum(a for _, a, _ in ls)
    buckets = ([[0, str(reserve)]] if reserve else []) + [[1, str(total)]]
    fields = {"spec_version": 1, "compiler_version": gc.COMPILER_VERSION, "chain": "solana-devnet",
              "cluster_genesis_hash": sol.b58d("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").hex(), "launch_id": str(launch),
              "near_contract": "core2.kxa1-owner-1203.testnet", "near_block_height": "12345", "mode": "F1",
              "genesis_key_pubkey": g.hex(), "mint_seed": str(launch), "mint_address": mint.hex(), "token_program": sol.b58d(sol.TOKENKEG).hex(),
              "decimals": 6, "supply_total": str(total + reserve), "name": name, "symbol": symbol,
              "metadata_uri_sha256": sol.sha256(uri.encode()).hex(), "metadata_hash": pk("mh").hex(), "mint_authority_none": True,
              "freeze_authority_none": True, "extensions_allowed": False, "buckets": buckets,
              "reserve_squads_multisig_hash": pk("squads-" + seed_tag).hex(), "reserve_vault_index": 0, "reserve_disclosure": "SinglePartyDemo",
              "merkle_root": root.hex(), "max_total_claim": str(total), "max_num_nodes": len(ls), "clawback_days": 90}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(fields, f)
    out = subprocess.check_output(["cargo", "run", "-q", "--release", "--manifest-path", os.path.join(ROOT, "tools/genesis/specvec/Cargo.toml"), "--", f.name])
    os.unlink(f.name)
    o = json.loads(out)
    return {"spec_fields": fields, "spec_hex": o["spec_hex"], "spec_hash": o["spec_hash"],
            "params": {"jito_program": sol.JITO_MAINNET, "metadata_uri": uri, "clock_ts": "1762560000"},
            "blockhash": sol.b58e(sol.sha256(b"blockhash-" + seed_tag.encode())), "price": 5000 if seed_tag == "a" else 0}

def main():
    vec = os.path.join(ROOT, "fixtures", "vectors")
    la = [(sol.sha256(b"holder", bytes([i])), 1_000_000 * (i + 1), 0) for i in range(5)]
    lb = [(sol.sha256(b"holderB", bytes([i])), 7_000_000 * (i + 3), 0) for i in range(12)]
    specs = {"genesis-a.json": build(1, "Kruxa Alpha", "KRXA", "https://kruxa.example/meta/1.json", la, 0, "a"),
             "genesis-c.json": build(3, "Kruxa NoSolana", "KRXC", "https://kruxa.example/meta/3.json", [], 50_000_000_000, "c"),
             "genesis-b.json": build(2, "Kruxa Beta Token Long Name 32", "KRXB", "https://kruxa.example/meta/" + "x" * 120 + ".json", lb, 123_456_789, "b")}
    for name, v in specs.items():
        v["comment"] = "Golden genesis vector. spec_hex/spec_hash come from kruxa-logic (the contract's code); expected from tools/genesis/ref/compile.py."
        json.dump(v, open(os.path.join(vec, name), "w"), indent=2)
        subprocess.check_call([sys.executable, "-I", os.path.join(ROOT, "tools/genesis/ref/compile.py"), "--write", os.path.join(vec, name), "--sizes"])

main()
