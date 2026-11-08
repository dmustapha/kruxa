"""Reference genesis compiler gs-compiler/1.0.0 (PLAN 4.2, ARCHITECTURE 5.2). The source of truth for the TypeScript compiler.

Input: the borsh bytes of the core's GenesisSpec (view `get_genesis_spec`, hash-checked against `get_genesis.genesis_spec_hash`), plus the
public compile parameters (jito program, metadata uri, clock timestamp), a blockhash and a compute price. Output: two legacy messages
(tx1 create, tx2 seal), both signed only by G (F1 per-launch key or F0 MPC child key). No private key exists for the mint M.
Owners are not committed by the spec; the compiler derives them: the reserve and clawback owner is the Squads vault PDA of
(reserve_squads_multisig_hash, reserve_vault_index); the distributor is the Jito PDA ("MerkleDistributor", M, launch_id).
CLI: python3 -I tools/genesis/ref/compile.py --vector fixtures/vectors/genesis-a.json [--sizes]
"""
import dataclasses, json, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sol  # noqa: E402

COMPILER_VERSION = "gs-compiler/1.0.0"
NULL_ADMIN = "1nc1nerator11111111111111111111111111111111"  # no known private key; Jito admin is set here in tx2
SQUADS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
MAX_TX = 1232
CU_LIMIT_TX1 = 150_000
CU_LIMIT_TX2 = 250_000
START_DELAY_SEC = 150  # Jito needs start and end strictly in the future at tx2 time; F0 needs two MPC round trips first
VESTING_SEC = 60
MINT_LAMPORTS = 1_461_600
ROLE_RESERVE, ROLE_DISTRIBUTOR, ROLE_LP_MIRROR = 0, 1, 2


class R:
    """Borsh reader."""
    def __init__(self, b): self.b, self.o = b, 0
    def take(self, n):
        if self.o + n > len(self.b): raise ValueError("spec truncated")
        v = self.b[self.o:self.o + n]; self.o += n; return v
    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack("<H", self.take(2))[0]
    def u32(self): return struct.unpack("<I", self.take(4))[0]
    def u64(self): return struct.unpack("<Q", self.take(8))[0]
    def s(self): return self.take(self.u32()).decode()
    def k(self): return self.take(32)
    def done(self):
        if self.o != len(self.b): raise ValueError("trailing bytes in spec")


@dataclasses.dataclass(frozen=True)
class Spec:
    spec_version: int; compiler_version: str; chain: str; cluster_genesis_hash: bytes; launch_id: str; near_contract: str
    near_block_height: int; mode: int; genesis_key_pubkey: bytes; mint_seed: str; mint_address: bytes; token_program: bytes
    decimals: int; supply_total: int; name: str; symbol: str; metadata_uri_sha256: bytes; metadata_hash: bytes
    mint_authority_none: bool; freeze_authority_none: bool; extensions_allowed: bool; buckets: tuple
    reserve_squads_multisig_hash: bytes; reserve_vault_index: int; reserve_disclosure: int; merkle_root: bytes
    max_total_claim: int; max_num_nodes: int; clawback_days: int


def decode_spec(b: bytes) -> Spec:
    r = R(b)
    v = dict(spec_version=r.u8(), compiler_version=r.s(), chain=r.s(), cluster_genesis_hash=r.k(), launch_id=r.s(), near_contract=r.s(),
             near_block_height=r.u64(), mode=r.u8(), genesis_key_pubkey=r.k(), mint_seed=r.s(), mint_address=r.k(), token_program=r.k(),
             decimals=r.u8(), supply_total=r.u64(), name=r.s(), symbol=r.s(), metadata_uri_sha256=r.k(), metadata_hash=r.k(),
             mint_authority_none=bool(r.u8()), freeze_authority_none=bool(r.u8()), extensions_allowed=bool(r.u8()))
    v["buckets"] = tuple((r.u8(), r.u64()) for _ in range(r.u32()))
    v.update(reserve_squads_multisig_hash=r.k(), reserve_vault_index=r.u8(), reserve_disclosure=r.u8(), merkle_root=r.k(),
             max_total_claim=r.u64(), max_num_nodes=r.u32(), clawback_days=r.u16())
    r.done()
    return Spec(**v)


