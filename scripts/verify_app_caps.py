#!/usr/bin/env python3
"""Claim C-04, app side: every cap in the app's local rules mirror (app/lib/charter/rules.ts) equals the live core's get_rule_set.
Reads the mirror as text (the app is not run). Prints one line per differing key as `MISMATCH <key> app=<x> contract=<y>` (exit 2),
`APP CAPS MATCH <n> keys` (exit 0), or an infrastructure error (exit 4).
usage: verify_app_caps.py --rpc URL --contract ACCOUNT [--ts app/lib/charter/rules.ts]"""
import base64, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
USDC = 1_000_000
RENAMED = {"minSupply": "min_supply_whole", "maxSupply": "max_supply_whole"}


def snake(name):
    return RENAMED.get(name) or re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def block(text, start, end):
    i = text.index(start)
    return text[i:text.index(end, i)]


def parse(text):
    """LADDER_RULES entries as {rust_key: decimal string}, then the DEMO_RULES overrides on top."""
    rules = {}
    for name, num, big, usdc in re.findall(r"(\w+): ([0-9_]+)(n?)( \* USDC)?", block(text, "export const LADDER_RULES", "};")):
        rules[snake(name)] = str(int(num.replace("_", "")) * (USDC if usdc else 1))
    demo = block(text, "export const DEMO_RULES", ";")
    return rules, {snake(n): str(int(v.replace("_", ""))) for n, v in re.findall(r"(\w+): ([0-9_]+)", demo)}


def view(rpc, contract, method):
    body = json.dumps({"jsonrpc": "2.0", "id": "kruxa", "method": "query", "params": {"request_type": "call_function", "finality": "final",
                       "account_id": contract, "method_name": method, "args_base64": base64.b64encode(b"{}").decode()}}).encode()
    try:
        j = json.loads(urllib.request.urlopen(urllib.request.Request(rpc, body, {"content-type": "application/json"}), timeout=30).read())
        return json.loads(bytes(j["result"]["result"]))
    except Exception as e:
        print("infrastructure error: %s %s: %s" % (contract, method, e), file=sys.stderr)
        raise SystemExit(4)


def main(argv):
    a = dict(zip(argv[::2], argv[1::2]))
    if "--rpc" not in a or "--contract" not in a or len(argv) % 2:
        print("usage: verify_app_caps.py --rpc URL --contract ACCOUNT [--ts FILE]", file=sys.stderr)
        return 64
    ladder, demo_overrides = parse(open(a.get("--ts", os.path.join(HERE, "..", "app", "lib", "charter", "rules.ts"))).read())
    live_cfg = view(a["--rpc"], a["--contract"], "get_config")
    mirror = {**ladder, **(demo_overrides if live_cfg.get("profile") == "demo" else {})}
    live = {k: str(v) for k, v in view(a["--rpc"], a["--contract"], "get_rule_set").items()}
    bad = [k for k, v in sorted(mirror.items()) if live.get(k) != v]
    for k in bad:
        print("MISMATCH %s app=%s contract=%s" % (k, mirror[k], live.get(k)))
    if bad:
        return 2
    print("APP CAPS MATCH %d keys: app/lib/charter/rules.ts (%s profile) == %s get_rule_set" % (len(mirror), live_cfg.get("profile"), a["--contract"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
