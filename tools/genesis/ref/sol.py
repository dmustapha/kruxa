"""Minimal Solana primitives for the reference genesis compiler: base58, PDAs, legacy message encode and parse."""
import hashlib

SYSTEM = "11111111111111111111111111111111"
COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111"
TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
JITO_MAINNET = "mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv"

_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_P = 2**255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def b58e(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _ALPHA[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def b58d(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + _ALPHA.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


def sha256(*parts: bytes) -> bytes:
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()


def on_curve(pub: bytes) -> bool:
    """True if the 32 bytes decompress to an Ed25519 point (so a PDA must be NOT on curve)."""
    y = int.from_bytes(pub, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    u = (y * y - 1) % _P
    v = (_D * y * y + 1) % _P
    x2 = u * pow(v, _P - 2, _P) % _P
    if x2 == 0:
        return (pub[31] >> 7) == 0
    return pow(x2, (_P - 1) // 2, _P) == 1


def find_pda(seeds, program: bytes):
    for bump in range(255, -1, -1):
        h = sha256(b"".join(seeds), bytes([bump]), program, b"ProgramDerivedAddress")
        if not on_curve(h):
            return h, bump
    raise ValueError("no pda")


def create_with_seed(base: bytes, seed: str, owner_b58: str) -> bytes:
    return sha256(base, seed.encode(), b58d(owner_b58))


def ata(owner: bytes, mint: bytes) -> bytes:
    return find_pda([owner, b58d(TOKENKEG), mint], b58d(ATA))[0]


def cu16(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def rd_cu16(buf: bytes, i: int):
    n = shift = 0
    while True:
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if not b & 0x80:
            return n, i
        shift += 7


def ix(program: str, accounts, data: bytes):
    """accounts: list of (pubkey32, is_signer, is_writable)."""
    return {"program": b58d(program), "accounts": accounts, "data": data}


def compile_message(payer: bytes, instructions, blockhash: str) -> bytes:
    """Legacy message. Categories: signer+w, signer+ro, nonsigner+w, nonsigner+ro; payer first;
    within a category keys keep first-appearance order (instruction accounts in order, then the program id)."""
    meta = {}
    order = []

    def touch(k, s, w):
        if k not in meta:
            meta[k] = [False, False]
            order.append(k)
        meta[k][0] |= s
        meta[k][1] |= w

    touch(payer, True, True)
    for i in instructions:
        for k, s, w in i["accounts"]:
            touch(k, s, w)
        touch(i["program"], False, False)
    cat = lambda k: (0 if meta[k][0] and meta[k][1] else 1 if meta[k][0] else 2 if meta[k][1] else 3)
    keys = sorted(order, key=lambda k: (cat(k), order.index(k)))
    assert keys[0] == payer
    ns = sum(1 for k in keys if meta[k][0])
    nro_s = sum(1 for k in keys if meta[k][0] and not meta[k][1])
    nro_u = sum(1 for k in keys if not meta[k][0] and not meta[k][1])
    out = bytes([ns, nro_s, nro_u]) + cu16(len(keys)) + b"".join(keys) + b58d(blockhash) + cu16(len(instructions))
    for i in instructions:
        idx = [keys.index(k) for k, _, _ in i["accounts"]]
        out += bytes([keys.index(i["program"])]) + cu16(len(idx)) + bytes(idx) + cu16(len(i["data"])) + i["data"]
    return out


def parse_message(msg: bytes):
    ns, nro_s, nro_u = msg[0], msg[1], msg[2]
    n, i = rd_cu16(msg, 3)
    keys = [b58e(msg[i + 32 * j:i + 32 * j + 32]) for j in range(n)]
    i += 32 * n
    blockhash = b58e(msg[i:i + 32])
    i += 32
    ni, i = rd_cu16(msg, i)
    ixs = []
    for _ in range(ni):
        prog = msg[i]
        i += 1
        na, i = rd_cu16(msg, i)
        accts = list(msg[i:i + na])
        i += na
        nd, i = rd_cu16(msg, i)
        ixs.append({"program": prog, "accounts": accts, "data": msg[i:i + nd]})
        i += nd
    assert i == len(msg), "trailing bytes"
    return {"header": (ns, nro_s, nro_u), "keys": keys, "instructions": ixs, "blockhash": blockhash}
