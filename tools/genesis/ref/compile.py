"""Reference genesis compiler (PLAN 4.2, ARCHITECTURE 5.2). The source of truth for the TypeScript compiler.

compile_genesis(spec, blockhash, price) -> two legacy message byte strings (tx1 create, tx2 seal), both signed only
by G (the genesis key: F1 per-launch key or the F0 MPC child key). No private key exists for the mint M.
CLI: python3 -I tools/genesis/ref/compile.py --vector fixtures/vectors/genesis-a.json [--sizes]
     python3 -I tools/genesis/ref/compile.py --write fixtures/vectors/genesis-a.json   (regenerate expected)
"""
import dataclasses, hashlib, json, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sol  # noqa: E402

NULL_ADMIN = "1nc1nerator11111111111111111111111111111111"  # no known private key; Jito admin is set here in tx2
MAX_TX = 1232
CU_LIMIT_TX1 = 150_000
CU_LIMIT_TX2 = 250_000
SPEC_DOMAIN = b"kruxa:genesis-spec:v1"
PUBKEY_FIELDS = ("g_pub", "reserve_owner", "lp_owner", "clawback_owner", "jito_program", "merkle_root")
U64_FIELDS = ("launch_id", "mint_lamports", "reserve_amount", "lp_amount", "max_total_claim", "max_num_nodes")
I64_FIELDS = ("start_ts", "end_ts", "clawback_ts")
STR_FIELDS = ("name", "symbol", "metadata_uri")


@dataclasses.dataclass(frozen=True)
class GenesisSpec:
    launch_id: int
    g_pub: bytes
    decimals: int
    name: str
    symbol: str
    metadata_uri: str
    mint_lamports: int
    reserve_owner: bytes
    lp_owner: bytes
    clawback_owner: bytes
    reserve_amount: int
    lp_amount: int
    jito_program: bytes
    merkle_root: bytes
    max_total_claim: int
    max_num_nodes: int
    start_ts: int
    end_ts: int
    clawback_ts: int


def spec_from_json(j) -> GenesisSpec:
    d = dict(j)
    for k in PUBKEY_FIELDS:
        d[k] = bytes.fromhex(d[k]) if k == "merkle_root" else sol.b58d(d[k])
    for k in U64_FIELDS + I64_FIELDS:
        d[k] = int(d[k])
    return GenesisSpec(**d)


def spec_to_json(s: GenesisSpec):
    d = dataclasses.asdict(s)
    for k in PUBKEY_FIELDS:
        d[k] = d[k].hex() if k == "merkle_root" else sol.b58e(d[k])
    for k in U64_FIELDS + I64_FIELDS:
        d[k] = str(d[k])
    return d


def spec_bytes(s: GenesisSpec) -> bytes:
    """Canonical encoding: fixed field order, u64/i64 little endian, strings u32 LE length + UTF-8, pubkeys raw."""
    out = bytes([1, s.decimals])
    out += struct.pack("<Q", s.launch_id) + s.g_pub
    for t in STR_FIELDS:
        b = getattr(s, t).encode()
        out += struct.pack("<I", len(b)) + b
    out += struct.pack("<Q", s.mint_lamports) + s.reserve_owner + s.lp_owner + s.clawback_owner
    out += struct.pack("<QQ", s.reserve_amount, s.lp_amount) + s.jito_program + s.merkle_root
    out += struct.pack("<QQqqq", s.max_total_claim, s.max_num_nodes, s.start_ts, s.end_ts, s.clawback_ts)
    return out


def spec_hash(s: GenesisSpec) -> bytes:
    return sol.sha256(SPEC_DOMAIN, spec_bytes(s))


def _check(s: GenesisSpec):
    if s.decimals != 6:
        raise ValueError("decimals must be 6")
    if s.jito_program in (sol.b58d(sol.SYSTEM), sol.b58d(sol.TOKENKEG), sol.b58d(sol.ATA), sol.b58d(sol.METAPLEX)):
        raise ValueError("jito_program must not be a core program")
    if len(s.name.encode()) > 32 or len(s.symbol.encode()) > 10 or len(s.metadata_uri.encode()) > 200:
        raise ValueError("metadata field too long")
    if s.reserve_amount + s.lp_amount + s.max_total_claim >= 2**63:
        raise ValueError("supply overflow")
    if len(s.g_pub) != 32 or len(s.merkle_root) != 32:
        raise ValueError("bad key length")
    if not 0 <= s.start_ts <= s.end_ts <= s.clawback_ts:
        raise ValueError("timestamps must satisfy start <= end <= clawback")


def _cb(limit, price):
    p = sol.COMPUTE_BUDGET
    return [sol.ix(p, [], b"\x02" + struct.pack("<I", limit)), sol.ix(p, [], b"\x03" + struct.pack("<Q", price))]


def _string(b: str) -> bytes:
    e = b.encode()
    return struct.pack("<I", len(e)) + e


def _anchor(name: str) -> bytes:
    return sol.sha256(("global:" + name).encode())[:8]


