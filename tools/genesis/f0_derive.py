"""Offline derivation of the F0 child key (NEAR Chain Signatures, domain 1 = Ed25519). Pure Python, no deps.
child = root + (sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<predecessor>,<path>") mod L) * G
Usage: python3 -I tools/genesis/f0_derive.py --signer-pubkey ed25519:<b58> --predecessor ACCOUNT --path kruxa:genesis:1
Prints the derived key as ed25519:<b58> on the last line. Add --check to compare with the live testnet view (read-only)."""
import base64, hashlib, json, sys, urllib.request

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SIGNER = "v1.signer-prod.testnet"
RPC = "https://rpc.testnet.near.org"


def b58d(s):
    n = 0
    for c in s:
        n = n * 58 + ALPHA.index(c)
    return b"\0" * (len(s) - len(s.lstrip("1"))) + n.to_bytes((n.bit_length() + 7) // 8, "big")


def b58e(b):
    n, out = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = ALPHA[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def decompress(b):
    y = int.from_bytes(b, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    x2 = (y * y - 1) * pow(D * y * y + 1, P - 2, P) % P
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P:
        x = x * pow(2, (P - 1) // 4, P) % P
    if (x * x - x2) % P:
        raise ValueError("not on curve")
    if x & 1 != sign:
        x = P - x
    return (x, y, 1, x * y % P)


def add(p, q):
    a = (p[1] - p[0]) * (q[1] - q[0]) % P
    b = (p[1] + p[0]) * (q[1] + q[0]) % P
    c = 2 * p[3] * q[3] * D % P
    d = 2 * p[2] * q[2] % P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def mul(s, p):
    r = (0, 1, 1, 0)
    while s:
        if s & 1:
            r = add(r, p)
        p = add(p, p)
        s >>= 1
    return r


def compress(p):
    zi = pow(p[2], P - 2, P)
    x, y = p[0] * zi % P, p[1] * zi % P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


BASE = decompress((4 * pow(5, P - 2, P) % P).to_bytes(32, "little"))


def derive(root_pk: str, predecessor: str, path: str) -> str:
    eps = hashlib.sha3_256(f"near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}".encode()).digest()
    scalar = int.from_bytes(eps, "little") % L
    root = decompress(b58d(root_pk.removeprefix("ed25519:")))
    return "ed25519:" + b58e(compress(add(root, mul(scalar, BASE))))


def view(method, args):
    body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {"request_type": "call_function", "finality": "final",
            "account_id": SIGNER, "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}}
    r = urllib.request.Request(RPC, json.dumps(body).encode(), {"content-type": "application/json"})
    res = json.load(urllib.request.urlopen(r, timeout=20))["result"]
    if "result" not in res:
        raise SystemExit("view failed: %s" % res.get("error"))
    return json.loads(bytes(res["result"]))


def main(argv):
    def arg(k):
        return argv[argv.index(k) + 1] if k in argv else None
    pred, path = arg("--predecessor"), arg("--path")
    if not pred or not path:
        print("usage: f0_derive.py --signer-pubkey ed25519:.. | --live --predecessor A --path P [--check]", file=sys.stderr)
        return 64
    root = arg("--signer-pubkey") or view("public_key", {"domain_id": 1})
    out = derive(root, pred, path)
    if "--check" in argv:
        live = view("derived_public_key", {"path": path, "predecessor": pred, "domain_id": 1})
        print("on-chain view:", live)
        if live != out:
            print("MISMATCH offline %s != on-chain %s" % (out, live))
            return 2
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