@dataclasses.dataclass(frozen=True)
class Params:
    jito_program: bytes
    metadata_uri: str
    clock_ts: int


def spec_hash(spec_bytes: bytes) -> bytes:
    return sol.sha256(spec_bytes)


def vault_pda(s: Spec) -> bytes:
    return sol.find_pda([b"multisig", s.reserve_squads_multisig_hash, b"vault", bytes([s.reserve_vault_index])], sol.b58d(SQUADS))[0]


def check(s: Spec, p: Params):
    if s.compiler_version != COMPILER_VERSION:
        raise ValueError("compiler version %s is not %s" % (s.compiler_version, COMPILER_VERSION))
    if s.decimals != 6 or not (s.mint_authority_none and s.freeze_authority_none) or s.extensions_allowed:
        raise ValueError("spec must be 6 decimals, both authorities None, no extensions")
    if s.token_program != sol.b58d(sol.TOKENKEG):
        raise ValueError("token program must be Tokenkeg")
    if p.jito_program in (sol.b58d(x) for x in (sol.SYSTEM, sol.TOKENKEG, sol.ATA, sol.METAPLEX, sol.COMPUTE_BUDGET)):
        raise ValueError("jito_program must not be a core program")
    if sol.sha256(p.metadata_uri.encode()) != s.metadata_uri_sha256:
        raise ValueError("metadata uri does not hash to metadata_uri_sha256")
    if len(s.name.encode()) > 32 or len(s.symbol.encode()) > 10 or len(p.metadata_uri.encode()) > 200:
        raise ValueError("metadata field too long")
    roles = [r for r, _ in s.buckets]
    if roles != sorted(set(roles)) or any(r not in (ROLE_RESERVE, ROLE_DISTRIBUTOR) for r in roles):
        raise ValueError("unsupported bucket roles (LP mirror is not supported by %s)" % COMPILER_VERSION)
    amounts = dict(s.buckets)
    if sum(amounts.values()) != s.supply_total or amounts.get(ROLE_DISTRIBUTOR, 0) != s.max_total_claim:
        raise ValueError("buckets must sum to supply_total and the distributor bucket must equal max_total_claim")
    if s.supply_total >= 2**63 or not s.launch_id.isdigit() or s.mint_seed != s.launch_id:
        raise ValueError("bad supply, launch id or mint seed")
    if sol.create_with_seed(s.genesis_key_pubkey, s.mint_seed, sol.TOKENKEG) != s.mint_address:
        raise ValueError("mint_address is not createWithSeed(g_pub, mint_seed, Tokenkeg)")


def _cb(limit, price):
    p = sol.COMPUTE_BUDGET
    return [sol.ix(p, [], b"\x02" + struct.pack("<I", limit)), sol.ix(p, [], b"\x03" + struct.pack("<Q", price))]


def _string(b: str) -> bytes:
    e = b.encode()
    return struct.pack("<I", len(e)) + e


def _anchor(name: str) -> bytes:
    return sol.sha256(("global:" + name).encode())[:8]


