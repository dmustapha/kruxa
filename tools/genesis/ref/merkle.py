"""Reference Merkle tree for the Jito distributor (PLAN 4.7).
leaf = sha256(0x00 || sha256(claimant32 || unlocked u64 LE || locked u64 LE)); node = sha256(0x01 || min(a,b) || max(a,b)).
Leaves are sorted ascending by claimant pubkey bytes; an odd node is promoted unchanged. [UNVERIFIED against the deployed
Jito program until the local-validator claim test in scripts/genesis-local.sh]."""
import os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sol import sha256  # noqa: E402


def leaf(claimant: bytes, unlocked: int, locked: int = 0) -> bytes:
    return sha256(b"\x00", sha256(claimant, struct.pack("<QQ", unlocked, locked)))


def node(a: bytes, b: bytes) -> bytes:
    return sha256(b"\x01", min(a, b), max(a, b))


def build(leaves):
    """leaves: list of (claimant32, unlocked, locked). Returns (root, proofs) with proofs[i] for sorted leaf i."""
    ls = sorted(leaves, key=lambda x: x[0])
    for a, b in zip(ls, ls[1:]):
        if a[0] == b[0]:
            raise ValueError("duplicate claimant")
    level = [leaf(*x) for x in ls]
    idx = list(range(len(level)))
    proofs = [[] for _ in ls]
    pos = list(range(len(level)))  # position of each original leaf in the current level
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            nxt.append(node(level[i], level[i + 1]) if i + 1 < len(level) else level[i])
        for k in idx:
            p = pos[k]
            sib = p ^ 1
            if sib < len(level):
                proofs[k].append(level[sib])
            pos[k] = p // 2
        level = nxt
    return level[0], proofs, ls


def verify(proof, root: bytes, lf: bytes) -> bool:
    h = lf
    for p in proof:
        h = node(h, p)
    return h == root