def compile_genesis(s: GenesisSpec, blockhash: str, price: int):
    _check(s)
    g, tok, atap, sysp = s.g_pub, sol.b58d(sol.TOKENKEG), sol.b58d(sol.ATA), sol.b58d(sol.SYSTEM)
    seed = "kruxa:%d" % s.launch_id
    mint = sol.create_with_seed(g, seed, sol.TOKENKEG)
    meta_pid = sol.b58d(sol.METAPLEX)
    metadata = sol.find_pda([b"metadata", meta_pid, mint], meta_pid)[0]
    ata_of = lambda owner: sol.ata(owner, mint)
    reserve_ata, lp_ata, claw_ata = ata_of(s.reserve_owner), ata_of(s.lp_owner), ata_of(s.clawback_owner)
    version = s.launch_id
    distributor = sol.find_pda([b"MerkleDistributor", mint, struct.pack("<Q", version)], s.jito_program)[0]
    vault = ata_of(distributor)

    def create_ata(owner, a):
        return sol.ix(sol.ATA, [(g, True, True), (a, False, True), (owner, False, False), (mint, False, False),
                                (sysp, False, False), (tok, False, False)], b"\x01")

    meta_data = (b"\x21" + _string(s.name) + _string(s.symbol) + _string(s.metadata_uri)
                 + struct.pack("<H", 0) + b"\x00\x00\x00" + b"\x00" + b"\x00")
    tx1 = _cb(CU_LIMIT_TX1, price) + [
        sol.ix(sol.SYSTEM, [(g, True, True), (mint, False, True)],
               struct.pack("<I", 3) + g + struct.pack("<Q", len(seed.encode())) + seed.encode() + struct.pack("<QQ", s.mint_lamports, 82) + tok),
        sol.ix(sol.TOKENKEG, [(mint, False, True)], b"\x14" + bytes([s.decimals]) + g + b"\x00"),
        sol.ix(sol.METAPLEX, [(metadata, False, True), (mint, False, False), (g, True, False), (g, True, True),
                              (g, True, False), (sysp, False, False)], meta_data),
        create_ata(s.reserve_owner, reserve_ata), create_ata(s.lp_owner, lp_ata), create_ata(s.clawback_owner, claw_ata),
    ]
    admin = sol.b58d(NULL_ADMIN)
    new_dist = _anchor("new_distributor") + struct.pack("<Q", version) + s.merkle_root + struct.pack(
        "<QQqqq", s.max_total_claim, s.max_num_nodes, s.start_ts, s.end_ts, s.clawback_ts)
    jito = sol.b58e(s.jito_program)

    def mint_to(dest, amount):
        return sol.ix(sol.TOKENKEG, [(mint, False, True), (dest, False, True), (g, True, False)],
                      b"\x07" + struct.pack("<Q", amount))

    tx2 = _cb(CU_LIMIT_TX2, price) + [
        sol.ix(jito, [(distributor, False, True), (claw_ata, False, True), (mint, False, False), (vault, False, True),
                      (g, True, True), (sysp, False, False), (atap, False, False), (tok, False, False)], new_dist),
        sol.ix(jito, [(distributor, False, True), (g, True, True), (admin, False, True)], _anchor("set_admin")),
        mint_to(vault, s.max_total_claim), mint_to(reserve_ata, s.reserve_amount), mint_to(lp_ata, s.lp_amount),
        sol.ix(sol.TOKENKEG, [(mint, False, True), (g, True, False)], bytes([6, 0, 0])),
    ]
    m1, m2 = sol.compile_message(g, tx1, blockhash), sol.compile_message(g, tx2, blockhash)
    return {"tx1": m1, "tx2": m2, "mint": mint, "supply": s.max_total_claim + s.reserve_amount + s.lp_amount,
            "spec_hash": spec_hash(s),
            "accounts": {"metadata": metadata, "reserve_ata": reserve_ata, "lp_ata": lp_ata, "clawback_ata": claw_ata,
                         "distributor": distributor, "vault": vault}}


def expected_block(out):
    return {"mint": sol.b58e(out["mint"]), "supply": str(out["supply"]), "spec_hash": out["spec_hash"].hex(),
            "tx1_message": out["tx1"].hex(), "tx2_message": out["tx2"].hex(),
            "tx1_size": len(out["tx1"]) + 65, "tx2_size": len(out["tx2"]) + 65,
            "accounts": {k: sol.b58e(v) for k, v in out["accounts"].items()}}


def main(argv):
    if len(argv) < 3 or argv[1] not in ("--vector", "--write"):
        print("usage: compile.py (--vector|--write) FILE [--sizes]", file=sys.stderr)
        return 64
    path = argv[2]
    v = json.load(open(path))
    out = compile_genesis(spec_from_json(v["spec"]), v["blockhash"], v["price"])
    if argv[1] == "--write":
        v["expected"] = expected_block(out)
        json.dump(v, open(path, "w"), indent=2)
        open(path, "a").write("\n")
    if "--sizes" in argv:
        e = expected_block(out)
        print("tx1 %d <= %d" % (e["tx1_size"], MAX_TX))
        print("tx2 %d <= %d" % (e["tx2_size"], MAX_TX))
        return 0 if max(e["tx1_size"], e["tx2_size"]) <= MAX_TX else 1
    print(json.dumps(expected_block(out), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
