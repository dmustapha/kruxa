"""Tests for the reference genesis compiler (PLAN 4.2). Run: python3 -I tools/genesis/ref/test_compile.py"""
import dataclasses, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compile as gc  # noqa: E402
import sol  # noqa: E402

VECTORS = os.path.join(HERE, "..", "..", "..", "fixtures", "vectors")
ALLOW = {sol.SYSTEM, sol.COMPUTE_BUDGET, sol.TOKENKEG, sol.ATA, sol.METAPLEX}


def load(name):
    with open(os.path.join(VECTORS, name)) as f:
        return json.load(f)


def run(v, spec_hex=None, params=None):
    return gc.compile_genesis(bytes.fromhex(spec_hex or v["spec_hex"]), params or gc.params_from_json(v["params"]), v["blockhash"], v["price"])


class CompilerTest(unittest.TestCase):
    def setUp(self):
        self.v = load("genesis-b.json")  # has a reserve bucket, so every instruction kind is present
        self.spec = gc.decode_spec(bytes.fromhex(self.v["spec_hex"]))
        self.out = run(self.v)

    def programs(self, tx):
        m = sol.parse_message(tx)
        return [m["keys"][i["program"]] for i in m["instructions"]]

    def test_spec_hash_equals_the_contracts_hash(self):
        self.assertEqual(self.out["spec_hash"].hex(), self.v["spec_hash"])  # computed by kruxa-logic in Rust

    def test_allowlisted_programs_only(self):
        allow = ALLOW | {self.v["params"]["jito_program"]}
        for tx in (self.out["tx1"], self.out["tx2"]):
            for p in self.programs(tx):
                self.assertIn(p, allow)

    def test_set_authority_none_is_last_instruction(self):
        m = sol.parse_message(self.out["tx2"])
        self.assertEqual(m["instructions"][-1]["data"], bytes([6, 0, 0]))
        self.assertEqual(m["keys"][m["instructions"][-1]["program"]], sol.TOKENKEG)

    def test_freeze_none_at_init_and_authority_flow(self):
        m = sol.parse_message(self.out["tx1"])
        init = [i for i in m["instructions"] if i["data"][:1] == b"\x14" and m["keys"][i["program"]] == sol.TOKENKEG][0]["data"]
        self.assertEqual((len(init), init[1], init[2:34], init[34]), (35, 6, self.spec.genesis_key_pubkey, 0))
        for tx in (self.out["tx1"], self.out["tx2"]):
            pm = sol.parse_message(tx)
            for i in pm["instructions"]:
                if pm["keys"][i["program"]] == sol.TOKENKEG:
                    self.assertNotEqual(i["data"][:2], bytes([6, 1]))

    def test_sizes_at_most_1232(self):
        self.assertLessEqual(len(self.out["tx1"]) + 65, 1232)
        self.assertLessEqual(len(self.out["tx2"]) + 65, 1232)

    def test_mint_is_create_with_seed(self):
        self.assertEqual(self.out["mint"], sol.create_with_seed(self.spec.genesis_key_pubkey, self.spec.mint_seed, sol.TOKENKEG))

    def test_supply_is_sum_of_buckets(self):
        m = sol.parse_message(self.out["tx2"])
        minted = sum(int.from_bytes(i["data"][1:9], "little") for i in m["instructions"]
                     if m["keys"][i["program"]] == sol.TOKENKEG and i["data"][:1] == b"\x07")
        self.assertEqual(minted, self.spec.supply_total)

    def test_distributor_timestamps_are_in_the_future_of_the_clock(self):
        s, e, c = self.out["timestamps"]
        clock = int(self.v["params"]["clock_ts"])
        self.assertTrue(clock < s < e < c)

    def test_golden_vectors_match(self):
        for name in sorted(n for n in os.listdir(VECTORS) if n.startswith("genesis-")):
            v = load(name)
            out = run(v)
            self.assertEqual(out["tx1"].hex(), v["expected"]["tx1_message"], name)
            self.assertEqual(out["tx2"].hex(), v["expected"]["tx2_message"], name)
            self.assertEqual(out["spec_hash"].hex(), v["spec_hash"], name)

    def test_refuses_bad_specs(self):
        v = self.v
        raw = bytearray.fromhex(v["spec_hex"])
        bad_version = bytes(raw).replace(gc.COMPILER_VERSION.encode(), b"gs-compiler/9.9.9")
        for spec_hex in (bad_version.hex(), bytes(raw[:-1]).hex(), (bytes(raw) + b"\0").hex()):
            with self.assertRaises(ValueError):
                run(v, spec_hex=spec_hex)
        with self.assertRaises(ValueError):
            run(v, params=dataclasses.replace(gc.params_from_json(v["params"]), metadata_uri="https://evil.example/x.json"))
        with self.assertRaises(ValueError):
            run(v, params=dataclasses.replace(gc.params_from_json(v["params"]), jito_program=sol.b58d(sol.SYSTEM)))


class PrimitivesTest(unittest.TestCase):
    def test_b58_roundtrip_and_known(self):
        self.assertEqual(sol.b58d("11111111111111111111111111111111"), bytes(32))
        self.assertEqual(sol.b58e(sol.b58d(sol.TOKENKEG)), sol.TOKENKEG)

    def test_pda_is_off_curve_and_identity_on_curve(self):
        self.assertFalse(sol.on_curve(sol.find_pda([b"abc"], sol.b58d(sol.ATA))[0]))
        self.assertTrue(sol.on_curve(bytes([1]) + bytes(31)))


if __name__ == "__main__":
    unittest.main()