def compile_genesis(spec_bytes: bytes, p: Params, blockhash: str, price: int):
    s = decode_spec(spec_bytes)
    check(s, p)
    g, tok, atap, sysp = s.genesis_key_pubkey, sol.b58d(sol.TOKENKEG), sol.b58d(sol.ATA), sol.b58d(sol.SYSTEM)
    mint = s.mint_address
    meta_pid = sol.b58d(sol.METAPLEX)
    metadata = sol.find_pda([b"metadata", meta_pid, mint], meta_pid)[0]
    vault_owner = vault_pda(s)
    reserve_ata = sol.ata(vault_owner, mint)  # also the clawback receiver (S1-D: unclaimed tokens return to the Squads ATA)
    version = int(s.launch_id)
    distributor = sol.find_pda([b"MerkleDistributor", mint, struct.pack("<Q", version)], p.jito_program)[0]
    vault = sol.ata(distributor, mint)
    start = p.clock_ts + START_DELAY_SEC
    end, claw = start + VESTING_SEC, start + s.clawback_days * 86400
    amounts = dict(s.buckets)

    meta_data = (b"\x21" + _string(s.name) + _string(s.symbol) + _string(p.metadata_uri)
                 + struct.pack("<H", 0) + b"\x00\x00\x00" + b"\x00" + b"\x00")
    tx1 = _cb(CU_LIMIT_TX1, price) + [
        sol.ix(sol.SYSTEM, [(g, True, True), (mint, False, True)],
               struct.pack("<I", 3) + g + struct.pack("<Q", len(s.mint_seed.encode())) + s.mint_seed.encode()
               + struct.pack("<QQ", MINT_LAMPORTS, 82) + tok),
        sol.ix(sol.TOKENKEG, [(mint, False, True)], b"\x14" + bytes([s.decimals]) + g + b"\x00"),
        sol.ix(sol.METAPLEX, [(metadata, False, True), (mint, False, False), (g, True, False), (g, True, True),
                              (g, True, False), (sysp, False, False)], meta_data),
        sol.ix(sol.ATA, [(g, True, True), (reserve_ata, False, True), (vault_owner, False, False), (mint, False, False),
                         (sysp, False, False), (tok, False, False)], b"\x01"),
    ]
    admin = sol.b58d(NULL_ADMIN)
    new_dist = _anchor("new_distributor") + struct.pack("<Q", version) + s.merkle_root + struct.pack(
        "<QQqqq", s.max_total_claim, s.max_num_nodes, start, end, claw)
    jito = sol.b58e(p.jito_program)

    def mint_to(dest, amount):
        return sol.ix(sol.TOKENKEG, [(mint, False, True), (dest, False, True), (g, True, False)], b"\x07" + struct.pack("<Q", amount))

    # No Solana buyers (zero leaves, zero claim total): there is nothing to distribute, so no distributor is created.
    has_dist = s.max_num_nodes > 0 or s.max_total_claim > 0
    mints = [mint_to(vault, amounts.get(ROLE_DISTRIBUTOR, 0))] if has_dist else []
    if amounts.get(ROLE_RESERVE, 0) > 0:
        mints.append(mint_to(reserve_ata, amounts[ROLE_RESERVE]))
    dist_ixs = [
        sol.ix(jito, [(distributor, False, True), (reserve_ata, False, True), (mint, False, False), (vault, False, True),
                      (g, True, True), (sysp, False, False), (atap, False, False), (tok, False, False)], new_dist),
        sol.ix(jito, [(distributor, False, True), (g, True, True), (admin, False, True)], _anchor("set_admin")),
    ] if has_dist else []
    tx2 = _cb(CU_LIMIT_TX2, price) + dist_ixs + mints + [sol.ix(sol.TOKENKEG, [(mint, False, True), (g, True, False)], bytes([6, 0, 0]))]
    m1, m2 = sol.compile_message(g, tx1, blockhash), sol.compile_message(g, tx2, blockhash)
    return {"tx1": m1, "tx2": m2, "mint": mint, "supply": s.supply_total, "spec_hash": spec_hash(spec_bytes),
            "timestamps": [start, end, claw],
            "accounts": {"metadata": metadata, "reserve_ata": reserve_ata, "reserve_owner": vault_owner,
                         "distributor": distributor, "vault": vault}}


def params_from_json(j) -> Params:
    return Params(jito_program=sol.b58d(j["jito_program"]), metadata_uri=j["metadata_uri"], clock_ts=int(j["clock_ts"]))


def expected_block(out):
    return {"mint": sol.b58e(out["mint"]), "supply": str(out["supply"]), "spec_hash": out["spec_hash"].hex(),
            "timestamps": out["timestamps"], "tx1_message": out["tx1"].hex(), "tx2_message": out["tx2"].hex(),
            "tx1_size": len(out["tx1"]) + 65, "tx2_size": len(out["tx2"]) + 65,
            "accounts": {k: sol.b58e(v) for k, v in out["accounts"].items()}}


def main(argv):
    if len(argv) < 3 or argv[1] not in ("--vector", "--write"):
        print("usage: compile.py (--vector|--write) FILE [--sizes]", file=sys.stderr)
        return 64
    path = argv[2]
    v = json.load(open(path))
    out = compile_genesis(bytes.fromhex(v["spec_hex"]), params_from_json(v["params"]), v["blockhash"], v["price"])
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
