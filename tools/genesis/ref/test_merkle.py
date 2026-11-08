"""Merkle tests (PLAN 4.7, tests first). Run: python3 -I tools/genesis/ref/test_merkle.py"""
import json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import merkle  # noqa: E402
import sol  # noqa: E402

VEC = os.path.join(HERE, "..", "..", "..", "fixtures", "vectors", "merkle-a.json")


def keys(n):
    return [(sol.sha256(b"holder", bytes([i])), 1_000_000 * (i + 1), 0) for i in range(n)]


class MerkleTest(unittest.TestCase):
    def test_every_proof_verifies_for_sizes(self):
        for n in (1, 2, 3, 5, 8, 13):
            root, proofs, ls = merkle.build(keys(n))
            for i, l in enumerate(ls):
                self.assertTrue(merkle.verify(proofs[i], root, merkle.leaf(*l)), (n, i))

    def test_wrong_amount_fails(self):
        root, proofs, ls = merkle.build(keys(5))
        c, a, lo = ls[2]
        self.assertFalse(merkle.verify(proofs[2], root, merkle.leaf(c, a + 1, lo)))

    def test_sorted_and_order_independent(self):
        k = keys(6)
        r1 = merkle.build(k)[0]
        r2 = merkle.build(list(reversed(k)))[0]
        self.assertEqual(r1, r2)

    def test_duplicate_claimant_rejected(self):
        with self.assertRaises(ValueError):
            merkle.build([keys(1)[0], keys(1)[0]])

    def test_leaf_encoding_is_documented_form(self):
        c = bytes(range(32))
        inner = sol.sha256(c, (5).to_bytes(8, "little") + (0).to_bytes(8, "little"))
        self.assertEqual(merkle.leaf(c, 5, 0), sol.sha256(b"\x00", inner))

    def test_golden_vector(self):
        v = json.load(open(VEC))
        leaves = [(bytes.fromhex(x["claimant"]), int(x["unlocked"]), int(x["locked"])) for x in v["leaves"]]
        root, proofs, ls = merkle.build(leaves)
        self.assertEqual(root.hex(), v["root"])
        self.assertEqual([[p.hex() for p in pr] for pr in proofs], v["proofs"])


if __name__ == "__main__":
    unittest.main()
