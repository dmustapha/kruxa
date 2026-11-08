"""Tests for the reference genesis compiler (PLAN 4.2). Run: python3 -I tools/genesis/ref/test_compile.py"""
import hashlib, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compile as gc  # noqa: E402
import sol  # noqa: E402

VECTORS = os.path.join(HERE, "..", "..", "..", "fixtures", "vectors")
ALLOW = {sol.SYSTEM, sol.COMPUTE_BUDGET, sol.TOKENKEG, sol.ATA, sol.METAPLEX}


def load(name):
    with open(os.path.join(VECTORS, name)) as f:
        return json.load(f)


class CompilerTest(unittest.TestCase):
    def setUp(self):
        v = load("genesis-a.json")
        self.spec = gc.spec_from_json(v["spec"])
        self.out = gc.compile_genesis(self.spec, v["blockhash"], v["price"])

    def programs(self, tx):
        m = sol.parse_message(tx)
        return [m["keys"][i["program"]] for i in m["instructions"]]

    def test_allowlisted_programs_only(self):
        allow = ALLOW | {sol.b58e(self.spec.jito_program)}
        for tx in (self.out["tx1"], self.out["tx2"]):
            for p in self.programs(tx):
                self.assertIn(p, allow)

    def test_set_authority_none_is_last_token_affecting(self):
        m = sol.parse_message(self.out["tx2"])
        token_ixs = [i for i in m["instructions"] if m["keys"][i["program"]] == sol.TOKENKEG]
        last = token_ixs[-1]["data"]
        self.assertEqual(last, bytes([6, 0, 0]))  # SetAuthority, MintTokens, None
        self.assertEqual(m["instructions"][-1]["data"], bytes([6, 0, 0]))

    def test_mint_authority_ends_none_and_freeze_none_from_init(self):
        m = sol.parse_message(self.out["tx1"])
        init = [i for i in m["instructions"] if i["data"][:1] == b"\x14" and m["keys"][i["program"]] == sol.TOKENKEG][0]
        d = init["data"]
        self.assertEqual(len(d), 35)
        self.assertEqual(d[1], 6)                     # decimals
        self.assertEqual(d[2:34], self.spec.g_pub)    # mint authority = G until sealed
        self.assertEqual(d[34], 0)                    # freeze authority = None
        seals = [i for i in sol.parse_message(self.out["tx2"])["instructions"] if i["data"][:2] == bytes([6, 0])]
        self.assertEqual(len(seals), 1)
        self.assertEqual(seals[0]["data"][2], 0)      # new authority None

    def test_no_freeze_authority_set_anywhere(self):
        for tx in (self.out["tx1"], self.out["tx2"]):
            m = sol.parse_message(tx)
            for i in m["instructions"]:
                if m["keys"][i["program"]] == sol.TOKENKEG:
                    self.assertNotEqual(i["data"][:2], bytes([6, 1]))

    def test_sizes_at_most_1232(self):
        self.assertLessEqual(len(self.out["tx1"]) + 65, 1232)
        self.assertLessEqual(len(self.out["tx2"]) + 65, 1232)

    def test_mint_is_create_with_seed_no_private_key(self):
        want = sol.create_with_seed(self.spec.g_pub, "kruxa:%d" % self.spec.launch_id, sol.TOKENKEG)
        self.assertEqual(self.out["mint"], want)

    def test_supply_is_sum_of_buckets(self):
        s = self.spec
        self.assertEqual(self.out["supply"], s.max_total_claim + s.reserve_amount + s.lp_amount)
        m = sol.parse_message(self.out["tx2"])
        minted = sum(int.from_bytes(i["data"][1:9], "little") for i in m["instructions"]
                     if m["keys"][i["program"]] == sol.TOKENKEG and i["data"][:1] == b"\x07")
        self.assertEqual(minted, self.out["supply"])

    def test_deterministic(self):
        v = load("genesis-a.json")
        again = gc.compile_genesis(gc.spec_from_json(v["spec"]), v["blockhash"], v["price"])
        self.assertEqual(again, self.out)

    def test_golden_vectors_match(self):
        for name in sorted(n for n in os.listdir(VECTORS) if n.startswith("genesis-")):
            v = load(name)
            out = gc.compile_genesis(gc.spec_from_json(v["spec"]), v["blockhash"], v["price"])
            self.assertEqual(out["tx1"].hex(), v["expected"]["tx1_message"], name)
            self.assertEqual(out["tx2"].hex(), v["expected"]["tx2_message"], name)
            self.assertEqual(sol.b58e(out["mint"]), v["expected"]["mint"], name)
            self.assertEqual(out["spec_hash"].hex(), v["expected"]["spec_hash"], name)

    def test_refuses_bad_spec(self):
        import dataclasses
        with self.assertRaises(ValueError):
            gc.compile_genesis(dataclasses.replace(self.spec, decimals=9), sol.b58e(bytes(32)), 0)
        with self.assertRaises(ValueError):
            gc.compile_genesis(dataclasses.replace(self.spec, jito_program=sol.b58d(sol.SYSTEM)), sol.b58e(bytes(32)), 0)


class PrimitivesTest(unittest.TestCase):
    def test_b58_roundtrip_and_known(self):
        self.assertEqual(sol.b58d("11111111111111111111111111111111"), bytes(32))
        self.assertEqual(sol.b58e(sol.b58d(sol.TOKENKEG)), sol.TOKENKEG)

    def test_known_ata(self):
        # Well-known: ATA of the incinerator-free sample used by spl docs is not stable; check PDA is off curve
        pda = sol.find_pda([b"abc"], sol.b58d(sol.ATA))[0]
        self.assertFalse(sol.on_curve(pda))

    def test_on_curve_known_points(self):
        self.assertTrue(sol.on_curve(bytes([1]) + bytes(31)))  # the identity point y=1


if __name__ == "__main__":
    unittest.main()
