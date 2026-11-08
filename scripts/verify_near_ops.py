#!/usr/bin/env python3
"""VX-2 operator lines for the core account (CO-6 E-5). Prints exactly:
  KEYS: <n> full-access key(s): <public keys>; <m> function-call key(s)
  CODE: view_code sha256 <hex>; reproducible build sha256 <hex>; MATCH|MISMATCH
A present full-access key is printed and disclosed (the owner can redeploy the contract), never a failure. A code hash that differs from
artifacts/SHA256SUMS is a MISMATCH (exit 2). A failed view is infrastructure (exit 4). Never prints the word immutable.
usage: verify_near_ops.py --rpc URL --contract ACCOUNT [--sums artifacts/SHA256SUMS] [--sums-name kruxa_core.wasm]"""
import base64, hashlib, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def rpc(url, request):
    body = json.dumps({"jsonrpc": "2.0", "id": "kruxa", "method": "query", "params": request}).encode()
    try:
        j = json.loads(urllib.request.urlopen(urllib.request.Request(url, body, {"content-type": "application/json"}), timeout=30).read())
    except Exception as e:
        raise SystemExit(infra("rpc %s: %s" % (url, e)))
    if "result" not in j or "error" in j.get("result", {}):
        raise SystemExit(infra("view failed: %s" % str(j.get("error") or j["result"].get("error"))[:200]))
    return j["result"]


def infra(msg):
    print("infrastructure error: " + msg, file=sys.stderr)
    return 4


def reproducible_hash(path, name):
    if not os.path.exists(path):
        return None
    for line in open(path):
        parts = line.split()
        if len(parts) == 2 and os.path.basename(parts[1].lstrip("*")) == name:
            return parts[0]
    return None


def main(argv):
    a = {}
    i = 0
    known = {"--rpc", "--contract", "--sums", "--sums-name"}
    while i < len(argv):
        if argv[i] not in known or i + 1 >= len(argv):
            print("usage: verify_near_ops.py --rpc URL --contract ACCOUNT [--sums FILE] [--sums-name NAME]", file=sys.stderr)
            return 64
        a[argv[i]], i = argv[i + 1], i + 2
    if "--rpc" not in a or "--contract" not in a:
        print("usage: verify_near_ops.py --rpc URL --contract ACCOUNT [--sums FILE] [--sums-name NAME]", file=sys.stderr)
        return 64
    keys = rpc(a["--rpc"], {"request_type": "view_access_key_list", "finality": "final", "account_id": a["--contract"]})["keys"]
    full = sorted(k["public_key"] for k in keys if k["access_key"]["permission"] == "FullAccess")
    fn = [k for k in keys if k["access_key"]["permission"] != "FullAccess"]
    print("KEYS: %d full-access key(s): %s; %d function-call key(s)" % (len(full), ", ".join(full) or "none", len(fn)))
    if full:
        print("NOTE: a full-access key is present, so its owner can redeploy this contract.")
    code = rpc(a["--rpc"], {"request_type": "view_code", "finality": "final", "account_id": a["--contract"]})
    onchain = hashlib.sha256(base64.b64decode(code["code_base64"])).hexdigest()
    want = reproducible_hash(a.get("--sums", os.path.join(HERE, "..", "artifacts", "SHA256SUMS")), a.get("--sums-name", "kruxa_core.wasm"))
    if want is None:
        print("CODE: view_code sha256 %s; reproducible build sha256 UNAVAILABLE (no artifacts/SHA256SUMS entry); NOT COMPARED" % onchain)
        return 0
    verdict = "MATCH" if want == onchain else "MISMATCH"
    print("CODE: view_code sha256 %s; reproducible build sha256 %s; %s" % (onchain, want, verdict))
    if verdict == "MISMATCH":
        print("MISMATCH contract_code")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
